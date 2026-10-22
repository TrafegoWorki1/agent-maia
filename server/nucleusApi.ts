import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "./store.ts";
import { json } from "./workspaceApi.ts";
import { z } from "zod";
import { activateSkill } from "./skills.ts";
import { createSchedule, editSchedule, scheduleInputSchema, setScheduleStatus } from "./scheduler.ts";
import { searchAuthorizedSessionMessages, startNewSession } from "./sessions.ts";
import { cancelSubagent, createSubagent, reviewSubagentResult } from "./subagents.ts";
import { createTask } from "./store.ts";
import { controlMission } from "./missions.ts";

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mission_control"), id: z.number().int().positive(), revision: z.number().int().positive(), operation: z.enum(["pause", "resume", "cancel", "correct"]), note: z.string().max(2000).default("") }),
  z.object({ action: z.literal("skill_activate"), id: z.string().uuid() }),
  z.object({ action: z.literal("schedule_create"), instruction: z.string().trim().min(1).max(8000), kind: z.enum(["once", "interval", "cron"]), value: z.string().trim().min(1).max(120), timezone: z.string().default("America/Sao_Paulo") }),
  z.object({ action: z.literal("schedule_status"), id: z.string().uuid(), status: z.enum(["active", "paused", "cancelled"]) }),
  z.object({ action: z.literal("schedule_edit"), id: z.string().uuid(), instruction: z.string().trim().min(1).max(8000), kind: z.enum(["once", "interval", "cron"]), value: z.string().trim().min(1).max(120), timezone: z.string().default("America/Sao_Paulo") }),
  z.object({ action: z.literal("session_new"), channel: z.enum(["whatsapp", "painel"]) }),
  z.object({ action: z.literal("session_search"), id: z.string().uuid(), channel: z.enum(["whatsapp", "painel"]), query: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("delegate"), kind: z.enum(["research", "analysis", "review"]), objectives: z.array(z.string().trim().min(5).max(1000)).min(1).max(3), context: z.string().max(4000).default("") }),
  z.object({ action: z.literal("subagent_cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("subagent_review"), id: z.string().uuid(), approved: z.boolean(), note: z.string().trim().min(1).max(2000) }),
]);

export async function handleNucleus(req: IncomingMessage, res: ServerResponse, db: Db, reviewer: string) {
  try {
    if (req.method === "POST") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "same_origin_required" });
      if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "json_required" });
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16000) return json(res, 413, { error: "too_large" }); }
      const input = command.parse(JSON.parse(raw));
      const ownerKey = (process.env.EVOLUTION_OWNER_NUMBER ?? "").replace(/\D/g, "");
      if (!ownerKey) return json(res, 503, { error: "owner_number_missing" });
      const result = input.action === "mission_control" ? await controlMission(db, input.id, input.revision, input.operation, input.note)
        : input.action === "skill_activate" ? await activateSkill(db, input.id, reviewer)
        : input.action === "session_search" ? await searchAuthorizedSessionMessages(db, input.id, ownerKey, input.channel, input.query)
        : input.action === "schedule_create" ? await createSchedule(db, scheduleInputSchema.parse({ ownerKey, clientId: null, instruction: input.instruction, skills: [], kind: input.kind, value: input.value, timezone: input.timezone, destination: ownerKey, limits: {}, missedPolicy: "skip", nextRunAt: null }))
        : input.action === "schedule_status" ? await setScheduleStatus(db, input.id, input.status, ownerKey)
        : input.action === "schedule_edit" ? await editSchedule(db, input.id, ownerKey, input)
        : input.action === "delegate" ? await (async () => { const taskId = await createTask(db, { channel: "painel", summary: `delegação: ${input.objectives[0]}` }); const ids = []; for (const objective of input.objectives) ids.push(await createSubagent(db, { objective, kind: input.kind, context: { text: input.context }, allowedTools: [], parentTaskId: taskId, limits: { maxConcurrent: 3, maxDepth: 1, maxSeconds: 120, maxSteps: 1 } })); return { taskId, ids }; })()
        : input.action === "subagent_cancel" ? await cancelSubagent(db, input.id)
        : input.action === "subagent_review" ? await reviewSubagentResult(db, input.id, input.approved, input.note)
        : await startNewSession(db, { channel: input.channel, conversationKey: input.channel === "painel" ? "owner:panel" : `dm:${ownerKey}`, requesterKey: ownerKey, clientId: null, kind: input.channel === "painel" ? "panel" : "owner_private" });
      return json(res, 200, { result });
    }
    if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
    const [sessions, skills, plans, subagents, schedules, mcp, delegationSummaries, missionEffects] = await Promise.all([
      db.from("maia_sessions").select("id,channel,conversation_key,scope_kind,status,title,updated_at,last_message_at").in("scope_kind", ["owner_private", "panel"]).eq("requester_key", (process.env.EVOLUTION_OWNER_NUMBER ?? "").replace(/\D/g, "")).order("updated_at", { ascending: false }).limit(30),
      db.from("maia_skills").select("id,slug,version,description,status,approved_at").order("slug").limit(100),
      db.from("maia_plans").select("id,title,status,updated_at,kind,mission_state,revision,expires_at,interaction_count,max_interactions,context,mission_notice").order("updated_at", { ascending: false }).limit(30),
      db.from("maia_subagents").select("id,objective,status,created_at,updated_at,result").order("created_at", { ascending: false }).limit(30),
      db.from("maia_schedules").select("id,instruction,schedule_kind,schedule_value,timezone,destination,status,next_run_at").order("next_run_at", { ascending: true }).limit(30),
      db.from("maia_mcp_servers").select("id,name,transport,status,allowed_tools,updated_at").order("name").limit(30),
      db.from("task_events").select("task_id,at,detail").eq("type", "delegation_summary").order("at", { ascending: false }).limit(10),
      db.from("maia_mission_effects").select("id,plan_id,kind,state,evidence,created_at").order("id", { ascending: false }).limit(100),
    ]);
    const firstError = [sessions, skills, plans, subagents, schedules, mcp, delegationSummaries, missionEffects].find((result) => result.error)?.error;
    if (firstError) return json(res, 503, { error: "nucleus_migration_pending", detail: firstError.message.slice(0, 240) });
    return json(res, 200, { sessions: sessions.data ?? [], skills: skills.data ?? [], plans: plans.data ?? [], subagents: subagents.data ?? [], schedules: schedules.data ?? [], mcp: mcp.data ?? [], delegationSummaries: delegationSummaries.data ?? [], missionEffects: missionEffects.data ?? [] });
  } catch (error) {
    return json(res, 503, { error: "nucleus_unavailable", detail: error instanceof Error ? error.message.slice(0, 240) : "Falha desconhecida" });
  }
}
