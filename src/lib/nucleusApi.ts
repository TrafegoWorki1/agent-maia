import { supabase } from "./supabaseBrowser";

export interface MissionPlan { id: number; title: string; status: string; updated_at: string; kind?: string; mission_state?: string; revision?: number; expires_at?: string; interaction_count?: number; max_interactions?: number; context?: Record<string, unknown>; mission_notice?: string | null }
export interface MissionEvidence { id: number; plan_id: number; kind: string; state: string; evidence: Record<string, unknown> | null; created_at: string }
export interface NucleusData { sessions: Array<{ id: string; channel: string; conversation_key: string; scope_kind: string; status: string; title: string; updated_at: string; last_message_at: string | null }>; skills: Array<{ id: string; slug: string; version: string; description: string; status: string; approved_at: string | null }>; plans: MissionPlan[]; missionEffects?: MissionEvidence[]; subagents: Array<{ id: string; objective: string; status: string; created_at: string; updated_at: string; result: string | null }>; delegationSummaries: Array<{ task_id: number; at: string; detail: string | null }>; schedules: Array<{ id: string; instruction: string; schedule_kind: string; schedule_value: string; timezone: string; destination: string; status: string; next_run_at: string | null }>; mcp: Array<{ id: string; name: string; transport: string; status: string; allowed_tools: string[]; updated_at: string }> }

export async function nucleusRequest(): Promise<NucleusData> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/nucleus", { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await response.json() as NucleusData & { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.error === "nucleus_migration_pending" ? "A migration do núcleo ainda não foi aplicada neste ambiente." : body.detail ?? body.error ?? `Falha HTTP ${response.status}`);
  return body;
}

export type NucleusCommand = { action: "mission_control"; id: number; revision: number; operation: "pause" | "resume" | "cancel" | "correct"; note?: string } | { action: "skill_activate"; id: string } | { action: "schedule_create"; instruction: string; kind: "once" | "interval" | "cron"; value: string; timezone?: string } | { action: "schedule_edit"; id: string; instruction: string; kind: "once" | "interval" | "cron"; value: string; timezone?: string } | { action: "schedule_status"; id: string; status: "active" | "paused" | "cancelled" } | { action: "session_new"; channel: "whatsapp" | "painel" } | { action: "delegate"; kind: "research" | "analysis" | "review"; objectives: string[]; context: string } | { action: "subagent_cancel"; id: string } | { action: "subagent_review"; id: string; approved: boolean; note: string };

export async function searchNucleusSession(id: string, channel: "whatsapp" | "painel", query: string): Promise<Array<{ id: number; at: string; author: string; text: string; source: string }>> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error("Faça login como owner.");
  const response = await fetch("/api/nucleus", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "session_search", id, channel, query }) });
  const body = await response.json() as { result?: Array<{ id: number; at: string; author: string; text: string; source: string }>; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Falha HTTP ${response.status}`);
  return body.result ?? [];
}

export async function nucleusCommand(command: NucleusCommand): Promise<void> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw new Error("Faça login como owner.");
  const response = await fetch("/api/nucleus", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(command) });
  const body = await response.json() as { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail ?? body.error ?? `Falha HTTP ${response.status}`);
}
