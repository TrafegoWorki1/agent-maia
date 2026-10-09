import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLocalDb, listMigrations, type LocalDb } from "../scripts/db/local.ts";
import { checkEssentials, checkNames, findDestructive, hasApprovalMark } from "../scripts/db/rules.ts";
import { diffSnapshots, formatDiff, hasDrift } from "../scripts/db/snapshot.ts";
import { assertReadOnly } from "../scripts/db/remote.ts";
import { missingStructures, scanSource, scanUsage } from "../scripts/db/usage.ts";

// Testes de banco: as migrações aplicadas do zero em um Postgres temporário (PGlite). Nada aqui toca em banco remoto.
let local: LocalDb;
beforeAll(async () => {
  local = await buildLocalDb();
}, 60_000);
afterAll(async () => {
  await local?.close();
});

const q = async (sql: string, params: unknown[] = []) => (await local.db.query<Record<string, unknown>>(sql, params)).rows;

describe("migrações reconstroem o banco do zero", () => {
  it("todas as migrações do repositório aplicam em ordem", () => {
    expect(local.applied).toEqual(listMigrations());
    expect(local.applied.length).toBeGreaterThanOrEqual(18);
  });

  it("nomes seguem o padrão do Supabase CLI e as versões são únicas", () => {
    expect(checkNames(listMigrations())).toEqual([]);
    expect(checkNames(["maia_sem_versao.sql"])).toHaveLength(1);
    expect(checkNames(["20261009000000_a.sql", "20261009000000_b.sql"])).toHaveLength(1);
  });

  it("estruturas essenciais, funções RPC, constraints e RLS estão presentes", async () => {
    expect(checkEssentials(await local.snapshot())).toEqual([]);
  });

  it("o código só usa tabelas e funções que as migrações criam", async () => {
    const rows = await local.snapshot();
    const tables = new Set(rows.filter((r) => r.kind === "tabela").map((r) => r.name));
    const functions = new Set(rows.filter((r) => r.kind === "funcao").map((r) => r.name.split("(")[0]));
    expect(missingStructures(scanUsage(), tables, functions)).toEqual([]);
  });

  it("detecta o uso de tabela ou função que nenhuma migração cria", () => {
    const usage = { tables: new Map([["tabela_nova", ["server/x.ts"]]]), rpcs: new Map([["funcao_nova", ["server/y.ts"]]]) };
    const problems = missingStructures(usage, new Set(["inbox"]), new Set(["claim_inbox"]));
    expect(problems).toHaveLength(2);
    expect(scanSource('db.from("kv").select(); db.rpc("claim_inbox", {})')).toEqual({ tables: ["kv"], rpcs: ["claim_inbox"] });
  });

  it("a validação acusa estrutura essencial ausente", async () => {
    const rows = (await local.snapshot()).filter((r) => !(r.kind === "tabela" && r.name === "inbox"));
    expect(checkEssentials(rows).join(" ")).toContain("inbox");
  });
});

describe("regras de migração", () => {
  it("comando destrutivo exige a marcação de aprovação", () => {
    expect(findDestructive("drop table public.x;")).toContain("drop table");
    expect(findDestructive("alter table t drop column c;")).toContain("drop column");
    expect(findDestructive("delete from public.x;")).toContain("delete sem where");
    expect(findDestructive("delete from public.x where id = 1;")).toEqual([]);
    expect(findDestructive("-- drop table é só comentário\ncreate table a (id int);")).toEqual([]);
    expect(hasApprovalMark("-- destrutivo-aprovado: owner, remover tabela sem uso\ndrop table x;")).toBe(true);
    expect(hasApprovalMark("drop table x;")).toBe(false);
  });

  it("a consulta remota é somente leitura", () => {
    expect(() => assertReadOnly("select 1")).not.toThrow();
    expect(() => assertReadOnly("with a as (select 1) select * from a")).not.toThrow();
    expect(() => assertReadOnly("select 'delete' as palavra")).not.toThrow();
    expect(() => assertReadOnly("drop table inbox")).toThrow();
    expect(() => assertReadOnly("select 1; delete from inbox")).toThrow();
    expect(() => assertReadOnly("update inbox set status = 'x'")).toThrow();
  });
});

describe("detecção de divergência (drift)", () => {
  it("banco idêntico às migrações não tem divergência", async () => {
    const rows = await local.snapshot();
    const diff = diffSnapshots(rows, rows);
    expect(hasDrift(diff)).toBe(false);
    expect(formatDiff(diff)).toContain("Sem divergência");
  });

  it("alteração manual no banco vira relatório", async () => {
    const expected = await local.snapshot();
    const actual = expected
      .filter((r) => r.name !== "contacts")
      .map((r) => (r.kind === "coluna" && r.name === "inbox.status" ? { ...r, detail: r.detail + " default 'x'" } : r))
      .concat([{ kind: "tabela", name: "criada_na_mao", detail: "rls=false force=false" }]);
    const diff = diffSnapshots(expected, actual);
    expect(hasDrift(diff)).toBe(true);
    expect(diff.onlyActual.map((r) => r.name)).toContain("criada_na_mao");
    expect(diff.onlyExpected.map((r) => r.name)).toContain("contacts");
    expect(diff.changed.map((c) => c.name)).toContain("inbox.status");
    const report = formatDiff(diff);
    expect(report).toContain("criada_na_mao");
    expect(report).not.toMatch(/service_role_key|Bearer|token/i);
  });
});

describe("acesso: ninguém de fora lê o banco", () => {
  it("anon e authenticated não enxergam linhas das tabelas internas", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload) values ('text', 'owner', 'segredo')");
    for (const role of ["anon", "authenticated"]) {
      await local.db.exec(`set role ${role}`);
      try {
        expect(await q("select * from public.inbox")).toHaveLength(0);
        expect(await q("select * from public.group_messages")).toHaveLength(0);
        expect(await q("select * from public.contacts")).toHaveLength(0);
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
        await expect(q("select * from public.claim_inbox(1)")).rejects.toThrow(/permission denied/i);
        await expect(q("select public.purge_group_messages()")).rejects.toThrow(/permission denied/i);
      } finally {
        await local.db.exec("reset role");
      }
    }
  });

  it("is_owner é falso sem sessão", async () => {
    expect((await q("select public.is_owner() as v"))[0].v).toBe(false);
  });
});

describe("estruturas usadas pelos módulos (integração)", () => {
  it("fila inbox: claim_inbox reserva sem repetir e purge apaga o texto vencido", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload, key_id) values ('text','owner','a','k1'), ('text','owner','b','k2')");
    const first = await q("select * from public.claim_inbox(1)");
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("processando");
    const second = await q("select * from public.claim_inbox(10)");
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    await expect(local.db.exec("insert into public.inbox (kind, sender, key_id) values ('text','owner','k1')")).rejects.toThrow(/unique|duplicate/i);
    await local.db.exec("update public.inbox set expires_at = now() - interval '1 hour'");
    expect((await q("select public.purge_inbox_payloads() as n"))[0].n).toBe(2);
    await local.db.exec("delete from public.inbox");
  });

  it("agrupamento de mensagens: add_batch_item junta no mesmo lote", async () => {
    const a = (await q("select public.add_batch_item('dono', 1, 'oi', 15, 60) as id"))[0].id;
    const b = (await q("select public.add_batch_item('dono', 2, 'tudo bem', 15, 60) as id"))[0].id;
    expect(b).toBe(a);
    expect(await q("select seq from public.batch_items where batch_id = $1 order by seq", [a])).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(await q("select * from public.due_owner_batches()")).toHaveLength(0);
  });

  it("cota diária de imagens: claim respeita o limite e release devolve", async () => {
    expect((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok).toBe(true);
    expect((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok).toBe(true);
    expect((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok).toBe(false);
    await q("select public.release_image_quota('2026-10-09')");
    expect((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok).toBe(true);
  });

  it("agendamentos: claim_due_actions pega só o que venceu e uma vez", async () => {
    await local.db.exec(`insert into public.scheduled_actions (kind, group_jid, group_name, payload, run_at) values
      ('texto','1@g.us','G','{"text":"oi"}', now() - interval '1 minute'),
      ('texto','1@g.us','G','{"text":"depois"}', now() + interval '1 day')`);
    const due = await q("select * from public.claim_due_actions(5)");
    expect(due).toHaveLength(1);
    expect(due[0].status).toBe("running");
    expect(await q("select * from public.claim_due_actions(5)")).toHaveLength(0);
  });

  it("memória das conversas: reenvio da mesma mensagem é barrado e a limpeza apaga o antigo", async () => {
    await local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')");
    await expect(local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')")).rejects.toThrow(/unique|duplicate/i);
    await local.db.exec("insert into public.group_messages (conv, text, at) values ('g1','velho', now() - interval '8 days')");
    expect((await q("select public.purge_group_messages() as n"))[0].n).toBe(1);
  });

  it("aprovações e permissões: papel de pessoa só aceita os valores previstos (regressão do people_role_check)", async () => {
    await local.db.exec("insert into public.people (name, role) values ('Ana', 'equipe')");
    await expect(local.db.exec("insert into public.people (name, role) values ('Bia', 'membro')")).rejects.toThrow(/people_role_check/);
    expect((await q("select code from public.permission_catalog where code = 'mensagem.enviar'")).length).toBe(1);
    await expect(local.db.exec("insert into public.approvals (tool_name, status) values ('x', 'qualquer')")).rejects.toThrow(/check/i);
  });

  it("grupos e contatos: grupo cadastrado é único e a origem é validada", async () => {
    await local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Teste')");
    await expect(local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Outro')")).rejects.toThrow(/unique|duplicate|pkey/i);
    await expect(local.db.exec("insert into public.contacts (number, source) values ('5511999999999', 'invalida')")).rejects.toThrow(/check/i);
    await local.db.exec("insert into public.outreach (number, text) values ('5511999999999', 'oi')");
  });

  it("registro de atividade de grupo conta mensagens", async () => {
    await q("select public.record_group_activity('5@g.us', now())");
    await q("select public.record_group_activity('5@g.us', now())");
    expect((await q("select messages from public.group_activity where jid = '5@g.us'"))[0].messages).toBe(2);
  });

  it("base de conhecimento: busca híbrida devolve o trecho com a fonte", async () => {
    await local.db.exec("insert into public.knowledge_sources (slug, titulo, origem, checksum) values ('s1', 'Regras', 'CLAUDE.md', 'abc')");
    const vec = `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await local.db.exec(`insert into public.knowledge_chunks (source_id, ordem, secao, conteudo, embedding) values (1, 1, 'Aprovação', 'A aprovação vale para uma única ação', '${vec}')`);
    const rows = await q("select * from public.search_knowledge('aprovação ação', $1::extensions.vector, 3)", [vec]);
    expect(rows.length).toBeGreaterThan(0);
    expect(String(rows[0].titulo)).toBe("Regras");
  });

  it("roteamento multi-IA e Jev: saúde dos provedores e triagem aceitam os estados previstos", async () => {
    await local.db.exec("insert into public.provider_health (provider, state) values ('claude', 'healthy')");
    await expect(local.db.exec("insert into public.provider_health (provider, state) values ('codex', 'quebrado')")).rejects.toThrow(/check/i);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'agent_runs'")).map((r) => r.column_name);
    for (const c of ["tokens_in", "tokens_out"]) expect(cols).toContain(c);
    const jev = (await q("select column_name from information_schema.columns where table_name = 'jev_triage'")).map((r) => r.column_name);
    expect(jev).toContain("intencao");
  });
});
