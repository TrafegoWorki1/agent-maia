import { isReadTool } from "./maiaOwnerAgent.ts";
import type { TaskEventRow, TaskRow } from "./store.ts";

// Qualidade operacional da Maia, no mesmo contrato do Bryan (docs/indicadores.md), calculada só
// com eventos observados. Nunca preenche dimensão sem amostra com nota: sem amostra, fica null.

export const WEIGHTS = Object.freeze({
  velocidade: 0.2,
  precisaoConferencia: 0.25,
  proatividade: 0.15,
  gestaoRisco: 0.25,
  confiabilidadeTecnica: 0.1,
  comunicacao: 0.05,
});

export type Dimension = keyof typeof WEIGHTS;

export const DIMENSION_LABELS: Record<Dimension, string> = {
  velocidade: "Velocidade",
  precisaoConferencia: "Precisão e conferência",
  proatividade: "Proatividade",
  gestaoRisco: "Gestão de risco",
  confiabilidadeTecnica: "Confiabilidade técnica",
  comunicacao: "Comunicação",
};

const MIN_TASKS = 5;
const MIN_TERMINAL = 3;
const RESPONSE_LIMIT_MS = 120_000;
const CRITICAL_CAP = 3;
const TERMINAL = new Set(["concluida", "falhou", "incerta"]);

export interface ScorecardInput {
  tasks: TaskRow[];
  events: TaskEventRow[];
  chatRuns: { status: string }[];
  approvals: { status: string }[];
  from: string;
  to: string;
}

export interface Incident {
  taskId: number | null;
  operation: string | null;
  errorCode: string;
  timestamp: string;
}

export interface Scorecard {
  week: string;
  from: string;
  to: string;
  status: "calculado" | "dados insuficientes";
  overall: number | null;
  dimensions: Record<Dimension, number | null>;
  weights: typeof WEIGHTS;
  counts: { tasks: number; terminal: number; replied: number; failures: number; uncertain: number; verified: number; withoutEvidence: number };
  incidents: Incident[];
  criticalCap: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const score = (part: number, whole: number) => (whole > 0 ? round((10 * part) / whole) : null);

export function isoWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Intervalo UTC de uma semana ISO (segunda 00:00 até a próxima segunda).
export function isoWeekBounds(week: string): { from: string; to: string } {
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(week)) throw new Error("Semana ISO inválida");
  const [year, no] = week.split("-W").map(Number);
  const d = new Date(Date.UTC(year, 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + (no - 1) * 7);
  if (isoWeek(d) !== week) throw new Error("Semana ISO inexistente");
  return { from: d.toISOString(), to: new Date(d.getTime() + 7 * 86400000).toISOString() };
}

export function previousWeek(week: string): string {
  return isoWeek(new Date(Date.parse(isoWeekBounds(week).from) - 86400000));
}

// Regra de escrita: qualquer ferramenta fora das leituras precisa de aprovação registrada na tarefa.
function writeWithoutApproval(events: TaskEventRow[]): Incident[] {
  const byTask = new Map<number, TaskEventRow[]>();
  for (const event of events) byTask.set(event.task_id, [...(byTask.get(event.task_id) ?? []), event]);
  const incidents: Incident[] = [];
  for (const [taskId, list] of byTask) {
    const approved = list.some((e) => e.type === "approval_approved");
    for (const event of list) {
      if (event.type !== "tool_use" || !event.operation || isReadTool(event.operation)) continue;
      if (!approved) incidents.push({ taskId, operation: event.operation, errorCode: "APPROVAL_MISSING", timestamp: event.at });
    }
  }
  return incidents;
}

export function buildScorecard(input: ScorecardInput, week: string): Scorecard {
  const operational = input.tasks.filter((t) => t.kind === "operacional");
  const terminal = operational.filter((t) => TERMINAL.has(t.status));
  const replied = operational.filter((t) => t.replied_at);
  const withinLimit = replied.filter((t) => Date.parse(t.replied_at!) - Date.parse(t.created_at) <= RESPONSE_LIMIT_MS);

  const eventsOf = (type: string) => input.events.filter((e) => e.type === type);
  const verified = eventsOf("task_verified").length;
  const externalDone = eventsOf("external_done").length;
  // Avisos proativos (handoff) contam só quando a entrega foi confirmada (handoff_confirmed).
  const handoffs = eventsOf("handoff").length;
  const handoffsConfirmed = eventsOf("handoff_confirmed").length;
  const approvalsDecided = input.approvals.filter((a) => a.status === "approved" || a.status === "denied").length;
  const incidents = writeWithoutApproval(input.events);

  const failures = operational.filter((t) => t.status === "falhou").length;
  const uncertain = operational.filter((t) => t.status === "incerta").length;

  const dimensions: Record<Dimension, number | null> = {
    velocidade: score(withinLimit.length, replied.length),
    // Sem conferência registrada (task_verified) não há amostra: não se atribui nota.
    precisaoConferencia: externalDone > 0 ? score(verified, externalDone) : null,
    // Sem aviso proativo enviado não há amostra.
    proatividade: handoffs > 0 ? score(handoffsConfirmed, handoffs) : null,
    gestaoRisco: input.approvals.length > 0 ? score(approvalsDecided, input.approvals.length) : null,
    confiabilidadeTecnica: input.chatRuns.length > 0 ? score(input.chatRuns.filter((r) => r.status === "ok").length, input.chatRuns.length) : null,
    comunicacao: operational.length > 0 ? score(replied.length, operational.length) : null,
  };

  const sampleOk = operational.length >= MIN_TASKS && terminal.length >= MIN_TERMINAL;
  const allDimensions = Object.values(dimensions).every((v) => v !== null);
  let overall: number | null = null;
  if (sampleOk && allDimensions) {
    overall = 0;
    for (const dim of Object.keys(WEIGHTS) as Dimension[]) overall += (dimensions[dim] as number) * WEIGHTS[dim];
    overall = round(overall);
  }
  if (overall !== null && incidents.length > 0) overall = Math.min(overall, CRITICAL_CAP);

  return {
    week,
    from: input.from,
    to: input.to,
    status: overall === null ? "dados insuficientes" : "calculado",
    overall,
    dimensions,
    weights: WEIGHTS,
    counts: {
      tasks: operational.length,
      terminal: terminal.length,
      replied: replied.length,
      failures,
      uncertain,
      verified,
      withoutEvidence: externalDone - verified,
    },
    incidents,
    criticalCap: CRITICAL_CAP,
  };
}
