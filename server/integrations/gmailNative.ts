// Cliente Gmail API v1 via REST direto. Reusa o OAuth do Google Drive; o refresh token precisa
// incluir gmail.readonly e gmail.send. As escritas só são chamadas depois da política de aprovação.

import { getAccessToken } from "./googleDrive.ts";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function failure(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "o Gmail recusou a autenticação (token sem gmail.readonly/gmail.send ou expirado)";
  if (status === 404) return "o Gmail não encontrou a mensagem pedida";
  if (status === 429) return "o Gmail limitou as chamadas (muitas requisições)";
  if (status >= 500) return "o Gmail está indisponível no momento";
  const detail = body && typeof body === "object" ? String((body as { error?: { message?: unknown } }).error?.message ?? "") : "";
  return `o Gmail recusou o pedido (HTTP ${status})${detail ? `: ${detail.slice(0, 160)}` : ""}`;
}

async function request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!response.ok) throw new GmailError(failure(response.status, json), response.status);
  return json;
}

function cleanHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedSubject(subject: string): string {
  return `=?UTF-8?B?${Buffer.from(cleanHeader(subject), "utf8").toString("base64")}?=`;
}

export interface BuildMessageInput {
  to: string[];
  subject: string;
  text: string;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string;
  references?: string;
}

export function buildMimeMessage(input: BuildMessageInput): { ok: true; raw: string } | { ok: false; error: string } {
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const to = input.to.map((v) => cleanHeader(v)).filter(Boolean);
  const cc = (input.cc ?? []).map((v) => cleanHeader(v)).filter(Boolean);
  const bcc = (input.bcc ?? []).map((v) => cleanHeader(v)).filter(Boolean);
  if (!to.length || [...to, ...cc, ...bcc].some((v) => !email.test(v))) return { ok: false, error: "destinatário de e-mail inválido" };
  if (!input.subject.trim()) return { ok: false, error: "assunto vazio" };
  if (!input.text.trim()) return { ok: false, error: "corpo do e-mail vazio" };
  const headers = [
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodedSubject(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    ...(input.inReplyTo ? [`In-Reply-To: ${cleanHeader(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${cleanHeader(input.references)}`] : []),
  ];
  const mime = `${headers.join("\r\n")}\r\n\r\n${input.text.replace(/\r?\n/g, "\r\n")}`;
  return { ok: true, raw: Buffer.from(mime, "utf8").toString("base64url") };
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

type GmailMessage = { id?: unknown; threadId?: unknown; snippet?: unknown; payload?: { headers?: Array<{ name?: unknown; value?: unknown }> } };

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find((h) => String(h.name ?? "").toLowerCase() === name.toLowerCase());
  return String(found?.value ?? "");
}

export function parseMessageSummary(raw: unknown): GmailMessageSummary {
  const message = (raw ?? {}) as GmailMessage;
  const id = String(message.id ?? "");
  const threadId = String(message.threadId ?? "");
  if (!id || !threadId) throw new GmailError("o Gmail devolveu uma mensagem sem ID/threadId; não vou tratá-la como evidência", 502);
  return { id, threadId, from: header(message, "From"), subject: header(message, "Subject"), date: header(message, "Date"), snippet: String(message.snippet ?? "") };
}

async function getMessage(messageId: string): Promise<GmailMessage> {
  const fields = "id,threadId,snippet,payload(headers)";
  return await request("GET", `/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=References&fields=${encodeURIComponent(fields)}`) as GmailMessage;
}

export async function unreadCount(): Promise<number> {
  const raw = await request("GET", "/labels/UNREAD?fields=messagesUnread") as { messagesUnread?: unknown };
  const count = Number(raw.messagesUnread ?? 0);
  if (!Number.isInteger(count) || count < 0) throw new GmailError("o Gmail devolveu uma contagem inválida de não lidos", 502);
  return count;
}

export async function searchMessages(query: string, maxResults = 10): Promise<GmailMessageSummary[]> {
  const q = query.trim();
  if (!q) throw new GmailError("informe uma busca do Gmail", 400);
  const limit = Math.min(20, Math.max(1, Math.trunc(maxResults)));
  const list = await request("GET", `/messages?q=${encodeURIComponent(q)}&maxResults=${limit}&fields=messages(id,threadId)`) as { messages?: Array<{ id?: unknown }> };
  const ids = (list.messages ?? []).map((m) => String(m.id ?? "")).filter(Boolean).slice(0, limit);
  return Promise.all(ids.map(async (id) => parseMessageSummary(await getMessage(id))));
}

export interface SentMessage { id: string; threadId: string }

function parseSent(raw: unknown): SentMessage {
  const value = (raw ?? {}) as { id?: unknown; threadId?: unknown };
  const id = String(value.id ?? "");
  const threadId = String(value.threadId ?? "");
  if (!id || !threadId) throw new GmailError("o Gmail não devolveu ID/threadId; não vou confirmar o envio", 502);
  return { id, threadId };
}

export async function sendEmail(input: BuildMessageInput): Promise<SentMessage> {
  const built = buildMimeMessage(input);
  if (!built.ok) throw new GmailError(built.error, 400);
  return parseSent(await request("POST", "/messages/send", { raw: built.raw }));
}

function addressOnly(value: string): string {
  return /<([^>]+)>/.exec(value)?.[1]?.trim() || value.trim();
}

export async function replyEmail(messageId: string, text: string): Promise<SentMessage> {
  const original = await getMessage(messageId);
  const id = String(original.id ?? "");
  const threadId = String(original.threadId ?? "");
  if (!id || !threadId) throw new GmailError("a mensagem original veio sem ID/threadId", 502);
  const to = addressOnly(header(original, "Reply-To") || header(original, "From"));
  const originalSubject = header(original, "Subject") || "(sem assunto)";
  const messageIdHeader = header(original, "Message-ID");
  const references = [header(original, "References"), messageIdHeader].filter(Boolean).join(" ");
  const built = buildMimeMessage({
    to: [to],
    subject: /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`,
    text,
    inReplyTo: messageIdHeader || undefined,
    references: references || undefined,
  });
  if (!built.ok) throw new GmailError(built.error, 400);
  return parseSent(await request("POST", "/messages/send", { raw: built.raw, threadId }));
}
