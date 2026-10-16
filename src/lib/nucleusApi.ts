import { supabase } from "./supabaseBrowser";

export interface NucleusData { sessions: Array<{ id: string; channel: string; conversation_key: string; scope_kind: string; status: string; title: string; updated_at: string; last_message_at: string | null }>; skills: Array<{ id: string; slug: string; version: string; description: string; status: string; approved_at: string | null }>; plans: Array<{ id: number; title: string; status: string; updated_at: string }>; subagents: Array<{ id: string; objective: string; status: string; created_at: string; updated_at: string; result: string | null }>; schedules: Array<{ id: string; instruction: string; schedule_kind: string; schedule_value: string; timezone: string; destination: string; status: string; next_run_at: string | null }>; mcp: Array<{ id: string; name: string; transport: string; status: string; allowed_tools: string[]; updated_at: string }> }

export async function nucleusRequest(): Promise<NucleusData> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/nucleus", { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await response.json() as NucleusData & { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.error === "nucleus_migration_pending" ? "A migration do núcleo ainda não foi aplicada neste ambiente." : body.detail ?? body.error ?? `Falha HTTP ${response.status}`);
  return body;
}
