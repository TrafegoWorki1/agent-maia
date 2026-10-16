import { samePhone } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

// Planos de várias etapas do dono (tabela maia_plans). O plano sai das palavras do dono, não de um roteiro fixo no código:
// a Maia o grava com plano_criar e marca com plano_atualizar o que a próxima etapa espera. Quando o evento acontece
// (aprovação concluída, alguém entra no grupo), o worker chama a Maia de volta com o plano e o resultado da etapa anterior.

export type Waiting =
  | { type: "approval"; id: number }
  | { type: "member_joined"; jid: string; number?: string }
  | { type: "file_received"; jid: string; number?: string }
  | { type: "time"; at: string };

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
  if (waiting.type === "time" && trigger.type === "time") return waiting.at === trigger.at;
  if ((waiting.type === "member_joined" && trigger.type === "member_joined") || (waiting.type === "file_received" && trigger.type === "file_received")) {
    if (waiting.jid !== trigger.jid) return false;
    return !waiting.number || (!!trigger.number && samePhone(waiting.number, trigger.number));
  }
  return false;
}

export function describeWaiting(waiting: Waiting | null): string {
  if (!waiting) return "nada (a etapa seguinte pode seguir)";
  if (waiting.type === "approval") return `o OK do pedido de aprovação #${waiting.id}`;
  if (waiting.type === "time") return `o horário ${waiting.at}`;
  if (waiting.type === "file_received") return `um arquivo enviado no grupo${waiting.number ? ` por +${waiting.number}` : ""}`;
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
    "Siga o plano: execute a PRÓXIMA etapa pendente, dentro do que o dono pediu, sem pular etapa nem trocar por outro caminho. Ao terminar, marque o que foi feito com plano_atualizar (e, se a próxima etapa depender de um evento, diga o que esperar). Se você NÃO conseguir cumprir a etapa (sem permissão, sem acesso, sem como fazer), diga ao dono com clareza que isso não é permitido ou possível agora e o que é preciso para conseguir (qual permissão, quem aprova, o que ele precisa enviar ou avisar). Se faltar informação ou algo fugir do que o dono pediu, pergunte a ele em vez de supor. Responda ao dono em poucas linhas.",
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
  if (patch.waiting?.type === "time") {
    const target = Date.parse(patch.waiting.at);
    if (!Number.isFinite(target) || target <= Date.now()) return { ok: false, error: "o horário precisa ser ISO válido e futuro" };
    if (target > Date.parse(plan.created_at) + PLAN_MAX_AGE_MS) return { ok: false, error: "o horário precisa ocorrer antes do limite de sete dias do plano" };
  }
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
export async function claimWaiting(db: Db, trigger: Waiting, now = Date.now(), eventKey = JSON.stringify(trigger)): Promise<Plan[]> {
  const claimed: Plan[] = [];
  for (const plan of await activePlans(db)) {
    if (!matchesWaiting(plan.waiting, trigger)) continue;
    const stale = now - Date.parse(plan.created_at) > PLAN_MAX_AGE_MS;
    if (stale) {
      await db.from("maia_plans").update({ waiting: null, status: "cancelled", updated_at: new Date(now).toISOString() }).eq("id", plan.id).eq("status", "active").eq("waiting", plan.waiting);
      continue;
    }
    const { data, error } = await db.rpc("claim_maia_waiting_plan", { p_plan_id: plan.id, p_waiting: plan.waiting, p_event_key: eventKey, p_event_at: new Date(now).toISOString() });
    if (error) throw new Error(`Reserva do plano #${plan.id}: ${error.message}`);
    if (!data) continue;
    claimed.push(plan);
  }
  return claimed;
}

// Retoma os planos que esperavam o evento. `resume` chama a Maia (handleOwnerMessage). Devolve quantos foram retomados.
export async function resumePlans(db: Db, trigger: Waiting, happened: string, extraContext: Record<string, unknown>, resume: (prompt: string) => Promise<unknown>, eventKey = JSON.stringify(trigger), eventAt = new Date()): Promise<number> {
  const plans = await claimWaiting(db, trigger, eventAt.getTime(), eventKey);
  for (const plan of plans) {
    const context = { ...plan.context, ...extraContext };
    await db.from("maia_plans").update({ context }).eq("id", plan.id);
    try {
      const task = await resume(resumePrompt({ ...plan, context }, happened));
      await db.from("maia_plan_resumptions").update({ status: "dispatched", task_id: typeof task === "number" ? task : null, updated_at: new Date().toISOString() }).eq("plan_id", plan.id).eq("event_key", eventKey).eq("status", "leased");
    } catch (error) {
      await db.from("maia_plan_resumptions").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("plan_id", plan.id).eq("event_key", eventKey).eq("status", "leased");
      throw error;
    }
  }
  return plans.length;
}

// O evento não vai acontecer (aprovação recusada ou expirada): cancela os planos que o esperavam.
export async function cancelWaiting(db: Db, trigger: Waiting): Promise<Plan[]> {
  const plans = await claimWaiting(db, trigger);
  for (const plan of plans) {
    await db.from("maia_plans").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", plan.id);
    await db.from("maia_plan_resumptions").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("plan_id", plan.id).eq("event_key", JSON.stringify(trigger));
  }
  return plans;
}

export async function recoverUncertainPlanResumptions(db: Db, olderThan = new Date(Date.now() - 10 * 60_000)): Promise<number> {
  const { data, error } = await db.from("maia_plan_resumptions").update({ status: "uncertain", updated_at: new Date().toISOString() }).eq("status", "leased").lt("created_at", olderThan.toISOString()).select("id");
  if (error) throw new Error(`Recuperação de planos indisponível: ${error.message}`);
  return (data ?? []).length;
}

export async function setWaiting(db: Db, planId: number, waiting: Waiting): Promise<void> {
  await db.from("maia_plans").update({ waiting, updated_at: new Date().toISOString() }).eq("id", planId).eq("status", "active");
}

// Algum plano ativo espera um arquivo deste grupo (e deste número)? Só então vale baixar e ler o arquivo: o que nenhum
// plano espera continua ignorado, como antes.
export async function waitingForFile(db: Db, jid: string, number: string): Promise<boolean> {
  return (await activePlans(db)).some((plan) => matchesWaiting(plan.waiting, { type: "file_received", jid, number }));
}

export async function runDuePlanTimers(db: Db, resume: (prompt: string) => Promise<unknown>, now = new Date()): Promise<number> {
  const due = (await activePlans(db)).filter((plan): plan is Plan & { waiting: { type: "time"; at: string } } => plan.waiting?.type === "time" && Date.parse(plan.waiting.at) <= now.getTime());
  let count = 0;
  for (const plan of due) {
    const trigger = plan.waiting;
    const eventKey = `timer:${plan.id}:${trigger.at}`;
    count += await resumePlans(db, trigger, `o horário combinado (${trigger.at}) chegou.`, { horario: { at: trigger.at } }, resume, eventKey, now);
  }
  return count;
}
