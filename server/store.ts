import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseFromEnv } from "./supabaseClient.ts";

// Banco da Maia no Supabase (projeto Agent Maia). Guarda metadados de eventos, aprovações e
// resultados das consultas, e o texto das conversas do dono e da Maia (nunca de terceiros).
// Tabelas e funções estão na migração maia_schema_v1 (e maia_record_group_activity_fn).

export type Db = SupabaseClient;
export type Sender = "owner" | "approver" | "other" | "none" | "group";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type SourceId = "gmail" | "meta" | "sheets" | "calendar";

// Erros do Supabase viram exceção: o chamador trata como falha da operação.
function unwrap<T>(result: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new Error(`Supabase: ${result.error.message}`);
  return result.data as T;
}

let shared: Db | null = null;
export function getDb(): Db {
  shared ??= supabaseFromEnv();
  return shared;
}

// Tarefas: cada pedido vira uma tarefa rastreável. kind: operacional (usou ferramenta) ou conversa.
// status: recebida | em_andamento | aguardando_aprovacao | concluida | falhou | incerta.
export type TaskStatus = "recebida" | "em_andamento" | "aguardando_aprovacao" | "concluida" | "falhou" | "incerta";
export type TaskKind = "operacional" | "conversa";

// Conversa com a Maia: o texto fica no Supabase, só do dono e da Maia.
export type Channel = "whatsapp" | "painel";
export type Author = "owner" | "approver" | "maia";

export async function createTask(db: Db, input: { channel: Channel; summary: string }, now = new Date()): Promise<number> {
  const row = unwrap(
    await db
      .from("tasks")
      .insert({ created_at: now.toISOString(), channel: input.channel, kind: "conversa", summary: input.summary.slice(0, 80), status: "recebida" })
      .select("id")
      .single(),
  ) as { id: number };
  await addTaskEvent(db, row.id, "task_persisted", null, null, now);
  return row.id;
}

export async function setTaskStatus(db: Db, id: number, status: TaskStatus, now = new Date()): Promise<void> {
  const patch: Record<string, string> = { status };
  if (status === "concluida" || status === "falhou") patch.finished_at = now.toISOString();
  unwrap(await db.from("tasks").update(patch).eq("id", id));
  if (status === "em_andamento") {
    unwrap(await db.from("tasks").update({ started_at: now.toISOString() }).eq("id", id).is("started_at", null));
  }
}

export async function markTaskKind(db: Db, id: number, kind: TaskKind): Promise<void> {
  unwrap(await db.from("tasks").update({ kind }).eq("id", id));
}

export async function markTaskReplied(db: Db, id: number, now = new Date()): Promise<void> {
  unwrap(await db.from("tasks").update({ replied_at: now.toISOString() }).eq("id", id).is("replied_at", null));
}

export async function failTask(db: Db, id: number, error: string, now = new Date()): Promise<void> {
  unwrap(await db.from("tasks").update({ status: "falhou", error: error.slice(0, 300), finished_at: now.toISOString() }).eq("id", id));
}

export async function addTaskEvent(db: Db, taskId: number, type: string, operation: string | null, detail: string | null, now = new Date()): Promise<void> {
  unwrap(await db.from("task_events").insert({ task_id: taskId, at: now.toISOString(), type, operation, detail }));
}

// Reinício: tarefas que estavam em andamento não são reexecutadas. Viram "incerta" para revisão.
export async function recoverStaleTasks(db: Db, channel: Channel, now = new Date()): Promise<number> {
  const stale = unwrap(
    await db.from("tasks").select("id").eq("channel", channel).in("status", ["em_andamento", "aguardando_aprovacao", "recebida"]),
  ) as { id: number }[];
  for (const { id } of stale) {
    await setTaskStatus(db, id, "incerta", now);
    await addTaskEvent(db, id, "task_uncertain", null, "processo reiniciado durante a tarefa", now);
  }
  return stale.length;
}

export async function recentTasks(
  db: Db,
  limit = 20,
): Promise<{ id: number; created_at: string; channel: string; kind: string; summary: string; status: string; replied_at: string | null }[]> {
  return unwrap(
    await db.from("tasks").select("id, created_at, channel, kind, summary, status, replied_at").order("id", { ascending: false }).limit(limit),
  ) as { id: number; created_at: string; channel: string; kind: string; summary: string; status: string; replied_at: string | null }[];
}

export async function taskCountsSince(db: Db, sinceIso: string): Promise<Record<string, number>> {
  const rows = unwrap(await db.from("tasks").select("status").gte("created_at", sinceIso).eq("kind", "operacional")) as { status: string }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

// Evita processar duas vezes o mesmo evento da Evolution (reenvio). Retorna false se já foi visto.
export async function markMessageSeen(db: Db, keyId: string, now = new Date()): Promise<boolean> {
  const result = await db.from("seen_messages").insert({ key_id: keyId, at: now.toISOString() });
  if (result.error?.code === "23505") return false;
  unwrap(result);
  return true;
}

export async function recordMessage(db: Db, input: { channel: Channel; author: Author; text: string }, now = new Date()): Promise<void> {
  unwrap(await db.from("messages").insert({ at: now.toISOString(), channel: input.channel, author: input.author, text: input.text }));
}

export async function recentMessages(db: Db, limit = 100): Promise<{ id: number; at: string; channel: string; author: string; text: string }[]> {
  const rows = unwrap(await db.from("messages").select("id, at, channel, author, text").order("id", { ascending: false }).limit(limit)) as {
    id: number;
    at: string;
    channel: string;
    author: string;
    text: string;
  }[];
  return rows.reverse();
}

export async function recordEvent(db: Db, input: { event: string; kind: string; sender: Sender; outcome: string }, now = new Date()): Promise<void> {
  unwrap(
    await db.from("events").insert({ received_at: now.toISOString(), event: input.event, kind: input.kind, sender: input.sender, outcome: input.outcome }),
  );
}

export async function eventCountsSince(db: Db, sinceIso: string): Promise<Record<string, number>> {
  const rows = unwrap(await db.from("events").select("kind").gte("received_at", sinceIso)) as { kind: string }[];
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  return counts;
}

export async function lastEventAt(db: Db): Promise<string | null> {
  const rows = unwrap(await db.from("events").select("received_at").order("id", { ascending: false }).limit(1)) as { received_at: string }[];
  return rows[0]?.received_at ?? null;
}

export async function startApproval(db: Db, toolName: string, now = new Date()): Promise<number> {
  const row = unwrap(await db.from("approvals").insert({ requested_at: now.toISOString(), tool_name: toolName, status: "pending" }).select("id").single()) as {
    id: number;
  };
  return row.id;
}

export async function resolveApproval(db: Db, id: number, status: Exclude<ApprovalStatus, "pending">, now = new Date()): Promise<void> {
  unwrap(await db.from("approvals").update({ status, resolved_at: now.toISOString() }).eq("id", id));
}

export async function pendingApprovals(db: Db): Promise<{ requested_at: string; tool_name: string }[]> {
  return unwrap(
    await db.from("approvals").select("requested_at, tool_name").eq("status", "pending").order("id", { ascending: false }),
  ) as { requested_at: string; tool_name: string }[];
}

export async function startRun(db: Db, purpose: string, now = new Date()): Promise<number> {
  const row = unwrap(await db.from("agent_runs").insert({ started_at: now.toISOString(), purpose, status: "running" }).select("id").single()) as {
    id: number;
  };
  return row.id;
}

export async function finishRun(db: Db, id: number, status: "ok" | "error", costUsd: number | null, error: string | null, now = new Date()): Promise<void> {
  unwrap(await db.from("agent_runs").update({ status, finished_at: now.toISOString(), cost_usd: costUsd, error }).eq("id", id));
}

export async function lastRun(db: Db, purpose: string): Promise<{ started_at: string; status: string; error: string | null } | null> {
  const rows = unwrap(
    await db.from("agent_runs").select("started_at, status, error").eq("purpose", purpose).order("id", { ascending: false }).limit(1),
  ) as { started_at: string; status: string; error: string | null }[];
  return rows[0] ?? null;
}

export async function saveSnapshot(
  db: Db,
  source: SourceId,
  result: { status: "ok"; data: unknown } | { status: "error"; error: string },
  now = new Date(),
): Promise<void> {
  // Erro não apaga o último dado bom: a atualização do upsert só mexe nas colunas enviadas.
  if (result.status === "ok") {
    unwrap(await db.from("snapshots").upsert({ source, fetched_at: now.toISOString(), status: "ok", data: result.data, error: null }, { onConflict: "source" }));
  } else {
    unwrap(await db.from("snapshots").upsert({ source, fetched_at: now.toISOString(), status: "error", error: result.error }, { onConflict: "source" }));
  }
}

export interface StoredSnapshot {
  source: SourceId;
  fetched_at: string;
  status: "ok" | "error";
  data: unknown;
  error: string | null;
}

export async function readSnapshots(db: Db): Promise<StoredSnapshot[]> {
  return unwrap(await db.from("snapshots").select("source, fetched_at, status, data, error")) as StoredSnapshot[];
}

// Pares chave/valor pequenos: último resumo enviado, último estado de alerta, configurações do painel.
export async function kvGet(db: Db, key: string): Promise<string | null> {
  const rows = unwrap(await db.from("kv").select("value").eq("key", key)) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function kvSet(db: Db, key: string, value: string, now = new Date()): Promise<void> {
  unwrap(await db.from("kv").upsert({ key, value, at: now.toISOString() }, { onConflict: "key" }));
}

// Consultas para a qualidade e o painel: tarefas, eventos e execuções dentro de um intervalo.
export interface TaskRow {
  id: number;
  created_at: string;
  channel: string;
  kind: string;
  summary: string;
  status: string;
  started_at: string | null;
  replied_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface TaskEventRow {
  task_id: number;
  at: string;
  type: string;
  operation: string | null;
  detail: string | null;
}

export async function tasksBetween(db: Db, fromIso: string, toIso: string): Promise<TaskRow[]> {
  return unwrap(
    await db
      .from("tasks")
      .select("id, created_at, channel, kind, summary, status, started_at, replied_at, finished_at, error")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("id", { ascending: true }),
  ) as TaskRow[];
}

export async function taskEventsBetween(db: Db, fromIso: string, toIso: string): Promise<TaskEventRow[]> {
  const tasks = await tasksBetween(db, fromIso, toIso);
  if (tasks.length === 0) return [];
  return unwrap(
    await db
      .from("task_events")
      .select("task_id, at, type, operation, detail")
      .in("task_id", tasks.map((t) => t.id))
      .order("id", { ascending: true }),
  ) as TaskEventRow[];
}

export async function chatRunsBetween(db: Db, fromIso: string, toIso: string): Promise<{ status: string }[]> {
  return unwrap(
    await db.from("agent_runs").select("status").eq("purpose", "chat").gte("started_at", fromIso).lt("started_at", toIso),
  ) as { status: string }[];
}

export async function approvalsBetween(db: Db, fromIso: string, toIso: string): Promise<{ status: string; tool_name: string; requested_at: string }[]> {
  return unwrap(
    await db.from("approvals").select("status, tool_name, requested_at").gte("requested_at", fromIso).lt("requested_at", toIso),
  ) as { status: string; tool_name: string; requested_at: string }[];
}

export async function ownerMessagesSince(db: Db, sinceIso: string): Promise<{ at: string; text: string; channel: string }[]> {
  return unwrap(
    await db.from("messages").select("at, text, channel").eq("author", "owner").gte("at", sinceIso).order("id", { ascending: true }),
  ) as { at: string; text: string; channel: string }[];
}

// Grupos: atividade (contagem e última vez), sem o texto das mensagens das pessoas do grupo.
export async function recordGroupActivity(db: Db, jid: string, now = new Date()): Promise<void> {
  unwrap(await db.rpc("record_group_activity", { p_jid: jid, p_at: now.toISOString() }));
}

export async function groupActivitySince(db: Db, sinceIso: string): Promise<{ jid: string; last_at: string; messages: number }[]> {
  return unwrap(
    await db.from("group_activity").select("jid, last_at, messages").gte("last_at", sinceIso).order("last_at", { ascending: false }),
  ) as { jid: string; last_at: string; messages: number }[];
}

// Tarefa criada pelo dono pelo WhatsApp, opcionalmente ligada a um grupo.
export async function createOwnerTask(db: Db, input: { title: string; groupName: string | null }, now = new Date()): Promise<number> {
  const row = unwrap(
    await db
      .from("tasks")
      .insert({ created_at: now.toISOString(), channel: "whatsapp", kind: "operacional", summary: input.title.slice(0, 80), status: "recebida", group_name: input.groupName })
      .select("id")
      .single(),
  ) as { id: number };
  await addTaskEvent(db, row.id, "task_persisted", null, input.groupName, now);
  return row.id;
}

// Nomes das ferramentas que a Maia usou numa tarefa (para comparar com a triagem do Jev).
export async function toolsUsed(db: Db, taskId: number): Promise<string[]> {
  const rows = unwrap(await db.from("task_events").select("operation").eq("task_id", taskId).eq("type", "tool_use").order("id", { ascending: true })) as {
    operation: string | null;
  }[];
  return rows.map((r) => r.operation ?? "").filter(Boolean);
}
