import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Db } from "./store.ts";
import { createReminder, createWorkTask, editReminder, updateWorkTask, workTasksView } from "./workTasks.ts";
import { effectivenessView, evaluateTask } from "./effectiveness.ts";
import { retryFailedResponse } from "./responseDelivery.ts";

export function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body));
}
const command = z.object({ action: z.enum(["create","update","reminder","edit_reminder","evaluate","retry_delivery"]), input: z.unknown() });
export async function handleWorkspace(req: IncomingMessage, res: ServerResponse, db: Db, reviewer: string) {
  try {
    if (req.method === "GET") return json(res, 200, { work: await workTasksView(db), effectiveness: await effectivenessView(db) });
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    // Protege POST local de páginas de terceiros; Vercel requer JWT além disto.
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "same_origin_required" });
    if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "json_required" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16000) return json(res, 413, { error: "too_large" }); }
    const a = command.parse(JSON.parse(raw));
    const result = a.action === "create" ? await createWorkTask(db,a.input)
      : a.action === "update" ? await updateWorkTask(db,a.input)
      : a.action === "reminder" ? await createReminder(db,a.input)
      : a.action === "edit_reminder" ? await editReminder(db,a.input)
      : a.action === "retry_delivery" ? await retryFailedResponse(db,z.object({ task_id:z.number().int().positive() }).parse(a.input).task_id)
      : await evaluateTask(db,a.input,reviewer);
    return json(res, 200, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no pedido";
    console.error("[workspace]", message);
    return json(res, 400, { error: message.slice(0,500) });
  }
}
