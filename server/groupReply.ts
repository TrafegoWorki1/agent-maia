import type { Requester } from "./access.ts";
import { deliverResponse } from "./responseDelivery.ts";
import { addTaskEvent, markTaskReplied, setTaskStatus, taskSentTextToGroup, type Db } from "./store.ts";

export type GroupReplyOutcome = "delivered" | "already_sent" | "uncertain";

async function checkAlreadySent(db: Db, taskId: number, recipient: string): Promise<boolean | null> {
  try {
    return await taskSentTextToGroup(db, taskId, recipient);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[grupo] não foi possível verificar envio direto; respostas adicionais suprimidas:", detail);
    await setTaskStatus(db, taskId, "incerta").catch(() => {});
    await addTaskEvent(db, taskId, "group_reply_check_failed", "whatsapp.reply", detail.slice(0, 500)).catch(() => {});
    return null;
  }
}

async function finalizeAlreadySent(db: Db, taskId: number, recipient: string, detail: string): Promise<void> {
  await addTaskEvent(db, taskId, "group_reply_suppressed", "whatsapp.reply", `${detail}; grupo ${recipient}`).catch(() => {});
  await markTaskReplied(db, taskId).catch(() => {});
  await setTaskStatus(db, taskId, "concluida").catch(() => {});
}

/**
 * Evita mandar duas vezes a mesma resposta conversacional: ferramentas podem já
 * ter enviado texto ao grupo durante a execução do agente. Só suprime quando o
 * marcador confirma o mesmo grupo; falha de consulta é fail-closed para evitar
 * um segundo envio potencialmente duplicado.
 */
export async function deliverGroupReply(
  db: Db,
  taskId: number,
  recipient: string,
  text: string,
  request: string,
  who: Requester,
  beforeDelivery: () => Promise<unknown>,
): Promise<GroupReplyOutcome> {
  const alreadySent = await checkAlreadySent(db, taskId, recipient);
  if (alreadySent === null) return "uncertain";

  if (alreadySent) {
    await finalizeAlreadySent(db, taskId, recipient, "já houve texto enviado pela ferramenta");
    return "already_sent";
  }

  await beforeDelivery();
  await deliverResponse(db, taskId, recipient, text, request, who);
  return "delivered";
}

/** Em falha após uma ferramenta enviar texto, não manda aviso de erro adicional ao mesmo grupo. */
export async function shouldSendGroupFailureNotice(db: Db, taskId: number, recipient: string): Promise<boolean> {
  const alreadySent = await checkAlreadySent(db, taskId, recipient);
  if (alreadySent === null) return false;
  if (!alreadySent) return true;
  await finalizeAlreadySent(db, taskId, recipient, "resposta final interrompida após envio direto");
  return false;
}
