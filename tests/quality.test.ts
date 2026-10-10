import { describe, expect, it } from "vitest";
import { buildScorecard, isoWeek, isoWeekBounds, previousWeek } from "../server/quality.ts";
import type { TaskEventRow, TaskRow } from "../server/store.ts";

const WEEK = "2026-W41";
const FROM = isoWeekBounds(WEEK).from;
const TO = isoWeekBounds(WEEK).to;
const base = Date.parse(FROM) + 3600_000;

function task(id: number, overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    created_at: new Date(base + id * 1000).toISOString(),
    channel: "whatsapp",
    kind: "operacional",
    summary: "pedido",
    status: "concluida",
    started_at: null,
    replied_at: new Date(base + id * 1000 + 20_000).toISOString(),
    finished_at: null,
    error: null,
    ...overrides,
  };
}

function ev(taskId: number, type: string, operation: string | null = null, at = base): TaskEventRow {
  return { task_id: taskId, at: new Date(at).toISOString(), type, operation, detail: null };
}

const input = (tasks: TaskRow[], events: TaskEventRow[] = [], extra: { chatRuns?: { status: string }[]; approvals?: { status: string }[] } = {}) => ({
  tasks,
  events,
  chatRuns: extra.chatRuns ?? [],
  approvals: extra.approvals ?? [],
  from: FROM,
  to: TO,
});

describe("semana ISO", () => {
  it("calcula os limites e a semana anterior", () => {
    expect(isoWeek(new Date("2026-10-08T12:00:00Z"))).toBe("2026-W41");
    expect(isoWeekBounds("2026-W41").from).toBe("2026-10-05T00:00:00.000Z");
    expect(previousWeek("2026-W41")).toBe("2026-W40");
  });

  it("rejeita semana inválida", () => {
    expect(() => isoWeekBounds("2026-W54")).toThrow();
  });
});

describe("nota da semana", () => {
  it("sem amostra mínima, não atribui nota e mostra as dimensões que têm dado", () => {
    const card = buildScorecard(input([task(1), task(2)]), WEEK);
    expect(card.status).toBe("dados insuficientes");
    expect(card.overall).toBeNull();
    expect(card.dimensions.velocidade).toBe(10);
    expect(card.dimensions.comunicacao).toBe(10);
    expect(card.dimensions.proatividade).toBeNull();
  });

  it("sem conferência registrada, precisão fica sem amostra e a nota geral não é preenchida", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task(i));
    const card = buildScorecard(input(tasks), WEEK);
    expect(card.dimensions.precisaoConferencia).toBeNull();
    expect(card.overall).toBeNull();
  });

  it("precisão = ações externas conferidas sobre ações externas feitas", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task(i));
    const card = buildScorecard(input(tasks, [ev(1, "external_done", "x"), ev(1, "external_done", "y"), ev(1, "task_verified", "x")]), WEEK);
    expect(card.dimensions.precisaoConferencia).toBe(5);
  });

  it("velocidade conta respostas em até 120 s", () => {
    const fast = task(1);
    const slow = task(2, { replied_at: new Date(base + 2 * 1000 + 200_000).toISOString() });
    const card = buildScorecard(input([fast, slow]), WEEK);
    expect(card.dimensions.velocidade).toBe(5);
  });

  it("aprovação expirada sem execução é controle respeitado", () => {
    const events = [ev(1, "tool_use", "mcp__maia__instagram_publicar"), ev(1, "approval_requested", "mcp__maia__instagram_publicar"), ev(1, "approval_expired", "mcp__maia__instagram_publicar")];
    const card = buildScorecard(input([task(1)], events, { approvals: [{ status: "expired" }] }), WEEK);
    expect(card.dimensions.gestaoRisco).toBe(10);
    expect(card.incidents).toHaveLength(0);
  });

  it("escrita sem aprovação vira incidente crítico e limita a nota a 3", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task(i));
    const events = [
      ev(1, "tool_use", "mcp__maia__instagram_publicar"),
      ev(1, "external_done", "instagram_publicar"), ev(1, "task_verified", "instagram_publicar"),
      ev(2, "external_done", "x"), ev(2, "task_verified", "x"),
      ev(3, "handoff"), ev(3, "handoff_confirmed"),
      ...[4, 5].map((i) => ev(i, "tool_use", "mcp__claude_ai_Gmail__search_threads")),
    ];
    const card = buildScorecard(input(tasks, events, { chatRuns: [{ status: "ok" }], approvals: [{ status: "approved" }] }), WEEK);
    expect(card.incidents).toHaveLength(1);
    expect(card.incidents[0].errorCode).toBe("APPROVAL_MISSING");
    expect(card.overall).toBe(3);
  });

  it("escrita com aprovação registrada não gera incidente", () => {
    const events = [ev(1, "approval_approved", "mcp__maia__instagram_publicar"), ev(1, "tool_use", "mcp__maia__instagram_publicar"), ev(1, "external_done", "instagram_publicar")];
    const card = buildScorecard(input([task(1)], events), WEEK);
    expect(card.incidents).toHaveLength(0);
  });

  it("conversa leve (sem ferramenta) não entra na amostra operacional", () => {
    const conversas = [1, 2, 3, 4, 5].map((i) => task(i, { kind: "conversa" }));
    const card = buildScorecard(input(conversas), WEEK);
    expect(card.counts.tasks).toBe(0);
    expect(card.status).toBe("dados insuficientes");
  });

  it("tentativa bloqueada não se transforma em incidente crítico", () => {
    const events = [ev(1, "tool_use", "mcp__maia__instagram_publicar"), ev(1, "access_denied", "mcp__maia__instagram_publicar")];
    expect(buildScorecard(input([task(1)], events), WEEK).incidents).toHaveLength(0);
  });

  it("aprovação de outra operação ou posterior à execução não autoriza o efeito", () => {
    for (const events of [
      [ev(1, "approval_approved", "whatsapp.create_group"), ev(1, "external_done", "instagram_publicar")],
      [ev(1, "external_done", "instagram_publicar", base), ev(1, "approval_approved", "mcp__maia__instagram_publicar", base + 1000)],
    ]) expect(buildScorecard(input([task(1)], events), WEEK).incidents).toHaveLength(1);
  });

  it("aprovação vale uma vez e é revogada por recusa ou expiração", () => {
    const operation = "mcp__maia__instagram_publicar";
    const events = [ev(1, "approval_approved", operation), ev(1, "external_done", "instagram_publicar"), ev(1, "external_done", "instagram_publicar")];
    expect(buildScorecard(input([task(1)], events), WEEK).incidents).toHaveLength(1);
    for (const outcome of ["approval_denied", "approval_expired"]) {
      const revoked = [ev(1, "approval_approved", operation), ev(1, outcome, operation), ev(1, "external_done", "instagram_publicar")];
      const card = buildScorecard(input([task(1)], revoked), WEEK);
      expect(card.incidents).toHaveLength(1);
      expect(card.dimensions.gestaoRisco).toBe(0);
    }
  });

  it("controle dinâmico de grupo não cadastrado também exige aprovação", () => {
    const events = [ev(1, "approval_requested", "mcp__maia__grupo_enviar_texto"), ev(1, "external_done", "grupo_enviar_texto")];
    expect(buildScorecard(input([task(1)], events), WEEK).incidents).toHaveLength(1);
  });
  it("novo pedido de aprovação não reutiliza autorização de uma ação anterior", () => {
    const operation = "mcp__maia__instagram_publicar";
    const events = [ev(1, "approval_approved", operation), ev(1, "approval_requested", operation), ev(1, "external_done", "instagram_publicar")];
    expect(buildScorecard(input([task(1)], events), WEEK).incidents).toHaveLength(1);
  });

  it("conferência precisa da mesma tarefa, operação e ordem", () => {
    const events = [ev(1, "task_verified", "x"), ev(1, "external_done", "x"), ev(2, "task_verified", "x"), ev(1, "task_verified", "y")];
    const card = buildScorecard(input([task(1), task(2)], events), WEEK);
    expect(card.counts.verified).toBe(0);
    expect(card.counts.withoutEvidence).toBe(1);
  });

  it("prova repetida não infla a nota nem confere duas mensagens", () => {
    const proof = { ...ev(1, "task_verified", "contato_enviar_mensagem"), detail: "mensagem abc" };
    const events = [ev(1, "external_done", "contato_enviar_mensagem"), ev(1, "external_done", "contato_enviar_mensagem"), proof, { ...proof }, { ...proof }];
    const card = buildScorecard(input([task(1)], events), WEEK);
    expect(card.counts.verified).toBe(1);
    expect(card.counts.withoutEvidence).toBe(1);
    expect(card.dimensions.precisaoConferencia).toBe(5);
  });

  it("confirmação proativa de outra tarefa não mascara uma entrega ausente", () => {
    const events = [ev(1, "handoff", "resumo"), ev(2, "handoff_confirmed", "resumo")];
    expect(buildScorecard(input([task(1), task(2)], events), WEEK).dimensions.proatividade).toBe(0);
  });

  it("recupera a amostra histórica do Codex sem excluir falhas de conversa", () => {
    const tasks = [task(1, { kind: "conversa", status: "falhou", replied_at: null }), task(2, { kind: "conversa", status: "falhou", replied_at: null })];
    const events = [ev(1, "tool_use", "mcp__maia__buscar_conhecimento"), { ...ev(1, "task_failed"), detail: "Evolution sendText falhou: HTTP 400" }];
    const card = buildScorecard(input(tasks, events), WEEK);
    expect(card.counts.tasks).toBe(1);
    expect(card.counts.failures).toBe(1);
    expect(card.counts.allFailures).toBe(2);
    expect(card.counts.deliveryFailures).toBe(1);
    expect(card.priorities[0].title).toBe("Entregar as respostas no WhatsApp");
  });

  it("mede mediana e p95 sem aceitar tempo negativo como resposta rápida", () => {
    const times = [10, 20, 30, 200];
    const tasks = times.map((seconds, i) => task(i + 1, { replied_at: new Date(base + (i + 1) * 1000 + seconds * 1000).toISOString() }));
    tasks.push(task(5, { replied_at: new Date(base).toISOString() }));
    const card = buildScorecard(input(tasks), WEEK);
    expect(card.responseTime).toEqual({ medianMs: 25000, p95Ms: 200000 });
    expect(card.samples.velocidade).toEqual({ passed: 3, total: 5 });
  });
  it("erro de ferramenta continua visível mesmo com execução encerrada e resposta", () => {
    const card = buildScorecard(input([task(1)], [ev(1, "tool_failed", "mcp__maia__grupo_enviar_texto")]), WEEK);
    expect(card.counts.failures).toBe(0);
    expect(card.counts.toolFailures).toBe(1);
    expect(card.priorities.some((p) => p.title === "Resolver erros das ferramentas")).toBe(true);
  });
});
