import { audioFrom, incomingText, mediaFrom, normalizeEvent, samePhone } from "./evolutionWebhook.ts";

// Triagem do webhook: transforma um evento da Evolution numa linha da fila `inbox` do Supabase.
// Função pura (sem banco, sem rede), usada pela rota da Vercel. O worker do PC lê essas linhas depois.
// Texto e áudio só são guardados para o dono e o aprovador; de outros números fica só o tipo.

export type InboxKind = "text" | "audio" | "event" | "media";
export type InboxSender = "owner" | "approver" | "other" | "group" | "none" | "member";

export interface InboxRow {
  kind: InboxKind;
  sender: InboxSender;
  // Chave única do evento (key.id da mensagem). Evita processar duas vezes um reenvio da Evolution.
  key_id: string | null;
  payload: string | null;
}

// Grupos da Maia (tabela maia_groups): só neles, e só quando a mensagem chama a Maia, o texto entra na fila (apagado em 24 h).
// Exportada para o worker: áudio em grupo não tem texto antes de transcrever, então a chamada pelo nome só
// é checada depois (server/ownerRouter.ts, handleGroupAudio).
export const CALLS_MAIA = /(^|[^\p{L}])maia([^\p{L}]|$)/iu;

const REGISTER_GROUP = /(cadastr|atend|registr)\w*\s+(este|esse|neste|nesse|o)?\s*grupo|passa\s+a\s+atender/i;

// Estado de um grupo atendido pela Maia: a última resposta dela e para quem (conversa em andamento).
export interface GroupState {
  lastReplyAt?: string | null;
  lastReplyTo?: string | null;
}
const CONVERSATION_WINDOW_MS = 10 * 60 * 1000;

function digitsOf(jid: unknown): string {
  return typeof jid === "string" ? jid.split("@")[0].replace(/\D/g, "") : "";
}

// A mensagem é para a Maia? Chama pelo nome, menciona, responde a uma mensagem dela ou continua a conversa
// que ela estava tendo com a mesma pessoa nos últimos 10 minutos.
function addressedToMaia(body: Record<string, unknown>, data: Record<string, unknown>, text: string, participant: string, state: GroupState, now: Date): boolean {
  if (CALLS_MAIA.test(text)) return true;
  const own = digitsOf(body.sender);
  const message = (data.message ?? {}) as Record<string, unknown>;
  const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
  const context = (extended.contextInfo ?? data.contextInfo ?? {}) as Record<string, unknown>;
  if (own) {
    if (digitsOf(context.participant) === own) return true;
    const mentioned = Array.isArray(context.mentionedJid) ? context.mentionedJid : [];
    if (mentioned.some((j) => digitsOf(j) === own)) return true;
  }
  const last = state.lastReplyAt ? Date.parse(state.lastReplyAt) : NaN;
  return Boolean(state.lastReplyTo && participant && digitsOf(state.lastReplyTo) === digitsOf(participant) && !Number.isNaN(last) && now.getTime() - last <= CONVERSATION_WINDOW_MS);
}

export function toInboxRow(
  body: unknown,
  owner: string | undefined,
  approver: string | undefined,
  groups?: ReadonlyMap<string, GroupState>,
  now = new Date(),
  contacted?: ReadonlySet<string>,
  // Números de pessoas cadastradas com a permissão conversa.maia (nunca o dono: ele já tem rota própria).
  members?: ReadonlySet<string>,
): InboxRow | null {
  const event = normalizeEvent(body);
  if (!event || !body || typeof body !== "object") return null;
  const data = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  // Só mensagens novas têm dedupe; atualizações de status reusam o mesmo key.id e não entram aqui.
  const keyId = event.event === "messages.upsert" && typeof key.id === "string" ? key.id : null;

  // Grupo mudou por fora da Maia (foto, nome, participantes): o worker invalida o cache de grupos ao vivo
  // (server/groups.ts, resetGroupCache), em vez de só expirar por TTL ou reconsultar e bater no rate-overlimit.
  if (event.kind === "group_change") return { kind: "event", sender: "group", key_id: null, payload: "cache_reset" };
  if (event.kind !== "message") return { kind: "event", sender: "none", key_id: keyId, payload: null };

  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  // O endereço do grupo (não o texto) vai no payload, para o worker contar a atividade.
  if (remoteJid.endsWith("@g.us")) {
    if (groups?.has(remoteJid) && key.fromMe !== true) {
      const message = ((data.message ?? {}) as Record<string, unknown>);
      const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
      const raw = typeof message.conversation === "string" ? message.conversation : extended.text;
      const text = typeof raw === "string" ? raw.trim() : "";
      const participant = typeof key.participant === "string" && !key.participant.endsWith("@lid") ? key.participant : typeof key.participantAlt === "string" ? key.participantAlt : typeof key.participant === "string" ? key.participant : "";
      if (text) {
        // Grupo cadastrado: todo texto entra (memória de 7 dias, com autoria). Só responde quando chamada.
        const addressed = addressedToMaia(body as Record<string, unknown>, data, text, participant, groups.get(remoteJid) ?? {}, now);
        const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
        return { kind: "text", sender: "group", key_id: keyId, payload: JSON.stringify({ jid: remoteJid, participant: participant.split("@")[0], name, text, addressed }) };
      }
      // Áudio em grupo cadastrado: não tem texto ainda, então "chamar pelo nome" só é sabido após a transcrição
      // (feita pelo worker, server/ownerRouter.ts). Aqui já decidimos o resto de addressedToMaia (menção, resposta
      // à Maia, ou continuação da conversa em andamento) — o worker soma isso com CALLS_MAIA no texto transcrito.
      const audio = audioFrom(body);
      if (audio) {
        const addressed = addressedToMaia(body as Record<string, unknown>, data, "", participant, groups.get(remoteJid) ?? {}, now);
        const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
        return { kind: "audio", sender: "group", key_id: keyId, payload: JSON.stringify({ jid: remoteJid, participant: participant.split("@")[0], name, addressed, key: audio.key, mimetype: audio.mimetype }) };
      }
    }
    // Grupo novo: só o dono, chamando a Maia para atender ali ("Maia, cadastra/atende este grupo"), cadastra o grupo.
    if (!groups?.has(remoteJid) && key.fromMe !== true) {
      const message = ((data.message ?? {}) as Record<string, unknown>);
      const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
      const raw = typeof message.conversation === "string" ? message.conversation : extended.text;
      const text = typeof raw === "string" ? raw.trim() : "";
      const who = [key.participant, key.participantAlt].filter((v): v is string => typeof v === "string").map((v) => v.split("@")[0]);
      if (text && CALLS_MAIA.test(text) && REGISTER_GROUP.test(text) && who.some((n) => samePhone(n, owner))) {
        return { kind: "text", sender: "group", key_id: keyId, payload: JSON.stringify({ jid: remoteJid, register: true, text }) };
      }
    }
    return { kind: "event", sender: "group", key_id: keyId, payload: remoteJid };
  }

  const text = incomingText(body);
  if (text) {
    if (samePhone(text.from, owner)) return { kind: "text", sender: "owner", key_id: keyId, payload: text.text };
    if (samePhone(text.from, approver)) return { kind: "text", sender: "approver", key_id: keyId, payload: text.text };
    // Membro com a permissão conversa.maia: fala direto com a Maia no privado, dentro do que pode.
    if (members && [...members].some((n) => samePhone(n, text.from))) {
      const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
      return { kind: "text", sender: "member", key_id: keyId, payload: JSON.stringify({ from: text.from, name, text: text.text }) };
    }
    // Resposta de alguém que a Maia contatou nas últimas 48 h: o texto entra para ser repassado ao dono.
    if (contacted && [...contacted].some((n) => samePhone(n, text.from))) {
      const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
      return { kind: "text", sender: "other", key_id: keyId, payload: JSON.stringify({ from: text.from, name, text: text.text }) };
    }
    return { kind: "event", sender: "other", key_id: keyId, payload: null };
  }

  const audio = audioFrom(body);
  if (audio) {
    if (samePhone(audio.from, owner)) {
      // O áudio em si é baixado pela Evolution pelo worker: aqui só vai a referência.
      return { kind: "audio", sender: "owner", key_id: keyId, payload: JSON.stringify({ key: audio.key, mimetype: audio.mimetype }) };
    }
    // Áudio de membro autorizado: mesma ideia, com o número e o nome de quem mandou.
    if (members && [...members].some((n) => samePhone(n, audio.from))) {
      const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
      return { kind: "audio", sender: "member", key_id: keyId, payload: JSON.stringify({ key: audio.key, mimetype: audio.mimetype, from: audio.from, name }) };
    }
    return { kind: "event", sender: "other", key_id: keyId, payload: null };
  }

  // Imagem, vídeo ou documento: do dono ou de membro autorizado, só a referência (o arquivo é baixado pelo worker).
  // De outros números, nada.
  const media = mediaFrom(body);
  if (media) {
    const { key, mimetype, mediaType, fileName, caption, size } = media;
    if (samePhone(media.from, owner)) {
      return { kind: "media", sender: "owner", key_id: keyId, payload: JSON.stringify({ key, mimetype, mediaType, fileName, caption, size }) };
    }
    if (members && [...members].some((n) => samePhone(n, media.from))) {
      const name = typeof data.pushName === "string" ? data.pushName.trim().slice(0, 60) : "";
      return { kind: "media", sender: "member", key_id: keyId, payload: JSON.stringify({ key, mimetype, mediaType, fileName, caption, size, from: media.from, name }) };
    }
    return { kind: "event", sender: "other", key_id: keyId, payload: null };
  }

  // Mensagem enviada pela própria conta (fromMe) ou tipo não tratado.
  return { kind: "event", sender: "none", key_id: keyId, payload: null };
}
