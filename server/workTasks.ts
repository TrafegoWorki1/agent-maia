import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./store.ts";

export const workStatus = z.enum(["pendente", "em_andamento", "concluida"]);
// Fuso explícito evita gravar horário local como UTC silenciosamente.
export const timestamp = z.string().refine((s) => /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)), "Use data ISO com fuso, ex.: 2026-10-11T09:00:00-03:00");
export const createWorkSchema = z.object({
  titulo: z.string().trim().min(1).max(200), responsavel: z.string().trim().min(1).max(100),
  prazo: timestamp.nullable().optional(), chave: z.string().min(1).max(200).optional(),
});
export const updateWorkSchema = z.object({
  id: z.number().int().positive(), revisao: z.number().int().positive(),
  titulo: z.string().trim().min(1).max(200).optional(), responsavel: z.string().trim().min(1).max(100).optional(),
  status: workStatus.optional(), prazo: timestamp.nullable().optional(), evidencia: z.string().trim().min(1).max(2000).optional(),
}).refine((a) => a.status !== "concluida" || !!a.evidencia, "Concluir exige evidência do trabalho entregue");
export const reminderSchema = z.object({ tarefa_id: z.number().int().positive(), horario: timestamp, chave: z.string().min(1).max(200).optional() });
export const editReminderSchema = z.object({ id: z.number().int().positive(), cancelar: z.boolean().optional(), horario: timestamp.optional() })
  .refine((a) => a.cancelar === true || !!a.horario, "Informe novo horário ou cancelar");

export interface WorkTask {
  id: number; title: string; responsible: string; status: "pendente" | "em_andamento" | "concluida";
  due_at: string | null; revision: number; completion_evidence: string | null; completed_at: string | null; updated_at: string;
}
export function isOverdue(t: Pick<WorkTask, "status" | "due_at">, now = new Date()): boolean {
  return t.status !== "concluida" && !!t.due_at && Date.parse(t.due_at) < now.getTime();
}
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
export function requestKey(prefix: string, input: unknown) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}
export async function createWorkTask(db: Db, input: unknown, sourceTaskId?: number) {
  const a = createWorkSchema.parse(input);
  const key = a.chave ?? requestKey(`exec:${sourceTaskId ?? 0}`, a);
  if (!a.chave && !sourceTaskId) throw new Error("Criação exige chave de idempotência");
  const row = { title: a.titulo, responsible: a.responsavel, due_at: a.prazo ?? null, request_key: key, source_task_id: sourceTaskId || null };
  const inserted = await db.from("work_tasks").upsert(row, { onConflict: "request_key", ignoreDuplicates: true }).select("*");
  check(inserted.error);
  const existing = inserted.data?.[0] ?? (await db.from("work_tasks").select("*").eq("request_key", key).single()).data;
  if (!existing) throw new Error("Não consegui conferir a tarefa criada");
  return existing as WorkTask;
}
export async function updateWorkTask(db: Db, input: unknown) {
  const a = updateWorkSchema.parse(input);
  const patch: Record<string, unknown> = {};
  for (const [from, to] of [["titulo","title"],["responsavel","responsible"],["status","status"],["prazo","due_at"],["evidencia","completion_evidence"]] as const) {
    if (a[from] !== undefined) patch[to] = a[from];
  }
  if (!Object.keys(patch).length) throw new Error("Nenhuma alteração informada");
  const r = await db.from("work_tasks").update(patch).eq("id", a.id).eq("revision", a.revisao).select("*").maybeSingle();
  check(r.error);
  if (!r.data) throw new Error("Tarefa inexistente ou alterada por outra pessoa; consulte a revisão atual");
  return r.data as WorkTask;
}
export async function createReminder(db: Db, input: unknown, sourceTaskId?: number) {
  const a = reminderSchema.parse(input);
  if (Date.parse(a.horario) <= Date.now()) throw new Error("O lembrete precisa de um horário futuro");
  if (!a.chave && !sourceTaskId) throw new Error("Lembrete exige chave de idempotência");
  const t = await db.from("work_tasks").select("status").eq("id", a.tarefa_id).single();
  check(t.error);
  if (t.data?.status === "concluida") throw new Error("A tarefa já está concluída");
  const r = await db.from("task_reminders").upsert({ work_task_id: a.tarefa_id, run_at: a.horario, kind: "manual", request_key: a.chave ?? requestKey(`lembrete:${sourceTaskId}`, a) }, { onConflict: "request_key", ignoreDuplicates: true }).select("*");
  check(r.error);
  return r.data;
}
export async function editReminder(db: Db, input: unknown) {
  const a = editReminderSchema.parse(input);
  if (!a.cancelar && Date.parse(a.horario!) <= Date.now()) throw new Error("Use um horário futuro");
  const r = await db.from("task_reminders").update(a.cancelar ? { status: "cancelled", finished_at: new Date().toISOString() } : { run_at: a.horario })
    .eq("id", a.id).eq("status", "pending").select("*").maybeSingle();
  check(r.error);
  if (!r.data) throw new Error("Lembrete inexistente ou já em envio/encerrado; não repetido");
  return r.data;
}
export async function workTasksView(db: Db, now = new Date()) {
  const [tasks, reminders] = await Promise.all([
    db.from("work_tasks").select("*").order("id", { ascending: false }).limit(200),
    db.from("task_reminders").select("id,work_task_id,run_at,kind,status,message_id,error").order("run_at", { ascending: false }).limit(200),
  ]);
  check(tasks.error); check(reminders.error);
  return { tasks: (tasks.data as WorkTask[]).map((t) => ({ ...t, overdue: isOverdue(t, now) })), reminders: reminders.data ?? [], limit: 200 };
}

// Os dois SDKs recebem os mesmos schemas e executores; nenhuma chave vai ao modelo.
export const workTools = [
  { name: "tarefas_listar", description: "Lista tarefas reais com responsável, prazo, revisão, evidência informada e lembretes. Dados privados do owner.", schema: z.object({}), run: (db: Db) => workTasksView(db) },
  { name: "tarefa_criar", description: "Cria tarefa de trabalho pendente; prazo ISO com -03:00. Prazo gera lembrete privado ao owner automaticamente.", schema: createWorkSchema, run: (db: Db, a: unknown, taskId?: number) => createWorkTask(db, a, taskId) },
  { name: "tarefa_atualizar", description: "Edita título, responsável, prazo ou estado. Consulte revisão antes; concluir exige evidência informada, não prova de verificação externa.", schema: updateWorkSchema, run: (db: Db, a: unknown) => updateWorkTask(db, a) },
  { name: "lembrete_criar", description: "Agenda lembrete persistido de tarefa ao owner no WhatsApp, com horário ISO e fuso. Não envia a terceiros.", schema: reminderSchema, run: (db: Db, a: unknown, taskId?: number) => createReminder(db, a, taskId) },
  { name: "lembrete_editar", description: "Reagenda ou cancela lembrete ainda pendente. Envios incertos não são repetidos.", schema: editReminderSchema, run: (db: Db, a: unknown) => editReminder(db, a) },
] as const;
