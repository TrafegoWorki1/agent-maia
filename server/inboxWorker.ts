import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./loadEnv.ts";
import type { AudioRef } from "./evolutionWebhook.ts";
import { handleApproverText } from "./groups.ts";
import { handleOwnerAudio, notifyOwner, routeOwnerText } from "./ownerRouter.ts";
import { addOwnerText, recoverBatches, runBatchDispatcher } from "./batching.ts";
import { type Db, type Sender, getDb, recordEvent, recordGroupActivity, recordMessage, recoverStaleTasks } from "./store.ts";

// Worker da fila `inbox`: roda no computador da Maia. Lê o que o webhook da Vercel gravou,
// processa com as mesmas regras do webhook local e marca cada item como concluído ou falho.
// Não faz envio sem passar pelas regras de sempre (dono, aprovador, SIM/NÃO).

export interface InboxItem {
  id: number;
  kind: "text" | "audio" | "event";
  sender: "owner" | "approver" | "other" | "group" | "none";
  payload: string | null;
  key_id: string | null;
}

const BATCH = 10;
const IDLE_MS = 3_000;
const STALE_MS = 5 * 60 * 1000;
const PURGE_MS = 10 * 60 * 1000;

// Processa um item. Retorna o resultado registrado em events (sem o texto de terceiros).
export async function processItem(db: Db, item: InboxItem, now = new Date()): Promise<void> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER ?? "";

  if (item.sender === "owner" && item.kind === "text" && item.payload) {
    await recordMessage(db, { channel: "whatsapp", author: "owner", text: item.payload }, now);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "owner", outcome: "handled" }, now);
    // Entra no lote da conversa: o despacho é feito pelo laço de lotes, nunca aqui.
    await addOwnerText(db, item.id, item.payload);
    return;
  }

  if (item.sender === "owner" && item.kind === "audio" && item.payload) {
    const ref = JSON.parse(item.payload) as Omit<AudioRef, "from">;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "owner", outcome: "audio" }, now);
    void handleOwnerAudio({ ...ref, from: owner }).catch((error) => console.error("[worker] áudio:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "approver" && item.kind === "text" && item.payload) {
    await recordMessage(db, { channel: "whatsapp", author: "approver", text: item.payload }, now);
    // Resposta de aprovação (SIM ou NÃO, com número): decidida pelo banco.
    const handled = await handleApproverText({ db, notifyOwner }, item.payload).catch((error) => {
      console.error("[aprovacao]", error instanceof Error ? error.message : error);
      return false;
    });
    const outcome = handled ? "approval_answer" : "ignored";
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "approver", outcome }, now);
    return;
  }

  if (item.sender === "group" && item.payload) {
    // Só o endereço do grupo: conta a atividade, sem texto.
    await recordGroupActivity(db, item.payload, now);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "group" as Sender, outcome: "activity" }, now);
    return;
  }

  // Demais eventos (conexão, mensagens de outros números, mensagens da própria conta): só o tipo.
  const kind = item.kind === "event" ? "event" : "message";
  await recordEvent(db, { event: item.kind === "event" ? "evento" : "messages.upsert", kind, sender: item.sender as Sender, outcome: "logged" }, now);
}

// Pega um lote, processa e marca cada item. Um item com erro não derruba os outros.
export async function runOnce(db: Db = getDb()): Promise<number> {
  const claimed = await db.rpc("claim_inbox", { p_limit: BATCH });
  if (claimed.error) throw new Error(`claim_inbox: ${claimed.error.message}`);
  const items = (claimed.data ?? []) as (InboxItem & { received_at: string })[];
  for (const item of items) {
    try {
      await processItem(db, item);
      await db.from("inbox").update({ status: "concluido", finished_at: new Date().toISOString() }).eq("id", item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[worker] item ${item.id} falhou:`, message);
      await db.from("inbox").update({ status: "falhou", finished_at: new Date().toISOString(), error: message.slice(0, 300) }).eq("id", item.id);
    }
  }
  return items.length;
}

// Itens que ficaram "processando" quando o worker caiu: viram falhos, para não serem executados de novo.
async function recoverClaimed(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  const { data, error } = await db
    .from("inbox")
    .update({ status: "falhou", finished_at: new Date().toISOString(), error: "worker reiniciou durante o processamento" })
    .eq("status", "processando")
    .lt("claimed_at", cutoff)
    .select("id");
  if (error) throw new Error(`recuperação da fila: ${error.message}`);
  if (data && data.length > 0) console.warn(`[worker] ${data.length} item(ns) interrompido(s) marcado(s) como falho(s)`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const db = getDb();
  await recoverClaimed(db);
  const batchesRecovered = await recoverBatches(db);
  if (batchesRecovered > 0) console.warn(`[worker] ${batchesRecovered} lote(s) interrompido(s) marcado(s) como incerto(s)`);
  void runBatchDispatcher(db, (text) => routeOwnerText(text));
  const interrupted = await recoverStaleTasks(db, "whatsapp");
  if (interrupted > 0) console.warn(`[worker] ${interrupted} tarefa(s) interrompida(s) marcadas como incertas`);
  console.log(`[worker] iniciado em ${new Date().toISOString()}, aguardando a fila`);

  let lastPurge = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("[worker] parando");
    process.exit(0);
  });

  while (!stopping) {
    try {
      const count = await runOnce(db);
      if (count === 0) await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
      if (Date.now() - lastPurge > PURGE_MS) {
        lastPurge = Date.now();
        const purged = await db.rpc("purge_inbox_payloads");
        if (purged.error) console.error("[worker] limpeza do texto:", purged.error.message);
      }
    } catch (error) {
      console.error("[worker] erro no ciclo:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 2));
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
