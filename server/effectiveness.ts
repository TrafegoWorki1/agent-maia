import { z } from "zod";
import type { Db } from "./store.ts";

export const evaluationSchema = z.object({
  task_id: z.number().int().positive(), relevant: z.boolean(), resolution: z.enum(["resolvido", "parcial", "nao_resolvido"]),
  expected: z.string().trim().min(1).max(2000), evidence: z.string().trim().min(1).max(2000),
});
export interface Evaluation { task_id: number; relevant: boolean; resolution: string; reviewed_at: string; expected: string; evidence: string }
export function evaluationSummary(rows: Evaluation[]) {
  return { sample: rows.length, targetSample: 20, sufficient: rows.length >= 20,
    relevance: rows.length ? Math.round(100 * rows.filter((r) => r.relevant).length / rows.length) : null,
    resolution: rows.length ? Math.round(100 * rows.filter((r) => r.resolution === "resolvido").length / rows.length) : null,
    partial: rows.filter((r) => r.resolution === "parcial").length };
}
export async function evaluateTask(db: Db, input: unknown, reviewer: string) {
  const a = evaluationSchema.parse(input);
  const t = await db.from("tasks").select("status").eq("id", a.task_id).single();
  if (t.error) throw new Error(t.error.message);
  if (!["concluida", "falhou", "incerta"].includes(t.data.status)) throw new Error("Avalie somente execuções encerradas");
  const r = await db.from("task_evaluations").upsert({ ...a, reviewer, reviewed_at: new Date().toISOString() }, { onConflict: "task_id" }).select("*").single();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function effectivenessView(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const r = await db.from("tasks").select("id,summary,status,created_at,channel").gte("created_at", since)
    .in("status", ["concluida","falhou","incerta"]).order("id", { ascending: false }).limit(100);
  if (r.error) throw new Error(r.error.message);
  const ids = (r.data ?? []).map((t) => t.id);
  if (!ids.length) return { ...evaluationSummary([]), since, candidates: [], reviews: [], deliveries: [], sampleScope: "Até 100 execuções encerradas dos últimos 7 dias" };
  const [reviews, events, deliveries] = await Promise.all([
    db.from("task_evaluations").select("*").in("task_id", ids),
    db.from("task_events").select("task_id,type,operation,detail,at").in("task_id", ids).order("id", { ascending: false }).limit(1000),
    db.from("response_deliveries").select("task_id,part,text,request_text,status,message_id,error").in("task_id", ids).order("part").limit(500),
  ]);
  for (const q of [reviews, events, deliveries]) if (q.error) throw new Error(q.error.message);
  return { ...evaluationSummary(reviews.data as Evaluation[]), since,
    candidates: r.data.map((t) => ({ ...t, events: (events.data ?? []).filter((e) => e.task_id === t.id).slice(0,20),
      request: (deliveries.data ?? []).find((d) => d.task_id === t.id && d.part === 0)?.request_text ?? null,
      response: (deliveries.data ?? []).filter((d) => d.task_id === t.id).map((d) => d.text ?? "[texto expirado]").join("\n") })),
    reviews: reviews.data ?? [], deliveries: deliveries.data ?? [], sampleScope: "Até 100 execuções encerradas dos últimos 7 dias; eventos mais recentes, limitados a 1000" };
}
