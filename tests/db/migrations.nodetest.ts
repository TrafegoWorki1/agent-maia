// Testes de banco com o executor nativo do Node (node --test), não com o Vitest: o PGlite (Postgres em WebAssembly)
// derruba os workers do Vitest no Windows quando a memória livre é pouca; no Node puro roda sempre.
// As migrações são aplicadas do zero num Postgres temporário. Nada aqui toca em banco remoto.
//   pnpm test:db
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildLocalDb, listMigrations, type LocalDb } from "../../scripts/db/local.ts";
import { checkEssentials, checkNames, findDestructive, hasApprovalMark } from "../../scripts/db/rules.ts";
import { diffSnapshots, formatDiff, hasDrift } from "../../scripts/db/snapshot.ts";
import { assertReadOnly } from "../../scripts/db/remote.ts";
import { missingStructures, scanSource, scanUsage } from "../../scripts/db/usage.ts";

let local: LocalDb;
before(async () => {
  local = await buildLocalDb();
});
after(async () => {
  await local?.close();
});

const q = async (sql: string, params: unknown[] = []) => (await local.db.query<Record<string, unknown>>(sql, params)).rows;
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, pattern);

describe("plano de eficácia: trabalho, lembretes e entrega", () => {
  it("cria histórico e lembrete de prazo na mesma transação; não duplica claim", async () => {
    const t = (await q("insert into work_tasks(title,responsible,due_at,request_key) values('Validar fluxo','Owner',now() - interval '1 minute','test:work') returning id,revision"))[0];
    assert.equal(t.revision,1);
    assert.equal((await q("select * from work_task_updates where work_task_id = $1",[t.id])).length,1);
    const claimed = await q("select * from claim_task_reminders(10)");
    assert.equal(claimed.length,1);
    assert.equal((await q("select * from claim_task_reminders(10)")).length,0);
    await rejects(q("update work_tasks set due_at = now() where id = $1",[t.id]),/em envio/i);
    await q("update task_reminders set status = 'failed' where id = $1",[claimed[0].id]);
    await q("update work_tasks set due_at = now() + interval '1 day' where id = $1",[t.id]);
    assert.equal((await q("select status from task_reminders where work_task_id = $1",[t.id]))[0].status,"pending");
    await rejects(q("update work_tasks set status = 'concluida' where id = $1",[t.id]),/check/i);
    await q("update work_tasks set status = 'concluida',completion_evidence = 'Documento entregue' where id = $1",[t.id]);
    assert.equal((await q("select status from task_reminders where work_task_id = $1",[t.id]))[0].status,"cancelled");
    assert.equal((await q("select * from work_task_updates where work_task_id = $1",[t.id])).length,3);
    await rejects(q("insert into task_reminders(work_task_id,run_at,kind,request_key) values($1,now(),'manual','test:closed')",[t.id]),/concluída/i);
    await rejects(q("insert into work_tasks(title,responsible,status,request_key) values('X','Owner','atrasada','test:invalid')"),/check/i);
  });
  it("entrega guarda ordem e não repete partes aceitas ou incertas", async () => {
    const t = (await q("insert into tasks(channel,kind,summary,status) values('whatsapp','conversa','Teste entrega','em_andamento') returning id"))[0];
    await q("insert into response_deliveries(task_id,part,recipient,text) values($1,0,'owner','Parte 1'),($1,1,'owner','Parte 2')",[t.id]);
    const first = await q("select * from claim_response_delivery($1)",[t.id]);
    assert.equal(first[0].part,0);
    assert.equal((await q("select * from claim_response_delivery($1)",[t.id])).length,0);
    await q("update response_deliveries set status = 'sent',message_id = 'test-msg' where id = $1",[first[0].id]);
    const second = await q("select * from claim_response_delivery($1)",[t.id]);
    assert.equal(second[0].part,1);
    await q("update response_deliveries set status = 'uncertain' where id = $1",[second[0].id]);
    assert.equal((await q("select * from claim_response_delivery($1)",[t.id])).length,0);
    await rejects(q("update response_deliveries set status = 'sent' where id = $1",[second[0].id]),/check/i);
  });
  it("tabelas privadas não são legíveis por anon e RPCs não são públicas", async () => {
    for (const table of ['work_tasks','work_task_updates','task_reminders','task_evaluations','response_deliveries']) {
      assert.equal((await q("select relrowsecurity from pg_class where oid = $1::regclass",[`public.${table}`]))[0].relrowsecurity,true);
      assert.equal((await q("select has_table_privilege('anon',$1,'select') as allowed",[`public.${table}`]))[0].allowed,false);
      assert.equal((await q("select has_table_privilege('service_role',$1,'select') as allowed",[`public.${table}`]))[0].allowed,true);
    }
    assert.equal((await q("select has_function_privilege('authenticated','claim_task_reminders(integer)','execute') as allowed"))[0].allowed,false);
  });
});

describe("migrações reconstroem o banco do zero", () => {
  it("todas as migrações do repositório aplicam em ordem", () => {
    assert.deepEqual(local.applied, listMigrations());
    assert.ok(local.applied.length >= 19);
  });

  it("nomes seguem o padrão do Supabase CLI e as versões são únicas", () => {
    assert.deepEqual(checkNames(listMigrations()), []);
    assert.equal(checkNames(["maia_sem_versao.sql"]).length, 1);
    assert.equal(checkNames(["20261009000000_a.sql", "20261009000000_b.sql"]).length, 1);
  });

  it("estruturas essenciais, funções RPC, constraints e RLS estão presentes", async () => {
    assert.deepEqual(checkEssentials(await local.snapshot()), []);
  });

  it("o código só usa tabelas e funções que as migrações criam", async () => {
    const rows = await local.snapshot();
    const tables = new Set(rows.filter((r) => r.kind === "tabela").map((r) => r.name));
    const functions = new Set(rows.filter((r) => r.kind === "funcao").map((r) => r.name.split("(")[0]));
    assert.deepEqual(missingStructures(scanUsage(), tables, functions), []);
  });

  it("detecta o uso de tabela ou função que nenhuma migração cria", () => {
    const usage = { tables: new Map([["tabela_nova", ["server/x.ts"]]]), rpcs: new Map([["funcao_nova", ["server/y.ts"]]]) };
    assert.equal(missingStructures(usage, new Set(["inbox"]), new Set(["claim_inbox"])).length, 2);
    assert.deepEqual(scanSource('db.from("kv").select(); db.rpc("claim_inbox", {})'), { tables: ["kv"], rpcs: ["claim_inbox"] });
  });

  it("a validação acusa estrutura essencial ausente", async () => {
    const rows = (await local.snapshot()).filter((r) => !(r.kind === "tabela" && r.name === "inbox"));
    assert.match(checkEssentials(rows).join(" "), /inbox/);
  });

  it("a fila aceita o tipo media e recusa tipo desconhecido", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload) values ('media', 'owner', '{}')");
    await rejects(local.db.exec("insert into public.inbox (kind, sender) values ('video', 'owner')"), /check/i);
    await local.db.exec("delete from public.inbox");
  });
});

describe("regras de migração", () => {
  it("comando destrutivo exige a marcação de aprovação", () => {
    assert.ok(findDestructive("drop table public.x;").includes("drop table"));
    assert.ok(findDestructive("alter table t drop column c;").includes("drop column"));
    assert.ok(findDestructive("delete from public.x;").includes("delete sem where"));
    assert.deepEqual(findDestructive("delete from public.x where id = 1;"), []);
    assert.deepEqual(findDestructive("-- drop table é só comentário\ncreate table a (id int);"), []);
    assert.equal(hasApprovalMark("-- destrutivo-aprovado: owner, remover tabela sem uso\ndrop table x;"), true);
    assert.equal(hasApprovalMark("drop table x;"), false);
  });

  it("a consulta remota é somente leitura", () => {
    assert.doesNotThrow(() => assertReadOnly("select 1"));
    assert.doesNotThrow(() => assertReadOnly("with a as (select 1) select * from a"));
    assert.doesNotThrow(() => assertReadOnly("select 'delete' as palavra"));
    assert.throws(() => assertReadOnly("drop table inbox"));
    assert.throws(() => assertReadOnly("select 1; delete from inbox"));
    assert.throws(() => assertReadOnly("update inbox set status = 'x'"));
  });
});

describe("detecção de divergência (drift)", () => {
  it("banco idêntico às migrações não tem divergência", async () => {
    const rows = await local.snapshot();
    const diff = diffSnapshots(rows, rows);
    assert.equal(hasDrift(diff), false);
    assert.match(formatDiff(diff), /Sem divergência/);
  });

  it("alteração manual no banco vira relatório", async () => {
    const expected = await local.snapshot();
    const actual = expected
      .filter((r) => r.name !== "contacts")
      .map((r) => (r.kind === "coluna" && r.name === "inbox.status" ? { ...r, detail: r.detail + " default 'x'" } : r))
      .concat([{ kind: "tabela", name: "criada_na_mao", detail: "rls=false force=false" }]);
    const diff = diffSnapshots(expected, actual);
    assert.equal(hasDrift(diff), true);
    assert.ok(diff.onlyActual.map((r) => r.name).includes("criada_na_mao"));
    assert.ok(diff.onlyExpected.map((r) => r.name).includes("contacts"));
    assert.ok(diff.changed.map((c) => c.name).includes("inbox.status"));
    const report = formatDiff(diff);
    assert.match(report, /criada_na_mao/);
    assert.doesNotMatch(report, /service_role_key|Bearer|token/i);
  });
});

describe("acesso: ninguém de fora lê o banco", () => {
  it("anon e authenticated não enxergam linhas das tabelas internas", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload) values ('text', 'owner', 'segredo')");
    for (const role of ["anon", "authenticated"]) {
      await local.db.exec(`set role ${role}`);
      try {
        assert.equal((await q("select * from public.inbox")).length, 0);
        assert.equal((await q("select * from public.group_messages")).length, 0);
        assert.equal((await q("select * from public.contacts")).length, 0);
      } finally {
        await local.db.exec("reset role");
      }
    }
    await local.db.exec("delete from public.inbox");
  });

  it("anon e authenticated não executam as funções internas", async () => {
    for (const role of ["anon", "authenticated"]) {
      await local.db.exec(`set role ${role}`);
      try {
        await rejects(q("select * from public.claim_inbox(1)"), /permission denied/i);
        await rejects(q("select public.purge_group_messages()"), /permission denied/i);
      } finally {
        await local.db.exec("reset role");
      }
    }
  });

  it("is_owner é falso sem sessão", async () => {
    assert.equal((await q("select public.is_owner() as v"))[0].v, false);
  });
});

describe("estruturas usadas pelos módulos (integração)", () => {
  it("fila inbox: claim_inbox reserva sem repetir e purge apaga o texto vencido", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload, key_id) values ('text','owner','a','k1'), ('text','owner','b','k2')");
    const first = await q("select * from public.claim_inbox(1)");
    assert.equal(first.length, 1);
    assert.equal(first[0].status, "processando");
    const second = await q("select * from public.claim_inbox(10)");
    assert.equal(second.length, 1);
    assert.notEqual(second[0].id, first[0].id);
    await rejects(local.db.exec("insert into public.inbox (kind, sender, key_id) values ('text','owner','k1')"), /unique|duplicate/i);
    await local.db.exec("update public.inbox set expires_at = now() - interval '1 hour'");
    assert.equal((await q("select public.purge_inbox_payloads() as n"))[0].n, 2);
    await local.db.exec("delete from public.inbox");
  });

  it("agrupamento de mensagens: add_batch_item junta no mesmo lote", async () => {
    const a = (await q("select public.add_batch_item('dono', 1, 'oi', 15, 60) as id"))[0].id;
    const b = (await q("select public.add_batch_item('dono', 2, 'tudo bem', 15, 60) as id"))[0].id;
    assert.equal(b, a);
    assert.deepEqual(await q("select seq from public.batch_items where batch_id = $1 order by seq", [a]), [{ seq: 1 }, { seq: 2 }]);
    assert.equal((await q("select * from public.due_owner_batches()")).length, 0);
  });

  it("cota diária de imagens: claim respeita o limite e release devolve", async () => {
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, false);
    await q("select public.release_image_quota('2026-10-09')");
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
  });

  it("agendamentos: claim_due_actions pega só o que venceu e uma vez", async () => {
    await local.db.exec(`insert into public.scheduled_actions (kind, group_jid, group_name, payload, run_at) values
      ('texto','1@g.us','G','{"text":"oi"}', now() - interval '1 minute'),
      ('texto','1@g.us','G','{"text":"depois"}', now() + interval '1 day')`);
    const due = await q("select * from public.claim_due_actions(5)");
    assert.equal(due.length, 1);
    assert.equal(due[0].status, "running");
    assert.equal((await q("select * from public.claim_due_actions(5)")).length, 0);
  });

  it("memória das conversas: reenvio da mesma mensagem é barrado e a limpeza apaga o antigo", async () => {
    await local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')");
    await rejects(local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')"), /unique|duplicate/i);
    await local.db.exec("insert into public.group_messages (conv, text, at) values ('g1','velho', now() - interval '8 days')");
    assert.equal((await q("select public.purge_group_messages() as n"))[0].n, 1);
  });

  it("aprovações e permissões: papel de pessoa só aceita os valores previstos (regressão do people_role_check)", async () => {
    await local.db.exec("insert into public.people (name, role) values ('Ana', 'equipe')");
    await rejects(local.db.exec("insert into public.people (name, role) values ('Bia', 'membro')"), /people_role_check/);
    assert.equal((await q("select code from public.permission_catalog where code = 'mensagem.enviar'")).length, 1);
    await rejects(local.db.exec("insert into public.approvals (tool_name, status) values ('x', 'qualquer')"), /check/i);
  });

  it("grupos e contatos: grupo cadastrado é único e a origem é validada", async () => {
    await local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Teste')");
    await rejects(local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Outro')"), /unique|duplicate|pkey/i);
    await rejects(local.db.exec("insert into public.contacts (number, source) values ('5511999999999', 'invalida')"), /check/i);
    await local.db.exec("insert into public.outreach (number, text) values ('5511999999999', 'oi')");
  });

  it("registro de atividade de grupo conta mensagens", async () => {
    await q("select public.record_group_activity('5@g.us', now())");
    await q("select public.record_group_activity('5@g.us', now())");
    assert.equal((await q("select messages from public.group_activity where jid = '5@g.us'"))[0].messages, 2);
  });

  it("base de conhecimento: busca híbrida devolve o trecho com a fonte", async () => {
    await local.db.exec("insert into public.knowledge_sources (slug, titulo, origem, checksum) values ('s1', 'Regras', 'CLAUDE.md', 'abc')");
    const vec = `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await local.db.exec(`insert into public.knowledge_chunks (source_id, ordem, secao, conteudo, embedding) values (1, 1, 'Aprovação', 'A aprovação vale para uma única ação', '${vec}')`);
    const rows = await q("select * from public.search_knowledge('aprovação ação', $1::extensions.vector, 3)", [vec]);
    assert.ok(rows.length > 0);
    assert.equal(String(rows[0].titulo), "Regras");
  });

  it("roteamento multi-IA e Jev: saúde dos provedores e triagem aceitam os estados previstos", async () => {
    await local.db.exec("insert into public.provider_health (provider, state) values ('claude', 'healthy')");
    await rejects(local.db.exec("insert into public.provider_health (provider, state) values ('codex', 'quebrado')"), /check/i);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'agent_runs'")).map((r) => r.column_name);
    for (const c of ["tokens_in", "tokens_out"]) assert.ok(cols.includes(c), c);
    const jev = (await q("select column_name from information_schema.columns where table_name = 'jev_triage'")).map((r) => r.column_name);
    assert.ok(jev.includes("intencao"));
  });
});
