import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./store.ts";
import { json } from "./workspaceApi.ts";

export async function handleNucleus(req: IncomingMessage, res: ServerResponse, db: Db) {
  if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
  try {
    const [sessions, skills, plans, subagents, schedules, mcp] = await Promise.all([
      db.from("maia_sessions").select("id,channel,conversation_key,scope_kind,status,title,updated_at,last_message_at").order("updated_at", { ascending: false }).limit(30),
      db.from("maia_skills").select("id,slug,version,description,status,approved_at").order("slug").limit(100),
      db.from("maia_plans").select("id,title,status,updated_at").order("updated_at", { ascending: false }).limit(30),
      db.from("maia_subagents").select("id,objective,status,created_at,updated_at,result").order("created_at", { ascending: false }).limit(30),
      db.from("maia_schedules").select("id,instruction,schedule_kind,schedule_value,timezone,destination,status,next_run_at").order("next_run_at", { ascending: true }).limit(30),
      db.from("maia_mcp_servers").select("id,name,transport,status,allowed_tools,updated_at").order("name").limit(30),
    ]);
    const firstError = [sessions, skills, plans, subagents, schedules, mcp].find((result) => result.error)?.error;
    if (firstError) return json(res, 503, { error: "nucleus_migration_pending", detail: firstError.message.slice(0, 240) });
    return json(res, 200, { sessions: sessions.data ?? [], skills: skills.data ?? [], plans: plans.data ?? [], subagents: subagents.data ?? [], schedules: schedules.data ?? [], mcp: mcp.data ?? [] });
  } catch (error) {
    return json(res, 503, { error: "nucleus_unavailable", detail: error instanceof Error ? error.message.slice(0, 240) : "Falha desconhecida" });
  }
}
