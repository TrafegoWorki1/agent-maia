import type { Db } from "./store.ts";
import { sendTextChecked, DeliveryError } from "./evolutionSend.ts";

export async function runTaskReminders(db: Db): Promise<number> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  if (!owner) throw new Error("Destinatário dos lembretes não configurado");
  const r = await db.rpc("claim_task_reminders", { p_limit: 10 });
  if (r.error) throw new Error(r.error.message);
  for (const reminder of r.data ?? []) {
    let accepted = false;
    try {
      const t = await db.from("work_tasks").select("title,responsible,due_at,status").eq("id", reminder.work_task_id).single();
      if (t.error) throw new Error(t.error.message);
      if (t.data.status === "concluida") {
        const cancelled = await db.from("task_reminders").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", reminder.id);
        if (cancelled.error) throw new Error(cancelled.error.message);
        continue;
      }
      const due = t.data.due_at ? new Date(t.data.due_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem prazo";
      const id = await sendTextChecked(owner, `Lembrete da tarefa #${reminder.work_task_id}: ${t.data.title}\nResponsável: ${t.data.responsible}\nPrazo (Brasília): ${due}\nEstado: ${t.data.status}. Confira o trabalho antes de marcar como concluído.`);
      accepted = true;
      const saved = await db.from("task_reminders").update({ status: "sent", message_id: id, finished_at: new Date().toISOString(), error: null }).eq("id", reminder.id);
      if (saved.error) throw new Error(saved.error.message);
    } catch (error) {
      const uncertain = accepted || !(error instanceof DeliveryError) || error.uncertain;
      const saved = await db.from("task_reminders").update({ status: uncertain ? "uncertain" : "failed", finished_at: new Date().toISOString(), error: String(error).slice(0, 500) }).eq("id", reminder.id);
      console.error(`[lembretes] #${reminder.id}: ${uncertain ? "incerto, não repetido" : "falhou"}${saved.error ? "; registro falhou" : ""}`);
    }
  }
  return r.data?.length ?? 0;
}

export async function recoverDeliveries(db: Db) {
  // Um processo pode estar vivo: só recupera leases com mais de cinco minutos.
  const cutoff = new Date(Date.now() - 5 * 60000).toISOString();
  for (const table of ["task_reminders", "response_deliveries"] as const) {
    const r = await db.from(table).update({ status: "uncertain", error: "Envio interrompido; conferir antes de repetir", finished_at: new Date().toISOString() }).eq("status", "sending").lt("claimed_at", cutoff);
    if (r.error) throw new Error(r.error.message);
  }
  const expired = new Date(Date.now() - 7 * 86400000).toISOString();
  const pending = await db.from("response_deliveries").update({ status: "failed", error: "Resposta pendente expirou após sete dias; retome o contexto antes de responder" }).lt("created_at",expired).eq("status","pending");
  if (pending.error) throw new Error(pending.error.message);
  const purged = await db.from("response_deliveries").update({ text: null, request_text: null }).lt("created_at", expired).neq("status", "pending");
  if (purged.error) throw new Error(purged.error.message);
}
