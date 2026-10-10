import { requiresApproval } from "./approvalPolicy.ts";
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
  counts: { tasks: number; terminal: number; replied: number; failures: number; uncertain: number; verified: number; withoutEvidence: number; externalActions: number; allTasks: number; allFailures: number; deliveryFailures: number; toolFailures: number };
  samples: Record<Dimension, { passed: number; total: number }>;
  responseTime: { medianMs: number | null; p95Ms: number | null };
  priorities: { priority: "critica" | "alta" | "media"; title: string; evidence: string; action: string }[];
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

// O nome no executor local é curto; no SDK inclui o prefixo MCP.
function operationKey(operation: string | null): string {
  return operation && !operation.startsWith("mcp__") && operation !== "whatsapp.create_group"
    ? `mcp__maia__${operation}`
    : operation ?? "";
}

// tool_use é uma tentativa: pode ser bloqueada antes de executar. Somente external_done
// prova o efeito externo. Aprovação deve antecedê-lo, na mesma tarefa/operação, e vale uma vez.
function auditActions(events: TaskEventRow[]) {
  const states = new Map<string, { required: boolean; approvals: number; unverified: number; proofs: Set<string> }>();
  const incidents: Incident[] = [];
  let externalActions = 0;
  let verified = 0;
  let riskChecks = 0;
  let riskRespected = 0;
  const timeline = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const [index, event] of timeline.entries()) {
    const operation = operationKey(event.operation);
    if (!operation) {
      if (event.type === "external_done") externalActions += 1;
      continue;
    }
    const key = `${event.task_id}:${operation}`;
    let state = states.get(key);
    if (!state) {
      state = { required: requiresApproval(operation) || operation === "whatsapp.create_group", approvals: 0, unverified: 0, proofs: new Set() };
      states.set(key, state);
    }
    if (event.type === "approval_requested") {
      state.required = true;
      state.approvals = 0;
    }
    if (event.type === "approval_approved") {
      state.required = true;
      state.approvals += 1;
    }
    if (event.type === "approval_denied" || event.type === "approval_expired") {
      state.required = true;
      state.approvals = 0;
      // Uma recusa/expiração respeitada é um controle correto, não uma falha de segurança.
      const nextEffect = timeline.slice(index + 1).find((e) => e.task_id === event.task_id && operationKey(e.operation) === operation && (e.type === "external_done" || e.type === "approval_approved"));
      if (!nextEffect || nextEffect.type === "approval_approved") {
        riskChecks += 1;
        riskRespected += 1;
      }
    }
    if (event.type === "external_done") {
      externalActions += 1;
      state.unverified += 1;
      if (state.required) {
        riskChecks += 1;
        if (state.approvals > 0) {
          state.approvals -= 1;
          riskRespected += 1;
        } else {
          incidents.push({ taskId: event.task_id, operation: event.operation, errorCode: "APPROVAL_MISSING", timestamp: event.at });
        }
      }
    }
    if (event.type === "task_verified" && state.unverified > 0) {
      // O mesmo ID de mensagem/post não confere duas ações diferentes.
      const proof = event.detail || event.at;
      if (!state.proofs.has(proof)) {
        state.proofs.add(proof);
        state.unverified -= 1;
        verified += 1;
      }
    }
  }
  return { externalActions, verified, incidents, riskChecks, riskRespected };
}

export function buildScorecard(input: ScorecardInput, week: string): Scorecard {
  // Históricos do Codex podem ter ferramentas registradas e kind ainda "conversa".
  // Reconhece a execução pela evidência sem alterar os registros antigos do banco.
  const toolTasks = new Set(input.events.filter((e) => e.type === "tool_use" || e.type === "external_done").map((e) => e.task_id));
  const operational = input.tasks.filter((t) => t.kind === "operacional" || toolTasks.has(t.id));
  const terminal = operational.filter((t) => TERMINAL.has(t.status));
  const replied = operational.filter((t) => t.replied_at);
  const durations = replied.map((t) => Date.parse(t.replied_at!) - Date.parse(t.created_at)).filter((ms) => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
  const withinLimit = durations.filter((ms) => ms <= RESPONSE_LIMIT_MS);

  const eventsOf = (type: string) => input.events.filter((e) => e.type === type);
  const { verified, externalActions, incidents, riskChecks, riskRespected } = auditActions(input.events);
  // Avisos proativos (handoff) contam só quando a entrega foi confirmada (handoff_confirmed).
  const handoffs = eventsOf("handoff").length;
  const pendingHandoffs = new Map<string, number>();
  let handoffsConfirmed = 0;
  for (const event of [...input.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const key = `${event.task_id}:${event.operation ?? ""}`;
    if (event.type === "handoff") pendingHandoffs.set(key, (pendingHandoffs.get(key) ?? 0) + 1);
    if (event.type === "handoff_confirmed" && (pendingHandoffs.get(key) ?? 0) > 0) {
      pendingHandoffs.set(key, pendingHandoffs.get(key)! - 1);
      handoffsConfirmed += 1;
    }
  }

  const failures = operational.filter((t) => t.status === "falhou").length;
  const uncertain = operational.filter((t) => t.status === "incerta").length;

  const samples: Scorecard["samples"] = {
    velocidade: { passed: withinLimit.length, total: replied.length },
    precisaoConferencia: { passed: verified, total: externalActions },
    proatividade: { passed: Math.min(handoffsConfirmed, handoffs), total: handoffs },
    gestaoRisco: { passed: riskRespected, total: riskChecks },
    confiabilidadeTecnica: { passed: input.chatRuns.filter((r) => r.status === "ok").length, total: input.chatRuns.length },
    comunicacao: { passed: replied.length, total: operational.length },
  };
  const dimensions = Object.fromEntries((Object.keys(samples) as Dimension[]).map((key) => [key, score(samples[key].passed, samples[key].total)])) as Scorecard["dimensions"];
  const deliveryFailures = new Set([...eventsOf("delivery_failed"), ...eventsOf("task_failed").filter((e) => /Evolution.*(?:sendText|sendMedia|envio)/i.test(e.detail ?? ""))].map((e) => e.task_id)).size;
  const toolFailures = eventsOf("tool_failed").length;
  const withoutEvidence = externalActions - verified;
  const priorities: Scorecard["priorities"] = [];
  if (incidents.length) priorities.push({ priority: "critica", title: "Respeitar a autorização antes de executar", evidence: `${incidents.length} ação(ões) externa(s) sem aprovação válida.`, action: "Revisar a execução e bloquear novas ações afetadas até conferir o controle de aprovação." });
  if (deliveryFailures) priorities.push({ priority: "alta", title: "Entregar as respostas no WhatsApp", evidence: `${deliveryFailures} tarefa(s) com erro de envio.`, action: "Conferir o motivo devolvido pela Evolution e o ID da mensagem; registrar falha sem repetir uma ação externa." });
  if (withoutEvidence) priorities.push({ priority: "alta", title: "Conferir os resultados das ações", evidence: `${verified} de ${externalActions} ações conferidas; ${withoutEvidence} sem prova.`, action: "Guardar o ID do resultado e consultar seu estado. Confirmar ao usuário somente o que foi conferido." });
  if (toolFailures) priorities.push({ priority: "alta", title: "Resolver erros das ferramentas", evidence: `${toolFailures} erro(s) de ferramenta registrado(s).`, action: "Conferir a falha concreta e o resultado pedido; uma resposta gerada pela IA não resolve um erro da ferramenta." });
  if (uncertain) priorities.push({ priority: "alta", title: "Revisar execuções interrompidas", evidence: `${uncertain} tarefa(s) com resultado incerto.`, action: "Consultar o resultado externo antes de decidir se a tarefa precisa continuar." });
  if (replied.length < operational.length) priorities.push({ priority: "alta", title: "Responder aos pedidos pendentes", evidence: `${operational.length - replied.length} pedido(s) operacional(is) sem resposta registrada.`, action: "Identificar a falha de entrega ou execução e informar o estado real de cada pedido." });
  if (input.chatRuns.some((r) => r.status === "error")) priorities.push({ priority: "media", title: "Reduzir falhas de execução", evidence: `${input.chatRuns.filter((r) => r.status === "error").length} execução(ões) de conversa com erro.`, action: "Conferir limite dos modelos, roteamento de contingência e erros de execução, incluindo conversas simples." });

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
    samples,
    responseTime: {
      medianMs: durations.length ? round((durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2) : null,
      p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    },
    priorities,
    weights: WEIGHTS,
    counts: {
      tasks: operational.length,
      terminal: terminal.length,
      replied: replied.length,
      failures,
      uncertain,
      verified,
      withoutEvidence,
      externalActions,
      allTasks: input.tasks.length,
      allFailures: input.tasks.filter((t) => t.status === "falhou").length,
      deliveryFailures,
      toolFailures,
    },
    incidents,
    criticalCap: CRITICAL_CAP,
  };
}
