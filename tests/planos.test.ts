import { describe, expect, it, vi } from "vitest";
import { cancelWaiting, claimWaiting, createPlan, describeWaiting, expireStalePlans, matchesWaiting, resumePlans, resumePrompt, runDuePlanTimers, setWaiting, updatePlan, waitingForFile, PLAN_MAX_AGE_MS } from "../server/plans.ts";
import { notifyGroupJoin } from "../server/groupJoin.ts";
import { runPlanUpdate } from "../server/planTools.ts";
import type { Db } from "../server/store.ts";

// Decisão do owner (13/10/2026): um pedido com várias etapas vira um plano gravado; as etapas que dependem de um evento
// (OK da criação do grupo, alguém entrar no grupo) retomam sozinhas, dentro do que o dono pediu.
type Row = Record<string, any>;

function memoryDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { maia_plans: [], maia_groups: [], contacts: [], ...seed };
  let nextId = 1;
  const db = {
    async rpc(name: string, args: Record<string, any>) {
      if (name !== "claim_maia_waiting_plan") return { data: null, error: { message: "rpc desconhecida" } };
      const plan = tables.maia_plans.find((r) => r.id === args.p_plan_id && r.status === "active" && JSON.stringify(r.waiting) === JSON.stringify(args.p_waiting));
      if (!plan || Date.parse(plan.created_at) > Date.parse(args.p_event_at) || Date.parse(args.p_event_at) - Date.parse(plan.created_at) > PLAN_MAX_AGE_MS) return { data: false, error: null };
      const events = tables.maia_plan_resumptions ?? (tables.maia_plan_resumptions = []);
      if (events.some((r) => r.plan_id === plan.id && r.event_key === args.p_event_key)) return { data: false, error: null };
      events.push({ plan_id: plan.id, event_key: args.p_event_key, status: "leased" });
      plan.waiting = null;
      return { data: true, error: null };
    },
    from(table: string) {
      const rows = tables[table] ?? (tables[table] = []);
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row = {};
      let wantRows = false;
      const run = (): { data: Row[]; error: null } => {
        if (op === "insert") {
          const row = { id: nextId++, created_at: new Date().toISOString(), status: "active", waiting: null, context: {}, steps: [], request: "", ...payload };
          rows.push(row);
          return { data: [row], error: null };
        }
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "update") hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      };
      const q: any = {
        select: () => { wantRows = true; return q; },
        insert: (p: Row) => { op = "insert"; payload = p; return q; },
        update: (p: Row) => { op = "update"; payload = p; return q; },
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        not: (c: string, _is: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
        order: () => q,
        single: async () => { const r = run(); return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "sem linha" } }; },
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      void wantRows;
      return q;
    },
  } as unknown as Db;
  return { db, tables };
}

const STEPS = ["Criar o grupo Projeto Italo", "Mandar o link ao Italo no privado", "Dar boas-vindas quando ele entrar"];

describe("gatilhos do plano", () => {
  it("aprovação casa só com o mesmo número de pedido", () => {
    expect(matchesWaiting({ type: "approval", id: 10 }, { type: "approval", id: 10 })).toBe(true);
    expect(matchesWaiting({ type: "approval", id: 10 }, { type: "approval", id: 11 })).toBe(false);
    expect(matchesWaiting(null, { type: "approval", id: 10 })).toBe(false);
  });

  it("entrada no grupo casa pelo grupo e, se houver, pelo número (com ou sem o nono dígito)", () => {
    const waiting = { type: "member_joined", jid: "g1@g.us", number: "5585991872784" } as const;
    expect(matchesWaiting(waiting, { type: "member_joined", jid: "g1@g.us", number: "558591872784" })).toBe(true);
    expect(matchesWaiting(waiting, { type: "member_joined", jid: "g1@g.us", number: "5585988888888" })).toBe(false);
    expect(matchesWaiting(waiting, { type: "member_joined", jid: "g1@g.us" })).toBe(false);
    expect(matchesWaiting(waiting, { type: "member_joined", jid: "g2@g.us", number: "5585991872784" })).toBe(false);
    expect(matchesWaiting({ type: "member_joined", jid: "g1@g.us" }, { type: "member_joined", jid: "g1@g.us", number: "5585988888888" })).toBe(true);
  });

  it("horário retoma uma vez quando vence e não antecipa eventos futuros", async () => {
    const { db } = memoryDb();
    const id = await createPlan(db, { title: "Retomar amanhã", request: "continue", steps: STEPS });
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    await setWaiting(db, id, { type: "time", at: dueAt });
    const resume = vi.fn(async (_prompt: string) => {});
    expect(await runDuePlanTimers(db, resume, new Date(Date.now() + 30_000))).toBe(0);
    expect(await runDuePlanTimers(db, resume, new Date(Date.now() + 90_000))).toBe(1);
    expect(await runDuePlanTimers(db, resume, new Date(Date.now() + 120_000))).toBe(0);
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe("plano de várias etapas", () => {
  it("valida a espera por horário e não aceita fora da validade do plano", async () => {
    const { db, tables } = memoryDb();
    const id = await createPlan(db, { title: "Retomada", request: "", steps: STEPS });
    const valid = await runPlanUpdate(db, { plano: id, esperar: { tipo: "horario", instante: new Date(Date.now() + 60_000).toISOString() } });
    expect(valid.ok).toBe(true);
    expect(tables.maia_plans[0].waiting.type).toBe("time");
    const expired = await runPlanUpdate(db, { plano: id, esperar: { tipo: "horario", instante: new Date(Date.now() + 8 * 24 * 3600_000).toISOString() } });
    expect(expired.ok).toBe(false);
  });

  it("retoma uma vez só quando o OK chega, com o pedido, as etapas e o grupo criado no texto", async () => {
    const { db } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "crie o grupo e mande o link", steps: STEPS });
    await setWaiting(db, id, { type: "approval", id: 10 });
    const resume = vi.fn(async (_p: string) => {});
    expect(await resumePlans(db, { type: "approval", id: 10 }, 'o grupo "Projeto Italo" foi criado (jid g1@g.us).', { grupo: { jid: "g1@g.us" } }, resume)).toBe(1);
    const prompt = resume.mock.calls[0][0];
    expect(prompt).toContain(`plano #${id}`);
    expect(prompt).toContain("crie o grupo e mande o link");
    expect(prompt).toContain("1. [ ] Criar o grupo Projeto Italo");
    expect(prompt).toContain("g1@g.us");
    // evento repetido não executa a mesma etapa duas vezes
    expect(await resumePlans(db, { type: "approval", id: 10 }, "de novo", {}, resume)).toBe(0);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("não retoma plano que espera outro pedido de aprovação", async () => {
    const { db } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "", steps: STEPS });
    await setWaiting(db, id, { type: "approval", id: 10 });
    const resume = vi.fn(async (_p: string) => {});
    expect(await resumePlans(db, { type: "approval", id: 99 }, "x", {}, resume)).toBe(0);
    expect(resume).not.toHaveBeenCalled();
  });

  it("recusa ou expiração cancelam o plano que esperava", async () => {
    const { db, tables } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "", steps: STEPS });
    await setWaiting(db, id, { type: "approval", id: 10 });
    const cancelled = await cancelWaiting(db, { type: "approval", id: 10 });
    expect(cancelled.map((p) => p.id)).toEqual([id]);
    expect(tables.maia_plans[0].status).toBe("cancelled");
  });

  it("plano parado há mais de 7 dias é cancelado em vez de retomar", async () => {
    const { db, tables } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "", steps: STEPS });
    await setWaiting(db, id, { type: "approval", id: 10 });
    const claimed = await claimWaiting(db, { type: "approval", id: 10 }, Date.now() + PLAN_MAX_AGE_MS + 1000);
    expect(claimed).toEqual([]);
    expect(tables.maia_plans[0].status).toBe("cancelled");
  });

  it("vence sem gatilho, gera aviso uma vez e não retoma automaticamente", async () => {
    const old = new Date(Date.now() - PLAN_MAX_AGE_MS - 1000).toISOString();
    const { db, tables } = memoryDb({ maia_plans: [{ id: 9, created_at: old, title: "Antigo", request: "x", steps: [{ text: "primeira", done: true }, { text: "segunda", done: false }], status: "active", waiting: { type: "approval", id: 2 }, context: {} }] });
    const first = await expireStalePlans(db, new Date());
    expect(first).toEqual([{ id: 9, title: "Antigo", waiting: "o OK do pedido de aprovação #2", lastCompletedStep: "primeira" }]);
    expect(tables.maia_plans[0].status).toBe("cancelled");
    expect(await expireStalePlans(db, new Date())).toEqual([]);
  });

  it("marcar todas as etapas conclui o plano; etapa fora do plano é recusada", async () => {
    const { db } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "", steps: STEPS });
    expect((await updatePlan(db, id, { doneSteps: [9] })).ok).toBe(false);
    const partial = await updatePlan(db, id, { doneSteps: [1, 2] });
    expect(partial.ok && partial.plan.status).toBe("active");
    const done = await updatePlan(db, id, { doneSteps: [3] });
    expect(done.ok && done.plan.status).toBe("done");
  });

  it("o texto da retomada manda a Maia seguir a próxima etapa e perguntar se faltar algo", () => {
    const text = resumePrompt({ id: 4, created_at: "", title: "T", request: "p", steps: [{ text: "a", done: true }, { text: "b", done: false }], status: "active", waiting: null, context: {} }, "algo aconteceu");
    expect(text).toContain("PRÓXIMA etapa pendente");
    expect(text).toContain("não é permitido ou possível agora e o que é preciso para conseguir");
    expect(text).toContain("pergunte a ele em vez de supor");
    expect(text).toContain("Não é uma mensagem nova do dono");
  });
});

describe("entrada no grupo retoma o plano", () => {
  const groupRow = { jid: "g1@g.us", name: "Projeto Italo", active: true };

  it("com plano esperando a entrada, retoma o plano e não pergunta sobre boas-vindas", async () => {
    const { db } = memoryDb({ maia_groups: [groupRow], contacts: [{ number: "5585991872784", name: "Ítalo", aliases: [] }] });
    const id = await createPlan(db, { title: "Projeto Italo", request: "boas-vindas quando ele entrar", steps: STEPS });
    await setWaiting(db, id, { type: "member_joined", jid: "g1@g.us", number: "5585991872784" });
    const notify = vi.fn(async (_t: string) => {});
    const resume = vi.fn(async (_p: string) => {});
    process.env.EVOLUTION_OWNER_NUMBER = "5511988886666";
    expect(await notifyGroupJoin(db, { jid: "g1@g.us", action: "add", participants: ["5585991872784"] }, notify, resume)).toBe(0);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume.mock.calls[0][0]).toContain("Ítalo (+5585991872784) entrou no grupo");
    expect(notify).not.toHaveBeenCalled();
  });

  it("sem plano esperando, só avisa o dono e pergunta", async () => {
    const { db } = memoryDb({ maia_groups: [groupRow] });
    const notify = vi.fn(async (_t: string) => {});
    const resume = vi.fn(async (_p: string) => {});
    process.env.EVOLUTION_OWNER_NUMBER = "5511988886666";
    expect(await notifyGroupJoin(db, { jid: "g1@g.us", action: "add", participants: ["5585991872784"] }, notify, resume)).toBe(1);
    expect(resume).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toContain("Quer que eu dê as boas-vindas?");
  });
});

describe("arquivo enviado no grupo", () => {
  it("o gatilho de arquivo casa pelo grupo e pelo número, e não se confunde com entrada no grupo", () => {
    const waiting = { type: "file_received", jid: "g1@g.us", number: "5585991872784" } as const;
    expect(matchesWaiting(waiting, { type: "file_received", jid: "g1@g.us", number: "558591872784" })).toBe(true);
    expect(matchesWaiting(waiting, { type: "file_received", jid: "g1@g.us", number: "5585988888888" })).toBe(false);
    expect(matchesWaiting(waiting, { type: "file_received", jid: "g2@g.us", number: "5585991872784" })).toBe(false);
    expect(matchesWaiting(waiting, { type: "member_joined", jid: "g1@g.us", number: "5585991872784" })).toBe(false);
    expect(describeWaiting(waiting)).toContain("arquivo enviado no grupo");
  });

  it("só vale baixar o arquivo quando um plano ativo espera um arquivo daquele grupo e daquele número", async () => {
    const { db } = memoryDb();
    expect(await waitingForFile(db, "g1@g.us", "5585991872784")).toBe(false);
    const id = await createPlan(db, { title: "Projeto Italo", request: "", steps: STEPS });
    await setWaiting(db, id, { type: "file_received", jid: "g1@g.us", number: "5585991872784" });
    expect(await waitingForFile(db, "g1@g.us", "5585991872784")).toBe(true);
    expect(await waitingForFile(db, "g1@g.us", "5585988888888")).toBe(false);
    expect(await waitingForFile(db, "g2@g.us", "5585991872784")).toBe(false);
  });

  it("o arquivo retoma o plano uma vez, com o conteúdo no texto", async () => {
    const { db } = memoryDb();
    const id = await createPlan(db, { title: "Projeto Italo", request: "ler o PDF e sugerir melhorias", steps: STEPS });
    await setWaiting(db, id, { type: "file_received", jid: "g1@g.us", number: "5585991872784" });
    const resume = vi.fn(async (_p: string) => {});
    expect(await resumePlans(db, { type: "file_received", jid: "g1@g.us", number: "5585991872784" }, "Ítalo enviou um arquivo: [conteúdo do PDF]", { arquivo: { nome: "produto.pdf" } }, resume)).toBe(1);
    expect(resume.mock.calls[0][0]).toContain("conteúdo do PDF");
    expect(await resumePlans(db, { type: "file_received", jid: "g1@g.us", number: "5585991872784" }, "de novo", {}, resume)).toBe(0);
  });
});
