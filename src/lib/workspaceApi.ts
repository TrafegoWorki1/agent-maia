import { supabase } from "./supabaseBrowser";

export interface WorkRow { id: number; title: string; responsible: string; status: "pendente" | "em_andamento" | "concluida"; due_at: string | null; revision: number; completion_evidence: string | null; overdue: boolean }
export interface ReminderRow { id: number; work_task_id: number; run_at: string; status: string; kind: string; message_id: string | null; error: string | null }
export interface ReviewRow { task_id: number; relevant: boolean; resolution: string; expected: string; evidence: string }
export interface Candidate { id: number; summary: string; status: string; created_at: string; request: string | null; response: string; events: { type: string; operation: string | null; detail: string | null }[] }
export interface WorkspaceData {
  work: { tasks: WorkRow[]; reminders: ReminderRow[]; limit: number };
  effectiveness: { sample: number; targetSample: number; sufficient: boolean; relevance: number | null; resolution: number | null; partial: number; candidates: Candidate[]; reviews: ReviewRow[]; sampleScope: string; deliveries: { task_id: number; status: string; error: string | null }[] };
}
export async function workspaceRequest(action?: string, input?: unknown): Promise<WorkspaceData> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  const r = await fetch("/api/workspace", { method: action ? "POST" : "GET", cache: "no-store", headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(action ? { "Content-Type": "application/json" } : {}),
  }, ...(action ? { body: JSON.stringify({ action,input }) } : {}) });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `Falha HTTP ${r.status}`);
  return body;
}
