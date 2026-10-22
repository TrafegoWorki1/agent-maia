import { z } from "zod";
import { canonicalPhone } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

const instant = z.string().datetime({ offset: true });
export const windowSchema = z.object({ start: instant, end: instant }).strict();
export const meetingSchema = z.object({
  calendar: z.string().min(1).max(200), timezone: z.string().min(1).max(80),
  durationMinutes: z.number().int().min(15).max(240),
  windows: z.array(windowSchema).min(1).max(20),
  location: z.string().min(1).max(300), inviteByEmail: z.boolean(),
}).strict();
export const authoritySchema = z.object({
  owner: z.string().regex(/^\d{10,15}$/), contact: z.string().regex(/^\d{10,15}$/), contactName: z.string().max(120),
  conversation: z.string().min(1), objective: z.string().min(3).max(2000),
  meeting: meetingSchema.optional(),
  group: z.object({ jid: z.string().endsWith("@g.us"), name: z.string(), text: z.string().min(1).max(2500), mentions: z.array(z.string().regex(/^\d{10,15}$/)).max(20), everyone: z.boolean() }).strict().optional(),
}).strict();
export type Authority = z.infer<typeof authoritySchema>;
export type MissionState = "working" | "waiting_external" | "waiting_owner" | "paused" | "done" | "cancelled";
export interface Mission {
  id: number; title: string; request: string; kind: "conversation" | "meeting" | "group_action";
  status: "active" | "done" | "cancelled"; mission_state: MissionState; authority: Authority;
  created_at: string; updated_at: string; expires_at: string; revision: number;
  interaction_count: number; max_interactions: number; lease_token: string | null; lease_until: string | null;
  context: Record<string, unknown>; mission_notice: string | null;
}
export interface MissionEvent { id: number; event_key: string; at: string; text: string; participant: string; processed: boolean }

export function checkMeeting(meeting: Authority["meeting"], now = Date.now()): void {
  if (!meeting) return;
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: meeting.timezone }).format(); } catch { throw new Error("Fuso horário inválido"); }
  for (const w of meeting.windows) {
    if (Date.parse(w.end) <= Math.max(now, Date.parse(w.start)) || Date.parse(w.end) - Date.parse(w.start) < meeting.durationMinutes * 60_000) throw new Error("Janela sem horário futuro suficiente para a reunião");
    if (Date.parse(w.end) > now + 31 * 86400_000) throw new Error("Janela máxima de 31 dias");
  }
}

export function slotAllowed(meeting: NonNullable<Authority["meeting"]>, start: string, now = Date.now()): boolean {
  const from = Date.parse(start), to = from + meeting.durationMinutes * 60_000;
  return Number.isFinite(from) && from > now && meeting.windows.some(w => from >= Date.parse(w.start) && to <= Date.parse(w.end));
}

export async function getMission(db: Db, id: number): Promise<Mission> {
  const { data, error } = await db.from("maia_plans").select("*").eq("id", id).neq("kind", "general").single();
  if (error || !data) throw new Error(error?.message ?? "Missão não encontrada");
  return { ...data, authority: authoritySchema.parse(data.authority) } as Mission;
}
export async function assertMissionCurrent(db: Db, mission: Mission): Promise<Mission> {
  const fresh = await getMission(db, mission.id);
  if (fresh.status !== "active" || fresh.mission_state !== "working" || fresh.revision !== mission.revision || fresh.lease_token !== mission.lease_token || !fresh.lease_until || Date.parse(fresh.lease_until) <= Date.now() || Date.parse(fresh.expires_at) <= Date.now()) throw new Error("Missão pausada, corrigida, cancelada ou expirada");
  return fresh;
}

// O roteador só persiste. O worker de missões executa depois, inclusive após reinício.
export async function routeMissionMessage(db: Db, event: { conversation: string; participant: string; text: string; key: string; at: string }): Promise<boolean> {
  const { data, error } = await db.from("maia_plans").select("*").neq("kind", "general").eq("status", "active");
  if (error) throw new Error(`Missões indisponíveis: ${error.message}`);
  const conversation = event.conversation.startsWith("dm:") ? `dm:${canonicalPhone(event.conversation.slice(3))}` : event.conversation;
  const match = (data as Mission[] ?? []).find(m => m.authority.conversation === conversation && canonicalPhone(m.authority.contact) === canonicalPhone(event.participant));
  if (!match) {
    if (!event.key) return false;
    const prior = await db.from("maia_mission_events").select("id").eq("event_key", event.key).eq("participant", event.participant).limit(1).maybeSingle();
    if (prior.error) throw new Error(prior.error.message);
    return !!prior.data;
  }
  // Missão pausada continua dona da conversa: atendimento genérico não pode responder por cima.
  if (!event.key || !Number.isFinite(Date.parse(event.at)) || Date.parse(event.at) < Date.parse(match.created_at) || Date.parse(event.at) > Date.now() + 60_000 || Date.parse(match.expires_at) <= Date.now()) return true;
  const saved = await db.from("maia_mission_events").upsert({ plan_id: match.id, event_key: event.key, at: event.at, text: event.text.slice(0, 8000), participant: event.participant }, { onConflict: "plan_id,event_key", ignoreDuplicates: true });
  if (saved.error) throw new Error(saved.error.message);
  return true;
}

export async function controlMission(db: Db, id: number, revision: number, action: "pause" | "resume" | "cancel" | "correct", note = ""): Promise<Mission> {
  const { data, error } = await db.rpc("control_maia_mission", { p_id: id, p_revision: revision, p_action: action, p_note: note });
  if (error || !data) throw new Error(error?.message ?? "Controle não aplicado");
  return data as Mission;
}

// Comandos inequívocos preemptam a execução antes do lote/IA do owner.
export async function handleMissionControlText(db: Db, text: string): Promise<string | null> {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const command = /^(?:maia[,\s]+)?(pause|pausa|pausar|cancele|cancela|cancelar|retome|retoma|retomar)\s+(?:a\s+)?(?:missao|conversa)\s+(?:com\s+)?(.+?)[.!]?$/i.exec(normalized);
  if (!command) return null;
  const result = await db.from("maia_plans").select("id,revision,title,authority").neq("kind", "general").eq("status", "active");
  if (result.error) throw new Error(result.error.message);
  const target = command[2].replace(/^#/, "").trim();
  const hits = (result.data ?? []).filter(row => /^\d+$/.test(target) ? row.id === Number(target) : String(row.authority.contactName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === target);
  if (hits.length !== 1) return null;
  const operation = command[1].startsWith("paus") ? "pause" : command[1].startsWith("cancel") ? "cancel" : "resume";
  try {
    await controlMission(db, hits[0].id, hits[0].revision, operation);
    return `Missão #${hits[0].id} ${operation === "pause" ? "pausada" : operation === "cancel" ? "cancelada" : "retomada"}. ${operation === "cancel" ? "Ações já realizadas permanecem registradas." : ""}`.trim();
  } catch (error) { return error instanceof Error ? error.message : "Não consegui aplicar o controle"; }
}

export const missionDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), text: z.string().trim().min(1).max(2500) }).strict(),
  z.object({ action: z.literal("schedule"), start: instant, email: z.string().email().optional(), acceptanceEvent: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("complete"), summary: z.string().trim().min(1).max(1500), evidenceEvent: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("escalate"), reason: z.string().trim().min(1).max(1200) }).strict(),
  z.object({ action: z.literal("wait") }).strict(),
]);
export type MissionDecision = z.infer<typeof missionDecisionSchema>;
