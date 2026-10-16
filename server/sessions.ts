import { z } from "zod";
import type { Db } from "./store.ts";

export const sessionScopeSchema = z.object({
  channel: z.enum(["whatsapp", "painel"]),
  conversationKey: z.string().trim().min(1).max(240),
  requesterKey: z.string().trim().min(1).max(240),
  clientId: z.string().uuid().nullable().default(null),
  kind: z.enum(["owner_private", "member_private", "group", "client", "panel"]),
});
export type SessionScope = z.infer<typeof sessionScopeSchema>;

export interface MaiaSession {
  id: string;
  created_at: string;
  updated_at: string;
  channel: SessionScope["channel"];
  conversation_key: string;
  requester_key: string;
  client_id: string | null;
  scope_kind: SessionScope["kind"];
  status: "active" | "archived";
  title: string;
  last_message_at: string | null;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  task_id: number | null;
  at: string;
  author: "owner" | "approver" | "member" | "maia" | "system";
  text: string;
  source: "whatsapp" | "painel" | "worker" | "summary" | "tool";
  source_event_key: string | null;
  metadata: Record<string, unknown>;
}

const SESSION_SELECT = "id,created_at,updated_at,channel,conversation_key,requester_key,client_id,scope_kind,status,title,last_message_at";
const MESSAGE_SELECT = "id,session_id,task_id,at,author,text,source,source_event_key,metadata";

function scopeValue(input: SessionScope): SessionScope {
  return sessionScopeSchema.parse(input);
}

async function findSession(db: Db, scope: SessionScope): Promise<MaiaSession | null> {
  let query = db.from("maia_sessions").select(SESSION_SELECT).eq("channel", scope.channel).eq("conversation_key", scope.conversationKey).eq("requester_key", scope.requesterKey).eq("scope_kind", scope.kind).eq("status", "active");
  query = scope.clientId ? query.eq("client_id", scope.clientId) : query.is("client_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Sessão indisponível: ${error.message}`);
  return data as MaiaSession | null;
}

export async function openSession(db: Db, input: SessionScope & { title?: string }): Promise<MaiaSession> {
  const scope = scopeValue(input);
  const existing = await findSession(db, scope);
  if (existing) return existing;
  const { data, error } = await db.from("maia_sessions").insert({
    channel: scope.channel,
    conversation_key: scope.conversationKey,
    requester_key: scope.requesterKey,
    client_id: scope.clientId,
    scope_kind: scope.kind,
    title: input.title?.trim().slice(0, 240) ?? "",
  }).select(SESSION_SELECT).single();
  if (error || !data) {
    if (error?.code === "23505") {
      const raced = await findSession(db, scope);
      if (raced) return raced;
    }
    throw new Error(`Não consegui abrir a sessão: ${error?.message ?? "sem retorno"}`);
  }
  return data as MaiaSession;
}

export async function startNewSession(db: Db, input: SessionScope & { title?: string }): Promise<MaiaSession> {
  const scope = scopeValue(input);
  const { error: archiveError } = await db.from("maia_sessions").update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("channel", scope.channel).eq("conversation_key", scope.conversationKey).eq("requester_key", scope.requesterKey).eq("scope_kind", scope.kind).eq("status", "active");
  if (archiveError) throw new Error(`Não consegui iniciar nova sessão: ${archiveError.message}`);
  return openSession(db, input);
}

export async function appendSessionMessage(db: Db, input: {
  sessionId: string;
  taskId?: number | null;
  author: SessionMessage["author"];
  text: string;
  source: SessionMessage["source"];
  sourceEventKey?: string | null;
  metadata?: Record<string, unknown>;
  at?: Date;
}): Promise<SessionMessage | null> {
  const row = { session_id: input.sessionId, task_id: input.taskId ?? null, author: input.author, text: input.text.slice(0, 16000), source: input.source, source_event_key: input.sourceEventKey ?? null, metadata: input.metadata ?? {}, at: (input.at ?? new Date()).toISOString() };
  const { data, error } = await db.from("maia_session_messages").insert(row).select(MESSAGE_SELECT).maybeSingle();
  if (error?.code === "23505") return null;
  if (error || !data) throw new Error(`Não consegui registrar mensagem da sessão: ${error?.message ?? "sem retorno"}`);
  await db.from("maia_sessions").update({ updated_at: row.at, last_message_at: row.at }).eq("id", input.sessionId);
  return data as SessionMessage;
}

export async function sessionMessages(db: Db, sessionId: string, limit = 120, beforeId?: number): Promise<SessionMessage[]> {
  let query = db.from("maia_session_messages").select(MESSAGE_SELECT).eq("session_id", sessionId).order("id", { ascending: false }).limit(Math.max(1, Math.min(limit, 500)));
  if (beforeId) query = query.lt("id", beforeId);
  const { data, error } = await query;
  if (error) throw new Error(`Histórico da sessão indisponível: ${error.message}`);
  return ((data ?? []) as SessionMessage[]).reverse();
}

export async function searchSessionMessages(db: Db, sessionId: string, queryText: string, limit = 20): Promise<SessionMessage[]> {
  const query = queryText.trim();
  if (!query) return [];
  const escaped = query.replace(/[%_]/g, "\\$&");
  const { data, error } = await db.from("maia_session_messages").select(MESSAGE_SELECT).eq("session_id", sessionId).ilike("text", `%${escaped}%`).order("id", { ascending: false }).limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(`Busca no histórico indisponível: ${error.message}`);
  return (data ?? []) as SessionMessage[];
}

export async function authorizedSessionMessages(db: Db, session: MaiaSession, authorize: (session: MaiaSession) => Promise<boolean>, limit = 120): Promise<SessionMessage[]> {
  if (!(await authorize(session))) throw new Error("Acesso ao contexto recusado; a sessão não foi lida.");
  return sessionMessages(db, session.id, limit);
}
