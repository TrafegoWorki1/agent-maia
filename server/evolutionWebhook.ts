import { timingSafeEqual } from "node:crypto";

// Evento recebido da Evolution API. Só guardamos o tipo, a instância e o horário:
// o conteúdo das mensagens não é armazenado (minimização de dados pessoais).
export type EventKind = "connection" | "poll_vote" | "message" | "unknown";

export interface WebhookEvent {
  receivedAt: string;
  event: string;
  instance: string;
  kind: EventKind;
}

const MAX_EVENTS = 200;
const recent: WebhookEvent[] = [];

export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Aceita o segredo na query (?token=) ou no header x-webhook-token.
export function tokenFromRequest(queryToken: string | null, headerToken: string | string[] | undefined): string | null {
  if (queryToken) return queryToken;
  if (Array.isArray(headerToken)) return headerToken[0] ?? null;
  return headerToken ?? null;
}

// Triagem: decide o caminho do evento. Eventos sem caminho conhecido viram "unknown"
// e são registrados, nunca descartados em silêncio.
export function classify(body: Record<string, unknown>): EventKind {
  const event = String(body.event ?? "");
  const data = (body.data ?? {}) as Record<string, unknown>;
  if (event === "connection.update") return "connection";
  if (event === "messages.upsert") {
    const message = (data.message ?? {}) as Record<string, unknown>;
    if (message.pollUpdateMessage) return "poll_vote";
    if (message.conversation || message.extendedTextMessage || message.audioMessage) return "message";
  }
  return "unknown";
}

export function normalizeEvent(body: unknown, now = new Date()): WebhookEvent | null {
  if (!body || typeof body !== "object") return null;
  const v = body as Record<string, unknown>;
  if (typeof v.event !== "string" || typeof v.instance !== "string") return null;
  return { receivedAt: now.toISOString(), event: v.event, instance: v.instance, kind: classify(v) };
}

export function recordEvent(event: WebhookEvent): void {
  recent.push(event);
  if (recent.length > MAX_EVENTS) recent.splice(0, recent.length - MAX_EVENTS);
}

export function recentEvents(): WebhookEvent[] {
  return recent.slice();
}

// Número brasileiro sem o nono dígito (55 + DDD + 9 + 8 dígitos). O WhatsApp entrega alguns
// contatos sem esse 9 e o .env pode ter com ele: os dois formatos são o mesmo número.
export function canonicalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") return digits.slice(0, 4) + digits.slice(5);
  return digits;
}

export function samePhone(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = canonicalPhone(a);
  return left.length > 0 && left === canonicalPhone(b);
}

export interface IncomingText {
  from: string;
  text: string;
}

// Número de quem enviou (sem @). Mensagens enviadas pela própria conta (fromMe) retornam null.
export function senderOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const key = (data.key ?? {}) as Record<string, unknown>;
  if (key.fromMe === true) return null;
  // Contatos com identificador LID (…@lid) trazem o número real em remoteJidAlt.
  const remote = typeof key.remoteJid === "string" ? key.remoteJid : "";
  const alt = typeof key.remoteJidAlt === "string" ? key.remoteJidAlt : "";
  const jid = remote.endsWith("@lid") && alt ? alt : remote;
  return jid.split("@")[0] || null;
}

export interface AudioRef {
  key: Record<string, unknown>;
  mimetype: string;
  from: string;
}

// Áudio (nota de voz ou arquivo) recebido de um número. Retorna a referência para baixar o arquivo
// pela Evolution. Mensagens da própria conta e outros tipos retornam null.
export function audioFrom(body: unknown): AudioRef | null {
  const from = senderOf(body);
  if (!from || !body || typeof body !== "object") return null;
  const data = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const audio = message.audioMessage as Record<string, unknown> | undefined;
  if (!audio || typeof audio !== "object") return null;
  const key = (data.key ?? {}) as Record<string, unknown>;
  const mimetype = typeof audio.mimetype === "string" ? audio.mimetype : "audio/ogg";
  return { key, mimetype, from };
}

// Texto recebido de um número, com o remetente. Mensagens enviadas pela própria conta
// (fromMe, inclusive as respostas da Maia) e as que não são texto retornam null.
export function incomingText(body: unknown): IncomingText | null {
  const from = senderOf(body);
  if (!from || !body || typeof body !== "object") return null;
  const data = ((body as Record<string, unknown>).data ?? {}) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const extended = (message.extendedTextMessage ?? {}) as Record<string, unknown>;
  const text = typeof message.conversation === "string" ? message.conversation : extended.text;
  return typeof text === "string" && text.trim() ? { from, text: text.trim() } : null;
}
