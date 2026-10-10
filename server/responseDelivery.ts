import { DeliveryError, sendTextChecked, splitReply } from "./evolutionSend.ts";
import { addTaskEvent, markTaskReplied, recordMessage, setTaskStatus, type Db } from "./store.ts";
import { recordConvMessage } from "./conversations.ts";

export async function persistResponse(db: Db, taskId: number, recipient: string, text: string, request?: string) {
  const r = await db.from("response_deliveries").upsert(splitReply(text).map((part, i) => ({ task_id: taskId, recipient, part: i, text: part, request_text: i === 0 ? request?.slice(0,16000) ?? null : null })), { onConflict: "task_id,part", ignoreDuplicates: true });
  if (r.error) throw new Error(`Persistência da resposta: ${r.error.message}`);
  await addTaskEvent(db, taskId, "execution_completed", null, "Resposta gerada; entrega ainda pendente");
}

export async function runResponseDeliveries(db: Db, taskId?: number, limit = 30) {
  for (let i = 0; i < limit; i++) {
    const r = await db.rpc("claim_response_delivery", { p_task_id: taskId ?? null });
    if (r.error) throw new Error(r.error.message);
    const item = r.data?.[0];
    if (!item) break;
    let accepted = false;
    try {
      const id = await sendTextChecked(item.recipient, item.text);
      accepted = true;
      const saved = await db.from("response_deliveries").update({ status: "sent", message_id: id, finished_at: new Date().toISOString() }).eq("id", item.id);
      if (saved.error) throw new Error(saved.error.message);
      await addTaskEvent(db, item.task_id, "delivery_accepted", "whatsapp.reply", `parte ${item.part}; mensagem ${id}`);
      const remaining = await db.from("response_deliveries").select("id", { count: "exact", head: true }).eq("task_id", item.task_id).neq("status", "sent");
      if (remaining.error) throw new Error(remaining.error.message);
      if (!remaining.count) {
        // Também na retomada após reinício: resposta aceita entra no contexto
        // comum dos modelos, e não fica disponível apenas no painel de entrega.
        const full = await db.from("response_deliveries").select("text").eq("task_id",item.task_id).order("part");
        if (full.error) throw new Error(full.error.message);
        const text = (full.data ?? []).map((p) => p.text ?? "").join("");
        if (item.recipient.endsWith("@g.us")) await recordConvMessage(db,{ conv:item.recipient,text,fromMaia:true,name:"Maia" });
        else await recordMessage(db,{ channel:"whatsapp",author:"maia",text });
        await markTaskReplied(db, item.task_id);
        await addTaskEvent(db, item.task_id, "replied", null, "Todas as partes aceitas; não confirma leitura");
        await setTaskStatus(db, item.task_id, "concluida");
      }
    } catch (error) {
      const uncertain = accepted || !(error instanceof DeliveryError) || error.uncertain;
      const reason = error instanceof Error ? error.message : String(error);
      await db.from("response_deliveries").update({ status: uncertain ? "uncertain" : "failed", error: reason.slice(0, 500), finished_at: new Date().toISOString() }).eq("id", item.id);
      await addTaskEvent(db, item.task_id, "delivery_failed", "whatsapp.reply", reason).catch(() => {});
      await setTaskStatus(db, item.task_id, uncertain ? "incerta" : "falhou").catch(() => {});
      if (taskId) throw new DeliveryError(reason, uncertain);
    }
  }
}

export async function deliverResponse(db: Db, taskId: number, recipient: string, text: string, request?: string) {
  await persistResponse(db, taskId, recipient, text, request);
  await runResponseDeliveries(db, taskId);
  const r = await db.from("response_deliveries").select("status").eq("task_id", taskId);
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length || r.data.some((v) => v.status !== "sent")) throw new DeliveryError("Resposta persistida, mas entrega pendente/incerta; não executar o pedido novamente", true);
}

// Reenvio pontual de resposta rejeitada (4xx), nunca do trabalho/modelo nem de envio incerto.
export async function retryFailedResponse(db: Db, taskId: number) {
  const r = await db.from("response_deliveries").update({ status: "pending", error: null, finished_at: null, claimed_at: null }).eq("task_id",taskId).eq("status","failed").not("text","is",null).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Nenhuma resposta com rejeição confirmada; envios incertos não são repetidos");
  await addTaskEvent(db,taskId,"delivery_retry_requested","whatsapp.reply","Owner solicitou reenvio da resposta, sem executar novamente o trabalho");
  return { pending: r.data.length };
}
