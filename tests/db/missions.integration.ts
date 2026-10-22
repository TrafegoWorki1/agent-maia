import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { LocalDb } from "../../scripts/db/local.ts";
import { temporarySupabase } from "../helpers/temporarySupabase.ts";
import { controlMission, getMission, routeMissionMessage, type Authority, type MissionDecision } from "../../server/missions.ts";
import { runMission, runMissionCycle, type MissionPorts } from "../../server/missionRuntime.ts";
import { canonicalPhone } from "../../server/evolutionWebhook.ts";

export function registerMissionTests(local: () => LocalDb) {
  const q = async (sql: string, args: unknown[] = []) => (await local().db.query<Record<string, any>>(sql, args)).rows;
  let serial = 0;
  const future = () => { const date = new Date(Date.now() + 86400_000); date.setUTCMinutes(0, 0, 0); return date.toISOString(); };
  async function seed(kind = "conversation", extra: Partial<Authority> = {}) {
    const contact = `55859888${String(++serial).padStart(5, "0")}`;
    const authority: Authority = { owner: "5585999990000", contact, contactName: `Teste ${serial}`, conversation: `dm:${canonicalPhone(contact)}`, objective: "Combinar o pedido", ...extra };
    const row = (await q("insert into maia_plans(title,kind,authority,request,mission_state,expires_at) values('Missão teste',$1,$2::jsonb,'Pedido direto de teste','working',now()+interval '1 day') returning id", [kind, JSON.stringify(authority)]))[0];
    return getMission(temporarySupabase(local()), Number(row.id));
  }
  function ports(decisions: MissionDecision[]) {
    const calls: Array<{ to: string; text: string }> = [];
    let created = 0, last: any;
    const p: MissionPorts = {
      async decide() { const d = decisions.shift(); assert.ok(d, "modelo simulado recebeu turno inesperado"); return d; },
      async send(to, text) { calls.push({ to, text }); return `wa-${randomUUID()}`; },
      async group(to, text) { calls.push({ to, text }); return `group-${randomUUID()}`; },
      calendar: { async busy() { return []; }, async create(input, guard) { await guard(); created++; last = { id: `event-${randomUUID()}`, start: input.start, end: input.end, link: "https://calendar.google.com/test", location: input.location }; return last; }, async read() { return last; } },
    };
    return { p, calls, get created() { return created; } };
  }
  async function inbound(m: Awaited<ReturnType<typeof seed>>, key: string, text: string) {
    const db = temporarySupabase(local());
    assert.equal(await routeMissionMessage(db, { conversation: m.authority.conversation, participant: m.authority.contact, key, text, at: new Date().toISOString() }), true);
    return Number((await q("select id from maia_mission_events where plan_id=$1 and event_key=$2", [m.id, key]))[0].id);
  }
  describe("missões: integração com Postgres e serviços simulados", () => {
    it("negocia em turnos, agenda, confere e resume uma única vez", async () => {
      const start = future(), end = new Date(Date.parse(start) + 3 * 3600_000).toISOString();
      const m = await seed("meeting", { meeting: { calendar: "primary", timezone: "America/Sao_Paulo", durationMinutes: 45, windows: [{ start, end }], location: "Escritório", inviteByEmail: false } });
      const db = temporarySupabase(local()), fake = ports([{ action: "reply", text: "Sou a Maia. Qual horário prefere?" }]);
      await runMission(db, m.id, fake.p);
      assert.equal((await getMission(db, m.id)).mission_state, "waiting_external");
      const event = await inbound(m, "accept", "Aceito o primeiro horário");
      fake.p.decide = async () => ({ action: "schedule", start, acceptanceEvent: event });
      await runMission(db, m.id, fake.p);
      assert.equal((await getMission(db, m.id)).status, "done");
      assert.equal(fake.created, 1);
      const receipts = await q("select kind,state from maia_mission_effects where plan_id=$1", [m.id]);
      assert.equal(receipts.filter(e => e.kind === "calendar" && e.state === "confirmed").length, 1);
      assert.equal(await runMission(db, m.id, fake.p), false);
      // Entrega pendente de resumo recuperada em outro ciclo/processo.
      await q("update maia_plans set mission_state='paused' where kind<>'general' and status='active'");
      await runMissionCycle(db, fake.p);
      const before = fake.calls.length;
      await runMissionCycle(db, fake.p);
      assert.equal(fake.calls.length, before);
      assert.ok(fake.calls.some(c => c.to === m.authority.owner && c.text.includes("conferido")));
    });
    it("roteia número canônico, ignora antigo/outro autor e deduplica pela mensagem", async () => {
      const db = temporarySupabase(local()), m = await seed();
      await inbound(m, "key", "resposta"); await inbound(m, "key", "duplicata");
      assert.equal((await q("select * from maia_mission_events where plan_id=$1", [m.id])).length, 1);
      const input = { conversation: m.authority.conversation, participant: m.authority.contact, key: "old", text: "antigo", at: "2000-01-01T00:00:00Z" };
      assert.equal(await routeMissionMessage(db, input), true);
      assert.equal(await routeMissionMessage(db, { ...input, participant: "5585999996666" }), false);
      assert.equal((await q("select * from maia_mission_events where plan_id=$1", [m.id])).length, 1);
    });
    it("pausa durante a decisão impede envio e não é sobrescrita pelo executor", async () => {
      const db = temporarySupabase(local()), m = await seed(), fake = ports([]);
      fake.p.decide = async () => { await controlMission(db, m.id, m.revision, "pause"); return { action: "reply", text: "não deve sair" }; };
      await runMission(db, m.id, fake.p);
      assert.equal(fake.calls.length, 0);
      assert.equal((await getMission(db, m.id)).mission_state, "paused");
      await inbound(m, "paused", "Ainda estou aqui");
      assert.equal(await runMission(db, m.id, fake.p), false);
    });
    it("erro após tentativa de envio não repete após retomada/reinício", async () => {
      const db = temporarySupabase(local()), m = await seed(), fake = ports([{ action: "reply", text: "Olá" }]);
      let sends = 0;
      fake.p.send = async () => { sends++; throw new Error("rede caiu após enviar"); };
      await runMission(db, m.id, fake.p);
      assert.equal((await getMission(db, m.id)).mission_state, "waiting_owner");
      await assert.rejects(controlMission(db, m.id, m.revision, "resume"), /incerto/);
      await runMission(db, m.id, fake.p);
      assert.equal(sends, 1);
    });
    it("duas reservas concorrentes de execução só concedem uma lease", async () => {
      const db = temporarySupabase(local()), m = await seed();
      const results = await Promise.all([db.rpc("claim_maia_mission", { p_id: m.id, p_token: randomUUID() }), db.rpc("claim_maia_mission", { p_id: m.id, p_token: randomUUID() })]);
      assert.equal(results.filter(r => r.data && r.data.id).length, 1);
      await q("update maia_plans set lease_until=now()-interval '1 minute' where id=$1", [m.id]);
      const result = await db.rpc("claim_maia_mission", { p_id: m.id, p_token: randomUUID() });
      assert.equal(result.data, null);
      assert.equal((await getMission(db, m.id)).mission_state, "waiting_owner");
    });
    it("impede duas negociações na mesma conversa e duas reservas no mesmo calendário", async () => {
      const m = await seed();
      await assert.rejects(q("insert into maia_plans(title,kind,authority) values('duplicada','conversation',$1)", [JSON.stringify(m.authority)]), /unique/);
      const second = await seed(), token1 = randomUUID(), token2 = randomUUID();
      await q("select claim_maia_mission($1,$2)", [m.id, token1]); await q("select claim_maia_mission($1,$2)", [second.id, token2]);
      const start = future(), end = new Date(Date.parse(start) + 3600_000).toISOString();
      assert.equal((await q("select reserve_maia_mission_slot($1,1,$2,'concurrency',$3,$4) as ok", [m.id, token1, start, end]))[0].ok, true);
      assert.equal((await q("select reserve_maia_mission_slot($1,1,$2,'concurrency',$3,$4) as ok", [second.id, token2, start, end]))[0].ok, false);
    });
    it("ação condicional usa somente grupo, texto e menções persistidos", async () => {
      await q("insert into maia_groups(jid,name,active) values('mission-test@g.us','Teste de missão',true)");
      const m = await seed("group_action", { group: { jid: "mission-test@g.us", name: "Teste de missão", text: "Aviso autorizado", mentions: ["5585999991111"], everyone: false } });
      const event = await inbound(m, "condition", "Pode avisar a equipe"), fake = ports([{ action: "complete", summary: "Equipe avisada", evidenceEvent: event }]);
      await runMission(temporarySupabase(local()), m.id, fake.p);
      assert.deepEqual(fake.calls, [{ to: "mission-test@g.us", text: "Aviso autorizado" }]);
      assert.equal((await getMission(temporarySupabase(local()), m.id)).status, "done");
    });
    it("SAIR encerra sem chamar o modelo ou enviar outra mensagem", async () => {
      const m = await seed(), fake = ports([]), db = temporarySupabase(local());
      await inbound(m, "stop", "SAIR"); await runMission(db, m.id, fake.p);
      assert.equal((await getMission(db, m.id)).status, "cancelled");
      assert.equal(fake.calls.length, 0);
    });
    it("rejeita revisão obsoleta e não deixa plano_atualizar concluir missão", async () => {
      const db = temporarySupabase(local()), m = await seed();
      await controlMission(db, m.id, 1, "pause");
      await assert.rejects(controlMission(db, m.id, 1, "cancel"), /mudou/);
      const { updatePlan } = await import("../../server/plans.ts");
      assert.equal((await updatePlan(db, m.id, { status: "done" })).ok, false);
    });
    it("RLS e funções internas não concedem acesso anônimo", async () => {
      const rows = await q("select has_table_privilege('anon','maia_mission_events','SELECT') as events, has_function_privilege('authenticated','claim_maia_mission(bigint,uuid)','EXECUTE') as claim");
      assert.equal(rows[0].events, false); assert.equal(rows[0].claim, false);
    });
  });
}
