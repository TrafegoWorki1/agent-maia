import type { Db } from "./store.ts";

// Agrupamento das mensagens do dono: junta mensagens em sequência num só pedido.
// Regra: o lote fica pronto após WINDOW_S de silêncio, ou quando completa MAX_S desde a primeira mensagem.
// Só mensagens do dono entram aqui. Aprovações (SIM/NÃO) não passam pelo agrupamento.

export const OWNER_CONVERSA = "owner:whatsapp";

export function batchWindowSeconds(): number {
  return Number(process.env.MAIA_BATCH_WINDOW_S ?? 15);
}

export function batchMaxSeconds(): number {
  return Number(process.env.MAIA_BATCH_MAX_S ?? 60);
}

// Verdadeiro quando o lote deve ser despachado agora.
export function isDue(batch: { ready_at: string; deadline_at: string }, now: Date): boolean {
  return now.getTime() >= Date.parse(batch.ready_at) || now.getTime() >= Date.parse(batch.deadline_at);
}

// Texto único do lote, na ordem de chegada. Cada mensagem fica numa linha.
export function consolidate(items: { seq: number; payload: string | null }[]): string {
  return [...items]
    .sort((a, b) => a.seq - b.seq)
    .map((item) => (item.payload ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

// Entrada atômica no banco: abre um lote ou junta a mensagem ao lote aberto da conversa.
// Repetir o mesmo item da inbox não duplica nada (idempotente).
export async function addOwnerText(db: Db, inboxId: number | null, text: string): Promise<number> {
  const { data, error } = await db.rpc("add_batch_item", {
    p_conversa: OWNER_CONVERSA,
    p_inbox_id: inboxId,
    p_text: text,
    p_window_s: batchWindowSeconds(),
    p_max_s: batchMaxSeconds(),
  });
  if (error) throw new Error(`add_batch_item: ${error.message}`);
  return Number(data);
}

// Lotes vencidos são decididos pelo relógio do banco (função due_owner_batches), não pelo PC.
// Cada lote é reservado um por um: só quem muda o status de aguardando para em_execucao despacha.
export async function dispatchDueBatches(db: Db, dispatch: (text: string) => Promise<number | null>): Promise<number> {
  const due = await db.rpc("due_owner_batches");
  if (due.error) throw new Error(`lotes vencidos: ${due.error.message}`);
  let dispatched = 0;
  for (const id of (due.data ?? []) as number[]) {
    const claim = await db
      .from("message_batches")
      .update({ status: "em_execucao", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "aguardando_mensagens")
      .select("id");
    if (claim.error || !claim.data || claim.data.length === 0) continue;

    const items = await db.from("batch_items").select("seq, payload").eq("batch_id", id);
    if (items.error) {
      await db.from("message_batches").update({ status: "falhou", error: items.error.message.slice(0, 300) }).eq("id", id);
      continue;
    }
    const text = consolidate((items.data ?? []) as { seq: number; payload: string | null }[]);
    try {
      const taskId = text ? await dispatch(text) : null;
      // Se a gravação do fim falhar, o erro aparece no log; no reinício o lote vai para incerto.
      const done = await db.from("message_batches").update({ status: "concluido", task_id: taskId, updated_at: new Date().toISOString() }).eq("id", id);
      if (done.error) throw new Error(`gravar fim do lote: ${done.error.message}`);
      dispatched += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.from("message_batches").update({ status: "falhou", error: message.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
      console.error(`[lotes] lote ${id} falhou:`, message);
    }
  }
  return dispatched;
}

// Reinício: lote que estava em execução não é reexecutado (pode ter agido). Vira incerto para conferência.
export async function recoverBatches(db: Db): Promise<number> {
  const { data, error } = await db
    .from("message_batches")
    .update({ status: "incerto", error: "processo reiniciado durante a execução", updated_at: new Date().toISOString() })
    .eq("status", "em_execucao")
    .select("id");
  if (error) throw new Error(`recuperação de lotes: ${error.message}`);
  return data?.length ?? 0;
}

// Laço de despacho: roda em qualquer processo que atenda o dono (webhook local ou worker).
// A reserva de cada lote é atômica, então dois processos não executam o mesmo lote.
export async function runBatchDispatcher(db: Db, dispatch: (text: string) => Promise<number | null>): Promise<never> {
  for (;;) {
    try {
      const count = await dispatchDueBatches(db, dispatch);
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, 2_000));
    } catch (error) {
      console.error("[lotes] erro no despacho:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
  }
}
