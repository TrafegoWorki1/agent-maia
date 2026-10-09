import { createServer } from "node:http";
import { loadLocalEnv } from "./loadEnv.ts";
import { audioFrom, incomingText, normalizeEvent, recordEvent, recentEvents, samePhone, tokenFromRequest, tokenMatches, type AudioRef } from "./evolutionWebhook.ts";
import { resolveApprovalFromText } from "./maiaOwnerAgent.ts";
import { hasPendingGroupAction, resolveGroupActionFromText } from "./groups.ts";
import { notifyOwner, routeOwnerText, handleOwnerAudio } from "./ownerRouter.ts";
import { addOwnerText, recoverBatches, runBatchDispatcher } from "./batching.ts";
import { runProactive } from "./proactive.ts";
import { getDb, markMessageSeen, recordEvent as persistEvent, recordGroupActivity, recordMessage, recoverStaleTasks, type Sender } from "./store.ts";

// Servidor separado do `pnpm dev`: expõe somente /webhook, para ser o único endereço
// publicado no túnel. Não expõe /api/maia nem a interface.
loadLocalEnv();

const PORT = Number(process.env.WEBHOOK_PORT ?? 3100);
const MAX_BODY_BYTES = 64_000;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  };

  if (url.pathname !== "/webhook") return send(404, { error: "not_found" });
  if (req.method !== "POST") return send(405, { error: "method_not_allowed" });

  const token = tokenFromRequest(url.searchParams.get("token"), req.headers["x-webhook-token"]);
  if (!tokenMatches(token, process.env.EVOLUTION_WEBHOOK_SECRET)) {
    return send(401, { error: "unauthorized" });
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) return send(413, { error: "too_large" });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(400, { error: "invalid_json" });
  }

  const event = normalizeEvent(body);
  if (!event) return send(400, { error: "invalid_event" });

  // Responde antes de qualquer processamento para a Evolution não reenviar o mesmo evento.
  send(200, { ok: true });

  recordEvent(event);
  if (event.kind === "unknown") {
    console.warn(`[webhook] evento sem tratamento: ${event.instance} ${event.event}`);
  } else {
    console.log(`[webhook] ${event.receivedAt} ${event.instance} ${event.event} -> ${event.kind}`);
  }
  const db = getDb();
  // Roteamento por remetente: a conversa vem só do owner; a aprovação de escrita vem só do
  // aprovador (SIM/NÃO). Qualquer outro número é ignorado e o conteúdo não é guardado.
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  const approver = process.env.EVOLUTION_APPROVER_NUMBER;
  const msg = event.kind === "message" ? incomingText(body) : null;
  const audio = event.kind === "message" && !msg ? audioFrom(body) : null;
  let sender: Sender = "none";
  let outcome = "logged";
  // A Evolution pode reenviar o mesmo evento: cada mensagem é processada uma única vez.
  const keyId = (body as { data?: { key?: { id?: unknown } } }).data?.key?.id;
  if ((msg || audio) && typeof keyId === "string" && !(await markMessageSeen(db, keyId))) {
    await persistEvent(db, { event: event.event, kind: event.kind, sender: "other", outcome: "deduplicated" });
    return;
  }
  // Grupos: registra só a atividade (quando e quantas). O texto das pessoas do grupo não é guardado.
  const remoteJid = (body as { data?: { key?: { remoteJid?: unknown } } }).data?.key?.remoteJid;
  if (event.kind === "message" && typeof remoteJid === "string" && remoteJid.endsWith("@g.us")) {
    await recordGroupActivity(db, remoteJid);
    await persistEvent(db, { event: event.event, kind: event.kind, sender: "group", outcome: "activity" });
    return;
  }
  if (audio) {
    // Áudio só é baixado e transcrito quando vem do dono. Qualquer outro número é ignorado sem download.
    const isOwner = samePhone(audio.from, owner);
    await persistEvent(db, { event: event.event, kind: event.kind, sender: isOwner ? "owner" : "other", outcome: isOwner ? "audio" : "ignored" });
    if (isOwner) void handleOwnerAudio(audio);
    return;
  }
  if (msg) {
    if (samePhone(msg.from, owner)) {
      sender = "owner";
      outcome = "handled";
      await recordMessage(db, { channel: "whatsapp", author: "owner", text: msg.text });
      // Agrupa com as mensagens seguidas do dono (15 s de silêncio, máximo de 60 s) antes de executar.
      void addOwnerText(db, null, msg.text).catch((error) => console.error("[lotes] falha ao agrupar:", error instanceof Error ? error.message : error));
    } else if (samePhone(msg.from, approver)) {
      sender = "approver";
      await recordMessage(db, { channel: "whatsapp", author: "approver", text: msg.text });
      if (resolveApprovalFromText(msg.text)) {
        outcome = "approval_answer";
      } else if (hasPendingGroupAction()) {
        outcome = "approval_answer";
        void resolveGroupActionFromText(msg.text, { db, notifyOwner }).catch((error) => console.error("[grupos]", error instanceof Error ? error.message : error));
      } else {
        outcome = "ignored";
      }
    } else {
      sender = "other";
      outcome = "ignored";
    }
  }
  // Só metadados entram no banco: tipo, remetente (papel) e destino. Nunca o texto de terceiros.
  await persistEvent(db, { event: event.event, kind: event.kind, sender, outcome });
});

server.listen(PORT, "127.0.0.1", () => {
  const db = getDb();
  void recoverBatches(db).catch((error) => console.error("[lotes] recuperação:", error instanceof Error ? error.message : error));
  void runBatchDispatcher(db, (text) => routeOwnerText(text));
  // Tarefas do WhatsApp que estavam em andamento antes deste processo: viram "incerta", sem reexecutar.
  void recoverStaleTasks(db, "whatsapp").then((interrupted) => {
    if (interrupted > 0) console.warn(`[webhook] ${interrupted} tarefa(s) interrompida(s) marcadas como incertas`);
  });
  // Avisos proativos ao dono (resumo diário, conexões, aprovações paradas). Não usam o plano do Claude.
  const proactive = () => runProactive(db, notifyOwner).catch((error) => console.error("[proativo]", error instanceof Error ? error.message : error));
  setTimeout(proactive, 30_000);
  setInterval(proactive, 5 * 60 * 1000);
  console.log(`Webhook local em http://127.0.0.1:${PORT}/webhook (eventos em memória: ${recentEvents().length})`);
});
