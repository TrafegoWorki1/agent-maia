import { pathToFileURL } from "node:url";
import { loadLocalEnv } from "./loadEnv.ts";
import type { AudioRef, MediaRef } from "./evolutionWebhook.ts";
import { MEDIA_DIR, MEDIA_TTL_MS, MEDIA_EXT, MAX_BYTES, MEMBER_MEDIA_DIR, MEMBER_MEDIA_TTL_MS, purgeOldMedia, saveMedia } from "./media.ts";
import { purgeTempAdMedia } from "./integrations/adsMedia.ts";
import { retryPendingAudio } from "./audioRetry.ts";
import { handleApproverText } from "./groups.ts";
import { handleGroupAudio, handleGroupMedia, handleMemberAudio, handleMemberMedia, resumeGroupAudio, resumeMemberAudio, handleOwnerAudio, handleOwnerMedia, notifyOwner, routeOwnerText, type GroupAudioRef, type GroupMediaRef, type MemberAudioRef, type MemberMediaRef } from "./ownerRouter.ts";
import { markMessagesRead } from "./chats.ts";
import { addOwnerText, recoverBatches, runBatchDispatcher } from "./batching.ts";
import { startKnowledgeSync } from "./knowledgeSync.ts";
import { recoverRunningActions, runDueActions } from "./groupTools.ts";
import { notifyGroupJoin } from "./groupJoin.ts";
import type { GroupJoin } from "./evolutionWebhook.ts";
import { handleGroupMessage, handleMemberMessage, handleOwnerMessage, type GroupRequest } from "./maiaOwnerAgent.ts";
import { recordConvMessage } from "./conversations.ts";
import { hasRecentOutreach, upsertContact } from "./contacts.ts";
import { fetchLiveGroups, registerGroup, resetGroupCache } from "./groups.ts";
import { downloadMedia, sendFile, sendOwnerText } from "./evolutionSend.ts";
import { uploadReceivedMedia } from "./mediaStorage.ts";
import { recordReceivedMedia } from "./receivedMedia.ts";
import { handleVaultItem } from "./vault.ts";
import { mentionsMaiaByTag } from "./groupMention.ts";
import { runProactive } from "./proactive.ts";
import { recoverDeliveries, runTaskReminders } from "./taskReminders.ts";
import { runResponseDeliveries } from "./responseDelivery.ts";
import { type Db, type Sender, getDb, recordEvent, recordGroupActivity, recordMessage, recoverStaleTasks } from "./store.ts";

// Worker da fila `inbox`: roda no computador da Maia. Lê o que o webhook da Vercel gravou,
// processa com as mesmas regras do webhook local e marca cada item como concluído ou falho.
// Não faz envio sem passar pelas regras de sempre (dono, aprovador, SIM/NÃO).

export interface InboxItem {
  id: number;
  kind: "text" | "audio" | "event" | "media";
  sender: "owner" | "approver" | "other" | "group" | "none" | "member";
  payload: string | null;
  key_id: string | null;
  received_at?: string;
}

const BATCH = 10;
const IDLE_MS = 3_000;
const STALE_MS = 5 * 60 * 1000;
const PURGE_MS = 10 * 60 * 1000;

// Marca como lida só quando a mensagem de fato vai ser processada (ver server/chats.ts). Nunca bloqueia: é cosmético.
function markRead(jid: string, keyId: string | null): void {
  if (!keyId) return;
  void markMessagesRead(jid, [keyId]).catch((error) => console.error("[worker] marcar como lida:", error instanceof Error ? error.message : error));
}
const dmJid = (digits: string) => `${digits}@s.whatsapp.net`;

// Quem a Maia procurou (últimas 48 h) e responde: o dono é avisado mesmo que a pessoa esteja cadastrada como membro.
async function relayIfContacted(db: Db, number: string, name: string, what: string): Promise<void> {
  const digits = number.replace(/\D/g, "");
  if (!(await hasRecentOutreach(db, digits).catch(() => false))) return;
  await notifyOwner(`${name || `+${digits}`} respondeu: ${what}`).catch((error) => console.error("[worker] repasse:", error instanceof Error ? error.message : error));
}

// Processa um item. Retorna o resultado registrado em events (sem o texto de terceiros).
export async function processItem(db: Db, item: InboxItem, now = new Date()): Promise<void> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER ?? "";

  // Cofre de segredos: `cofre NOME | valor` nunca chega à IA nem ao histórico (server/vault.ts).
  if (item.kind === "text" && item.payload && (await handleVaultItem(db, item, notifyOwner))) {
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: item.sender as Sender, outcome: "vault" }, now);
    return;
  }

  if (item.sender === "owner" && item.kind === "text" && item.payload) {
    markRead(dmJid(owner), item.key_id);
    await recordMessage(db, { channel: "whatsapp", author: "owner", text: item.payload }, now);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "owner", outcome: "handled" }, now);
    // Entra no lote da conversa: o despacho é feito pelo laço de lotes, nunca aqui.
    const ownerAnswered = await handleApproverText({ db, notifyOwner, resumePlan: (prompt) => handleOwnerMessage(prompt) }, item.payload).catch(() => false);
    if (ownerAnswered) return;
    await addOwnerText(db, item.id, item.payload);
    return;
  }

  if (item.sender === "owner" && item.kind === "audio" && item.payload) {
    const ref = JSON.parse(item.payload) as Omit<AudioRef, "from">;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "owner", outcome: "audio" }, now);
    void handleOwnerAudio({ ...ref, from: owner }).catch((error) => console.error("[worker] áudio:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "owner" && item.kind === "media" && item.payload) {
    const ref = JSON.parse(item.payload) as Omit<MediaRef, "from">;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "owner", outcome: "media" }, now);
    void handleOwnerMedia({ ...ref, from: owner }).catch((error) => console.error("[worker] mídia:", error instanceof Error ? error.message : error));
    return;
  }

  // Membro cadastrado (permissão conversa.maia) falando com a Maia no privado.
  if (item.sender === "member" && item.kind === "text" && item.payload) {
    const req = JSON.parse(item.payload) as { from: string; name: string; text: string };
    const digits = req.from.replace(/\D/g, "");
    markRead(dmJid(digits), item.key_id);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "member" as Sender, outcome: "handled" }, now);
    await recordConvMessage(db, { conv: `dm:${digits}`, participant: digits, name: req.name, text: req.text, keyId: item.key_id, at: now }).catch((error) => console.error("[worker] conversa:", error instanceof Error ? error.message : error));
    await upsertContact(db, { number: digits, name: req.name, conv: `dm:${digits}`, source: "mensagem" }).catch(() => {});
    await relayIfContacted(db, digits, req.name, req.text.slice(0, 500));
    void handleMemberMessage(req).catch((error) => console.error("[worker] privado de membro:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "member" && item.kind === "audio" && item.payload) {
    const ref = JSON.parse(item.payload) as MemberAudioRef;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "member" as Sender, outcome: "audio" }, now);
    await relayIfContacted(db, ref.from, ref.name, "mandou um áudio");
    void handleMemberAudio(ref).catch((error) => console.error("[worker] áudio de membro:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "member" && item.kind === "media" && item.payload) {
    const ref = JSON.parse(item.payload) as MemberMediaRef;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "member" as Sender, outcome: "media" }, now);
    await relayIfContacted(db, ref.from, ref.name, `enviou um arquivo (${ref.fileName || ref.mediaType})`);
    void handleMemberMedia(ref).catch((error) => console.error("[worker] mídia de membro:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "approver" && item.kind === "text" && item.payload) {
    markRead(dmJid(process.env.EVOLUTION_APPROVER_NUMBER ?? ""), item.key_id);
    await recordMessage(db, { channel: "whatsapp", author: "approver", text: item.payload }, now);
    // Resposta de aprovação (SIM ou NÃO, com número): decidida pelo banco.
    const handled = await handleApproverText({ db, notifyOwner, resumePlan: (prompt) => handleOwnerMessage(prompt) }, item.payload).catch((error) => {
      console.error("[aprovacao]", error instanceof Error ? error.message : error);
      return false;
    });
    const outcome = handled ? "approval_answer" : "ignored";
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "approver", outcome }, now);
    return;
  }

  if (item.sender === "group" && item.kind === "text" && item.payload) {
    // Grupo operacional: alguém chamou a Maia. Responde no grupo, começando pelo nome de quem pediu.
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "group" as Sender, outcome: "handled" }, now);
    const request = JSON.parse(item.payload) as GroupRequest & { register?: boolean; addressed?: boolean };
    request.receivedAt = item.received_at ?? now.toISOString();
    if (item.key_id) request.keyId = item.key_id;
    if (!request.register) {
      // Memória do grupo (7 dias, com autoria) e agenda de contatos. Falha aqui não impede a resposta.
      await recordConvMessage(db, { conv: request.jid, participant: request.participant, name: request.name, text: request.text, keyId: item.key_id, at: new Date(request.receivedAt) }).catch((error) => console.error("[worker] conversa:", error instanceof Error ? error.message : error));
      await upsertContact(db, { number: request.participant, name: request.name, conv: request.jid, source: "grupo" }).catch(() => {});
      if (request.addressed === false && !mentionsMaiaByTag(request.text)) return;
    }
    markRead(request.jid, item.key_id);
    if (request.register) {
      void registerGroupFromOwner(db, request.jid).catch((error) => console.error("[worker] cadastro de grupo:", error instanceof Error ? error.message : error));
      return;
    }
    void handleGroupMessage(request).catch((error) => console.error("[worker] grupo:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "group" && item.kind === "media" && item.payload) {
    // Arquivo em grupo cadastrado: só é lido se um plano do dono esperava (server/ownerRouter.ts, handleGroupMedia).
    const ref = JSON.parse(item.payload) as GroupMediaRef;
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "group" as Sender, outcome: "media" }, now);
    void handleGroupMedia(ref).catch((error) => console.error("[worker] mídia de grupo:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "group" && item.kind === "audio" && item.payload) {
    // Áudio num grupo cadastrado: mesma regra do texto (memória de 7 dias, só responde quando chamada),
    // mas a transcrição decide "chamou pelo nome" (server/ownerRouter.ts, handleGroupAudio).
    const ref = JSON.parse(item.payload) as GroupAudioRef;
    ref.receivedAt = item.received_at ?? now.toISOString();
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "group" as Sender, outcome: "audio" }, now);
    markRead(ref.jid, item.key_id);
    void handleGroupAudio(ref).catch((error) => console.error("[worker] áudio de grupo:", error instanceof Error ? error.message : error));
    return;
  }

  // Resposta de um contato que a Maia procurou: guarda na conversa dele e repassa ao dono.
  if (item.sender === "other" && item.kind === "text" && item.payload) {
    const reply = JSON.parse(item.payload) as { from: string; name: string; text: string };
    const digits = reply.from.replace(/\D/g, "");
    markRead(dmJid(digits), item.key_id);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "other", outcome: "contact_reply" }, now);
    await recordConvMessage(db, { conv: `dm:${digits}`, participant: digits, name: reply.name, text: reply.text, keyId: item.key_id, at: now }).catch(() => {});
    await upsertContact(db, { number: digits, name: reply.name, conv: `dm:${digits}`, source: "mensagem" }).catch(() => {});
    await notifyOwner(`${reply.name || `+${digits}`} respondeu: ${reply.text.slice(0, 500)}`).catch((error) => console.error("[worker] repasse:", error instanceof Error ? error.message : error));
    return;
  }

  // Mídia de contato no repasse: baixa e encaminha o arquivo ao dono.
  if (item.sender === "other" && item.kind === "media" && item.payload) {
    const ref = JSON.parse(item.payload) as MemberMediaRef;
    const digits = ref.from.replace(/\D/g, "");
    markRead(dmJid(digits), item.key_id);
    await recordEvent(db, { event: "messages.upsert", kind: "message", sender: "other", outcome: "contact_media" }, now);
    await upsertContact(db, { number: digits, name: ref.name, conv: `dm:${digits}`, source: "mensagem" }).catch(() => {});
    const senderLabel = ref.name || `+${digits}`;
    const conv = `dm:${digits}`;
    try {
      const limit = MAX_BYTES[ref.mediaType];
      const { data, mimetype } = await downloadMedia(ref.key, ref.mimetype, limit);
      const ext: Record<string, string> = MEDIA_EXT as Record<string, string>;
      const fileName = ref.fileName || `${ref.mediaType === "image" ? "imagem" : ref.mediaType === "video" ? "video" : "documento"}${ext[mimetype] ?? ""}`;
      const path = saveMedia(data, fileName, Date.now(), MEMBER_MEDIA_DIR);
      // Sobe para o Storage antes de encaminhar: cópia durável que sobrevive reinicializações do worker.
      const storageUrl = await uploadReceivedMedia(data, fileName, mimetype, conv).catch((err) => {
        console.error("[worker] storage upload:", err instanceof Error ? err.message : err);
        return undefined;
      });
      await recordReceivedMedia(db, { conv, fromNumber: digits, fromName: ref.name, mediaType: ref.mediaType, fileName, caption: ref.caption ?? "", path, mimetype, storageUrl }).catch((err) => console.error("[worker] received_media:", err instanceof Error ? err.message : err));
      const caption = ref.caption ? `${senderLabel}: ${ref.caption}` : senderLabel;
      await sendFile(owner, path, ref.mediaType, mimetype, caption, fileName);
    } catch (error) {
      await notifyOwner(`${senderLabel} enviou um arquivo (${ref.fileName || ref.mediaType}) mas não foi possível encaminhar: ${error instanceof Error ? error.message : String(error)}`).catch(() => {});
    }
    return;
  }

  if (item.sender === "group" && item.kind === "event" && item.payload?.startsWith("{\"join\"")) {
    // Alguém entrou num grupo: invalida o cache e avisa o dono (só grupos cadastrados).
    const { join } = JSON.parse(item.payload) as { join: GroupJoin };
    resetGroupCache();
    await recordEvent(db, { event: "group-participants.update", kind: "event", sender: "group" as Sender, outcome: "join" }, now);
    await notifyGroupJoin(db, join, notifyOwner, (prompt) => handleOwnerMessage(prompt)).catch((error) => console.error("[worker] entrada no grupo:", error instanceof Error ? error.message : error));
    return;
  }

  if (item.sender === "group" && item.kind === "event" && item.payload === "cache_reset") {
    // Grupo mudou por fora da Maia (foto, nome, participantes): invalida o cache ao vivo em vez de
    // esperar os 15 min de TTL ou reconsultar e bater no rate-overlimit da Evolution.
    resetGroupCache();
    await recordEvent(db, { event: "groups.update", kind: "event", sender: "group" as Sender, outcome: "cache_reset" }, now);
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

// O dono pediu, dentro do grupo, para a Maia atender ali. A autoridade é o número do dono.
async function registerGroupFromOwner(db: Db, jid: string): Promise<void> {
  resetGroupCache();
  const live = await fetchLiveGroups();
  const group = live.groups.find((g) => g.jid === jid);
  await registerGroup(db, jid, group?.subject ?? jid, "cadastrado");
  await sendOwnerText(jid, `Pronto, passo a atender neste grupo (${group?.subject ?? "grupo"}) quando me chamarem pelo nome. Só o Herickson aprova ações que alteram algo.`);
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
  startKnowledgeSync(db);
  // Avisos automáticos (resumo diário, conexões, aprovações paradas). Antes ficavam só no webhook local.
  const proactive = () => runProactive(db, notifyOwner).catch((error) => console.error("[proativo]", error instanceof Error ? error.message : error));
  setTimeout(proactive, 30_000);
  setInterval(proactive, 5 * 60 * 1000);
  // Envios agendados em grupos (já aprovados ao agendar). Cada um sai uma vez; falha avisa o dono e não repete.
  const interruptedActions = await recoverRunningActions(db);
  if (interruptedActions > 0) console.warn(`[worker] ${interruptedActions} envio(s) agendado(s) interrompido(s) marcado(s) como falho(s)`);
  setInterval(() => runDueActions(db, notifyOwner).catch((error) => console.error("[agendados]", error instanceof Error ? error.message : error)), 30_000);
  const interrupted = await recoverStaleTasks(db, "whatsapp");
  if (interrupted > 0) console.warn(`[worker] ${interrupted} tarefa(s) interrompida(s) marcadas como incertas`);
  console.log(`[worker] iniciado em ${new Date().toISOString()}, aguardando a fila`);
  let delivering = false;
  const deliveries = async () => {
    if (delivering) return;
    delivering = true;
    try { await recoverDeliveries(db); await runResponseDeliveries(db); await runTaskReminders(db); }
    catch (error) { console.error("[entregas/lembretes]", error instanceof Error ? error.message : error); }
    finally { delivering = false; }
  };
  void deliveries();
  setInterval(() => void deliveries(), 30_000);
  // Áudio do dono que a transcrição não deu conta: tenta de novo a cada 10 min (um por vez) e mostra o texto quando voltar.
  let retryingAudio = false;
  setInterval(() => {
    if (retryingAudio) return;
    retryingAudio = true;
    void retryPendingAudio({ notifyOwner, resumeMember: resumeMemberAudio, resumeGroup: resumeGroupAudio })
      .catch((error) => console.error("[audio] nova tentativa:", error instanceof Error ? error.message : error))
      .finally(() => { retryingAudio = false; });
  }, 10 * 60 * 1000);

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
        const mediaPurged = purgeOldMedia(MEDIA_DIR, MEDIA_TTL_MS) + purgeOldMedia(MEMBER_MEDIA_DIR, MEMBER_MEDIA_TTL_MS);
        if (mediaPurged > 0) console.log(`[worker] ${mediaPurged} arquivo(s) de mídia (dono 24 h / membros 7 dias) apagado(s)`);
        const convPurged = await db.rpc("purge_group_messages");
        if (convPurged.error) console.error("[worker] limpeza das conversas:", convPurged.error.message);
        const adsMediaPurged = await purgeTempAdMedia(db).catch((error) => { console.error("[worker] limpeza do bucket de anúncios:", error instanceof Error ? error.message : error); return 0; });
        if (adsMediaPurged > 0) console.log(`[worker] ${adsMediaPurged} arquivo(s) temporário(s) de anúncio apagado(s) do Supabase`);
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
