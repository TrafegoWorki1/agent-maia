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

  it("gestão de risco considera aprovações decididas; expiradas reduzem a nota", () => {
    const card = buildScorecard(input([task(1)], [], { approvals: [{ status: "approved" }, { status: "expired" }] }), WEEK);
    expect(card.dimensions.gestaoRisco).toBe(5);
  });

  it("escrita sem aprovação vira incidente crítico e limita a nota a 3", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task(i));
    const events = [
      ev(1, "tool_use", "mcp__claude_ai_Gmail__send_message"),
      ev(2, "external_done"), ev(2, "task_verified"),
      ev(3, "handoff"), ev(3, "handoff_confirmed"),
      ...[4, 5].map((i) => ev(i, "tool_use", "mcp__claude_ai_Gmail__search_threads")),
    ];
    const card = buildScorecard(input(tasks, events, { chatRuns: [{ status: "ok" }], approvals: [{ status: "approved" }] }), WEEK);
    expect(card.incidents).toHaveLength(1);
    expect(card.incidents[0].errorCode).toBe("APPROVAL_MISSING");
    expect(card.overall === null || card.overall <= 3).toBe(true);
  });

  it("escrita com aprovação registrada não gera incidente", () => {
    const events = [ev(1, "approval_approved", "mcp__claude_ai_Gmail__send_message"), ev(1, "tool_use", "mcp__claude_ai_Gmail__send_message")];
    const card = buildScorecard(input([task(1)], events), WEEK);
    expect(card.incidents).toHaveLength(0);
  });

  it("conversa leve (sem ferramenta) não entra na amostra operacional", () => {
    const conversas = [1, 2, 3, 4, 5].map((i) => task(i, { kind: "conversa" }));
    const card = buildScorecard(input(conversas), WEEK);
    expect(card.counts.tasks).toBe(0);
    expect(card.status).toBe("dados insuficientes");
  });
});
