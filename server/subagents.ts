import type { Db } from "./store.ts";
import { addTaskEvent, setTaskStatus } from "./store.ts";

export interface SubagentLimits { maxConcurrent: number; maxDepth: number; maxSeconds: number; maxSteps: number }
export interface SubagentSpec { objective: string; context: Record<string, unknown>; allowedTools: string[]; kind?: "research" | "analysis" | "review"; parentTaskId?: number | null; parentSessionId?: string | null; parentAgentId?: string | null; depth?: number; limits?: Partial<SubagentLimits> }
export const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = { maxConcurrent: 3, maxDepth: 1, maxSeconds: 300, maxSteps: 20 };

export function normalizeSubagentLimits(input: Partial<SubagentLimits> = {}): SubagentLimits {
  return { maxConcurrent: Math.max(1, Math.min(input.maxConcurrent ?? 3, 8)), maxDepth: Math.max(1, Math.min(input.maxDepth ?? 1, 3)), maxSeconds: Math.max(1, Math.min(input.maxSeconds ?? 300, 1800)), maxSteps: Math.max(1, Math.min(input.maxSteps ?? 20, 100)) };
}

export async function createSubagent(db: Db, spec: SubagentSpec): Promise<string> {
  const limits = normalizeSubagentLimits(spec.limits);
  const depth = spec.depth ?? 1;
  if (depth > limits.maxDepth) throw new Error("Profundidade máxima de delegação atingida.");
  if (spec.allowedTools.length) throw new Error("Subagentes iniciais são isolados e não recebem ferramentas.");
  const { data, error } = await db.from("maia_subagents").insert({ objective: spec.objective.trim().slice(0, 4000), context: spec.context, allowed_tools: [], kind: spec.kind ?? "analysis", parent_task_id: spec.parentTaskId ?? null, parent_session_id: spec.parentSessionId ?? null, parent_agent_id: spec.parentAgentId ?? null, depth, max_steps: limits.maxSteps, max_seconds: limits.maxSeconds }).select("id").single();
  if (error || !data) throw new Error(`Não consegui criar subagente: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}

export async function runSupervisedSubagent<T>(db: Db, id: string, run: () => Promise<{ result: T; evidence?: Record<string, unknown>; usage?: Record<string, unknown> }>, maxConcurrent = 3): Promise<T> {
  const leased = await db.rpc("claim_maia_subagent", { p_id: id, p_max_concurrent: maxConcurrent });
  if (leased.error) throw new Error(`Não consegui reservar subagente: ${leased.error.message}`);
  if (!leased.data) throw new Error("Subagente não está disponível para execução.");
  try {
    const out = await run();
    const saved = await db.from("maia_subagents").update({ status: "awaiting_review", result: JSON.stringify(out.result).slice(0, 16000), evidence: out.evidence ?? {}, usage: out.usage ?? {}, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "running").select("id");
    if (saved.error || !saved.data?.length) throw new Error("Subagente cancelado ou alterado; resultado não foi declarado concluído.");
    return out.result;
  } catch (error) {
    await db.from("maia_subagents").update({ status: "failed", result: error instanceof Error ? error.message.slice(0, 16000) : String(error).slice(0, 16000), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
    throw error;
  }
}

export async function reviewSubagentResult(db: Db, id: string, approved: boolean, note: string): Promise<boolean> {
  const { data, error } = await db.from("maia_subagents").update({ status: approved ? "completed" : "failed", review_note: note.slice(0, 2000), reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "awaiting_review").select("id");
  if (error) throw new Error(`Revisão do subagente indisponível: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function cancelSubagent(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("maia_subagents").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "running", "awaiting_review"]).select("id");
  if (error) throw new Error(`Não consegui cancelar subagente: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function recoverInterruptedSubagents(db: Db): Promise<number> {
  const { data, error } = await db.from("maia_subagents").update({ status: "interrupted", updated_at: new Date().toISOString() }).eq("status", "running").select("id");
  if (error) throw new Error(`Recuperação de subagentes indisponível: ${error.message}`);
  return (data ?? []).length;
}

export interface QueuedSubagent { id: string; parent_task_id: number; objective: string; context: Record<string, unknown>; kind: string; max_seconds: number; allowed_tools: string[] }

export async function runQueuedSubagents(db: Db, generate: (prompt: string, timeoutMs: number) => Promise<{ text: string; durationMs: number }>, maxConcurrent = 3): Promise<number> {
  const { data, error } = await db.from("maia_subagents").select("id,parent_task_id,objective,context,kind,max_seconds,allowed_tools").eq("status", "queued").order("created_at").limit(maxConcurrent);
  if (error) throw new Error(`Fila de subagentes indisponível: ${error.message}`);
  const jobs = ((data ?? []) as QueuedSubagent[]).filter((job) => job.parent_task_id && job.allowed_tools.length === 0);
  await Promise.all(jobs.map(async (job) => {
    try {
      const result = await runSupervisedSubagent(db, job.id, async () => {
        const response = await generate(`Subagente ${job.kind}. Analise apenas o objetivo e o contexto fornecido. Não há ferramentas, internet, arquivos ou acesso a outros clientes. Separe fatos de hipóteses, declare limites, não alegue efeitos externos.\nObjetivo: ${job.objective}\nContexto mínimo: ${JSON.stringify(job.context)}`, Math.min(job.max_seconds * 1000, 300000));
        return { result: response.text, usage: { duration_ms: response.durationMs, cost_usd: null, tokens: null }, evidence: { source: "provided_context_only" } };
      }, maxConcurrent);
      const review = await generate(`Você é o coordenador revisor. Confira se a resposta atende ao objetivo, distingue fatos de hipóteses e não declara ações sem prova. Devolva JSON estrito {"approved":boolean,"note":string}.\nObjetivo: ${job.objective}\nResposta do subagente: ${result}`, 60000);
      const decision = JSON.parse(review.text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { approved?: unknown; note?: unknown };
      if (typeof decision.approved !== "boolean" || typeof decision.note !== "string") throw new Error("Revisão inválida; exige inspeção humana.");
      await reviewSubagentResult(db, job.id, decision.approved, decision.note);
    } catch (cause) {
      console.error("[subagente]", job.id, cause instanceof Error ? cause.message : cause);
    }
  }));
  return jobs.length;
}

export async function consolidateDelegations(db: Db, generate: (prompt: string, timeoutMs: number) => Promise<{ text: string; durationMs: number }>): Promise<number> {
  const { data, error } = await db.from("maia_subagents").select("parent_task_id,objective,result,status,review_note").not("parent_task_id", "is", null).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Delegações indisponíveis: ${error.message}`);
  const grouped = new Map<number, typeof data>();
  for (const row of data ?? []) grouped.set(Number(row.parent_task_id), [...(grouped.get(Number(row.parent_task_id)) ?? []), row]);
  let complete = 0;
  for (const [taskId, children] of grouped) {
    if (!children?.length || children.some((row) => !["completed", "failed", "cancelled", "interrupted"].includes(row.status))) continue;
    const task = await db.from("tasks").select("status").eq("id", taskId).maybeSingle();
    if (task.error || task.data?.status !== "recebida") continue;
    const response = await generate(`Você é o coordenador. Consolide resultados independentes sem esconder falhas, sem declarar ações externas e com limites explícitos.\n${children.map((row) => `Objetivo: ${row.objective}\nEstado: ${row.status}\nResultado: ${row.result ?? "sem resultado"}\nRevisão: ${row.review_note ?? "não revisado"}`).join("\n---\n")}`, 60000);
    await addTaskEvent(db, taskId, "delegation_summary", "subagents", response.text.slice(0, 16000));
    await setTaskStatus(db, taskId, "concluida");
    complete += 1;
  }
  return complete;
}
