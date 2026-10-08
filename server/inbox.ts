import { audioFrom, incomingText, normalizeEvent, samePhone } from "./evolutionWebhook.ts";

// Triagem do webhook: transforma um evento da Evolution numa linha da fila `inbox` do Supabase.
// Função pura (sem banco, sem rede), usada pela rota da Vercel. O worker do PC lê essas linhas depois.
// Texto e áudio só são guardados para o dono e o aprovador; de outros números fica só o tipo.

export type InboxKind = "text" | "audio" | "event";
export type InboxSender = "owner" | "approver" | "other" | "group" | "none";

export interface InboxRow {
  kind: InboxKind;
  sender: InboxSender;
  // Chave única do evento (key.id da mensagem). Evita processar duas vezes um reenvio da Evolution.
  key_id: string | null;
  payload: string | null;
}

export function toInboxRow(body: unknown, owner: string | undefined, approver: string | undefined): InboxRow | null {
  const event = normalizeEvent(body);
  if (!event || !body || typeof body !== "object") return null;
  const data = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  // Só mensagens novas têm dedupe; atualizações de status reusam o mesmo key.id e não entram aqui.
  const keyId = event.event === "messages.upsert" && typeof key.id === "string" ? key.id : null;

  if (event.kind !== "message") return { kind: "event", sender: "none", key_id: keyId, payload: null };

  const remoteJid = typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (remoteJid.endsWith("@g.us")) return { kind: "event", sender: "group", key_id: keyId, payload: null };

  const text = incomingText(body);
  if (text) {
    if (samePhone(text.from, owner)) return { kind: "text", sender: "owner", key_id: keyId, payload: text.text };
    if (samePhone(text.from, approver)) return { kind: "text", sender: "approver", key_id: keyId, payload: text.text };
    return { kind: "event", sender: "other", key_id: keyId, payload: null };
  }

  const audio = audioFrom(body);
  if (audio) {
    if (samePhone(audio.from, owner)) {
      // O áudio em si é baixado pela Evolution pelo worker: aqui só vai a referência.
      return { kind: "audio", sender: "owner", key_id: keyId, payload: JSON.stringify({ key: audio.key, mimetype: audio.mimetype }) };
    }
    return { kind: "event", sender: "other", key_id: keyId, payload: null };
  }

  // Mensagem enviada pela própria conta (fromMe) ou tipo não tratado.
  return { kind: "event", sender: "none", key_id: keyId, payload: null };
}
