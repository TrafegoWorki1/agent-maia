import { samePhone } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

// Planos de várias etapas do dono (tabela maia_plans). O plano sai das palavras do dono, não de um roteiro fixo no código:
// a Maia o grava com plano_criar e marca com plano_atualizar o que a próxima etapa espera. Quando o evento acontece
// (aprovação concluída, alguém entra no grupo), o worker chama a Maia de volta com o plano e o resultado da etapa anterior.

export type Waiting =
  | { type: "approval"; id: number }
  | { type: "member_joined"; jid: string; number?: string };

export interface PlanStep {
  text: string;
  done: boolean;
}

export interface Plan {
  id: number;
  created_at: string;
  title: string;
  request: string;
  steps: PlanStep[];
  status: "active" | "done" | "cancelled";
  waiting: Waiting | null;
  context: Record<string, unknown>;
}

// Plano parado há mais que isso não retoma sozinho: o pedido pode já não valer.
export const PLAN_MAX_AGE_MS = 7 * 24 * 3600_000;

export function matchesWaiting(waiting: Waiting | null, trigger: Waiting): boolean {
  if (!waiting || waiting.type !== trigger.type) return false;
  if (waiting.type === "approval" && trigger.type === "approval") return waiting.id === trigger.id;
  if (waiting.type === "member_joined" && trigger.type === "member_joined") {
    if (waiting.jid !== trigger.jid) return false;
    return !waiting.number || !trigger.number || samePhone(waiting.number, trigger.number);
  }
  return false;
}

export function describeWaiting(waiting: Waiting | null): string {
  if (!waiting) return "nada (a etapa seguinte pode seguir)";
  if (waiting.type === "approval") return `o OK do pedido de aprovação #${waiting.id}`;
  return `alguém entrar no grupo${waiting.number ? ` (+${waiting.number})` : ""}`;
}

export function formatSteps(steps: PlanStep[]): string {
  return steps.map((step, index) => `${index + 1}. [${step.done ? "x" : " "}] ${step.text}`).join("\n");
}

// Texto que a Maia recebe ao retomar um plano. O que aconteceu é fato do sistema; o plano e o pedido são do dono.
export function resumePrompt(plan: Plan, happened: string): string {
  const context = Object.keys(plan.context).length ? `\nDados do plano: ${JSON.stringify(plan.context)}` : "";
  return [
    `[Continuação do plano #${plan.id} "${plan.title}". Não é uma mensagem nova do dono: o sistema retomou o plano porque a etapa anterior terminou.]`,
    plan.request ? `Pedido original do dono: "${plan.request}"` : "",
    `Etapas:\n${formatSteps(plan.steps)}${context}`,
    `O que acabou de acontecer: ${happened}`,
    "Execute a PRÓXIMA etapa pendente, dentro do que o dono pediu. Ao terminar, marque o que foi feito com plano_atualizar (e, se a próxima etapa depender de um evento, diga o que esperar). Se faltar informação ou algo fugir do que o dono pediu, pergunte a ele em vez de supor. Responda ao dono em poucas linhas.",
  ].filter(Boolean).join("\n");
}

const asPlan = (row: Record<string, unknown>): Plan => ({
  id: Number(row.id),
  created_at: String(row.created_at),
  title: String(row.title),
  request: String(row.request ?? ""),
  steps: Array.isArray(row.steps) ? (row.steps as PlanStep[]) : [],
  status: row.status as Plan["status"],
  waiting: (row.waiting as Waiting | null) ?? null,
  context: (row.context as Record<string, unknown>) ?? {},
});

export async function createPlan(db: Db, input: { title: string; request: string; steps: string[]; taskId?: number | null }): Promise<number> {
  const { data, error } = await db
    .from("maia_plans")
    .insert({ title: input.title.trim().slice(0, 120), request: input.request.slice(0, 4000), steps: input.steps.map((text) => ({ text: text.trim().slice(0, 300), done: false })), task_id: input.taskId ?? null })
    .select("id")
    .single();
  if (error || !data) throw new Error(`plano: ${error?.message ?? "sem retorno"}`);
  return Number(data.id);
}

export async function getPlan(db: Db, id: number): Promise<Plan | null> {
  const { data } = await db.from("maia_plans").select("*").eq("id", id).maybeSingle();
  return data ? asPlan(data as Record<string, unknown>) : null;
}

export async function activePlans(db: Db): Promise<Plan[]> {
  const { data } = await db.from("maia_plans").select("*").eq("status", "active").order("id", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map(asPlan);
}

export interface PlanPatch {
  doneSteps?: number[];
  waiting?: Waiting | null;
  note?: string;
  status?: "done" | "cancelled";
  context?: Record<string, unknown>;
}

export async function updatePlan(db: Db, id: number, patch: PlanPatch): Promise<{ ok: true; plan: Plan } | { ok: false; error: string }> {
  const plan = await getPlan(db, id);
  if (!plan) return { ok: false, error: `não existe o plano #${id}` };
  if (plan.status !== "active") return { ok: false, error: `o plano #${id} já está ${plan.status === "done" ? "concluído" : "cancelado"}` };
  const steps = plan.steps.map((step, index) => (patch.doneSteps?.includes(index + 1) ? { ...step, done: true } : step));
  if (patch.doneSteps?.some((n) => n < 1 || n > plan.steps.length)) return { ok: false, error: `etapa fora do plano (o plano tem ${plan.steps.length})` };
  const context = { ...plan.context, ...(patch.context ?? {}), ...(patch.note ? { nota: patch.note.slice(0, 500) } : {}) };
  const status = patch.status ?? (steps.length > 0 && steps.every((s) => s.done) && patch.waiting === undefined ? "done" : "active");
  const update: Record<string, unknown> = { steps, context, status, updated_at: new Date().toISOString() };
  if (patch.waiting !== undefined) update.waiting = status === "active" ? patch.waiting : null;
  if (status !== "active") update.waiting = null;
  const { data, error } = await db.from("maia_plans").update(update).eq("id", id).select("*").single();
  if (error || !data) return { ok: false, error: `plano: ${error?.message ?? "sem retorno"}` };
  return { ok: true, plan: asPlan(data as Record<string, unknown>) };
}

// Planos ativos que esperam exatamente este evento. Cada plano é reservado (waiting vira nulo) antes de retomar, então um
// evento repetido não executa a mesma etapa duas vezes.
export async function claimWaiting(db: Db, trigger: Waiting, now = Date.now()): Promise<Plan[]> {
  const claimed: Plan[] = [];
  for (const plan of await activePlans(db)) {
    if (!matchesWaiting(plan.waiting, trigger)) continue;
    const stale = now - Date.parse(plan.created_at) > PLAN_MAX_AGE_MS;
    const { data } = await db
      .from("maia_plans")
      .update({ waiting: null, status: stale ? "cancelled" : "active", updated_at: new Date(now).toISOString() })
      .eq("id", plan.id)
      .not("waiting", "is", null)
      .select("id");
    if (!data || data.length === 0 || stale) continue;
    claimed.push(plan);
  }
  return claimed;
}

// Retoma os planos que esperavam o evento. `resume` chama a Maia (handleOwnerMessage). Devolve quantos foram retomados.
export async function resumePlans(db: Db, trigger: Waiting, happened: string, extraContext: Record<string, unknown>, resume: (prompt: string) => Promise<unknown>): Promise<number> {
  const plans = await claimWaiting(db, trigger);
  for (const plan of plans) {
    const context = { ...plan.context, ...extraContext };
    await db.from("maia_plans").update({ context }).eq("id", plan.id);
    await resume(resumePrompt({ ...plan, context }, happened));
  }
  return plans.length;
}

// O evento não vai acontecer (aprovação recusada ou expirada): cancela os planos que o esperavam.
export async function cancelWaiting(db: Db, trigger: Waiting): Promise<Plan[]> {
  const plans = await claimWaiting(db, trigger);
  for (const plan of plans) await db.from("maia_plans").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", plan.id);
  return plans;
}

export async function setWaiting(db: Db, planId: number, waiting: Waiting): Promise<void> {
  await db.from("maia_plans").update({ waiting, updated_at: new Date().toISOString() }).eq("id", planId).eq("status", "active");
}
