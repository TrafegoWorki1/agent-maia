import type { Db } from "./store.ts";

export interface SubagentLimits { maxConcurrent: number; maxDepth: number; maxSeconds: number; maxSteps: number }
export interface SubagentSpec { objective: string; context: Record<string, unknown>; allowedTools: string[]; parentTaskId?: number | null; parentSessionId?: string | null; depth?: number; limits?: Partial<SubagentLimits> }

export const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = { maxConcurrent: 3, maxDepth: 1, maxSeconds: 300, maxSteps: 20 };

export function normalizeSubagentLimits(input: Partial<SubagentLimits> = {}): SubagentLimits {
  return { maxConcurrent: Math.max(1, Math.min(input.maxConcurrent ?? DEFAULT_SUBAGENT_LIMITS.maxConcurrent, 8)), maxDepth: Math.max(1, Math.min(input.maxDepth ?? DEFAULT_SUBAGENT_LIMITS.maxDepth, 3)), maxSeconds: Math.max(1, Math.min(input.maxSeconds ?? DEFAULT_SUBAGENT_LIMITS.maxSeconds, 1800)), maxSteps: Math.max(1, Math.min(input.maxSteps ?? DEFAULT_SUBAGENT_LIMITS.maxSteps, 100)) };
}

export async function createSubagent(db: Db, spec: SubagentSpec): Promise<string> {
  const limits = normalizeSubagentLimits(spec.limits);
  const depth = spec.depth ?? 1;
  if (depth > limits.maxDepth) throw new Error("Delegação recusada: profundidade máxima atingida.");
  const { count } = await db.from("maia_subagents").select("id", { count: "exact", head: true }).eq("status", "running").eq("parent_task_id", spec.parentTaskId ?? -1);
  if ((count ?? 0) >= limits.maxConcurrent) throw new Error("Delegação aguardando: limite de concorrência atingido.");
  const { data, error } = await db.from("maia_subagents").insert({ objective: spec.objective.trim().slice(0, 4000), context: spec.context, allowed_tools: spec.allowedTools, parent_task_id: spec.parentTaskId ?? null, parent_session_id: spec.parentSessionId ?? null, depth, max_steps: limits.maxSteps, max_seconds: limits.maxSeconds }).select("id").single();
  if (error || !data) throw new Error(`Não consegui criar subagente: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}

export async function runSupervisedSubagent<T>(db: Db, id: string, run: () => Promise<{ result: T; evidence?: Record<string, unknown>; usage?: Record<string, unknown> }>): Promise<T> {
  const leased = await db.from("maia_subagents").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "queued").select("id");
  if (leased.error) throw new Error(`Não consegui iniciar subagente: ${leased.error.message}`);
  if (!leased.data?.length) throw new Error("Subagente não está disponível para execução.");
  try {
    const out = await run();
    await db.from("maia_subagents").update({ status: "completed", result: JSON.stringify(out.result).slice(0, 16000), evidence: out.evidence ?? {}, usage: out.usage ?? {}, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
    return out.result;
  } catch (error) {
    await db.from("maia_subagents").update({ status: "failed", result: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "running");
    throw error;
  }
}

export async function cancelSubagent(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("maia_subagents").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).in("status", ["queued", "running"]).select("id");
  if (error) throw new Error(`Não consegui cancelar subagente: ${error.message}`);
  return (data ?? []).length === 1;
}
