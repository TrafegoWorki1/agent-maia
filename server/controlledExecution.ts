import type { Db } from "./store.ts";

export interface ControlledRequest { taskId?: number | null; sessionId?: string | null; requestedBy: string; kind: "browser" | "command"; cwd: string; network?: "disabled" | "allowlist"; timeoutMs: number; command?: string; enabled: boolean; approved: boolean }
export interface ControlledDecision { allowed: boolean; reason: string }

export function decideControlledExecution(input: ControlledRequest): ControlledDecision {
  if (!input.enabled) return { allowed: false, reason: "execução controlada está desabilitada por padrão" };
  if (!input.approved) return { allowed: false, reason: "esta ação exige aprovação pontual" };
  if (!input.cwd.trim() || input.cwd.includes("..")) return { allowed: false, reason: "diretório de trabalho inválido" };
  if (input.timeoutMs < 100 || input.timeoutMs > 600000) return { allowed: false, reason: "duração fora do limite" };
  if (input.kind === "command" && !input.command?.trim()) return { allowed: false, reason: "comando ausente" };
  return { allowed: true, reason: "pedido delimitado; ainda sujeito à política e à execução isolada" };
}

export async function recordControlledRun(db: Db, input: ControlledRequest, decision = decideControlledExecution(input)): Promise<string> {
  const { data, error } = await db.from("maia_controlled_runs").insert({ task_id: input.taskId ?? null, session_id: input.sessionId ?? null, requested_by: input.requestedBy, kind: input.kind, cwd: input.cwd, network: input.network ?? "disabled", timeout_ms: input.timeoutMs, status: decision.allowed ? "queued" : "blocked", command: input.command ?? null, evidence: { decision: decision.reason } }).select("id").single();
  if (error || !data) throw new Error(`Não consegui registrar execução controlada: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}
