import { createHmac } from "node:crypto";
import type { Db } from "./store.ts";

export type OutboundStatus = "accepted" | "delivered" | "read" | "played" | "failed";
export interface DeliveryUpdate { messageId: string; recipient?: string | null; status: OutboundStatus }
export interface OutboundReceipt { messageId: string; recipient: string | null; status: OutboundStatus; updatedAt: string }
export interface OutboundReceiptPanelRow { messageId: string; destination: string; status: OutboundStatus; updatedAt: string }

export function outboundContentHash(text: string): string {
  const key = process.env.EVOLUTION_API_KEY;
  if (!key) throw new Error("chave de deduplicação ausente no ambiente do worker");
  return createHmac("sha256", key).update(text.normalize("NFC"), "utf8").digest("hex");
}

const rank: Record<OutboundStatus, number> = { failed: 0, accepted: 1, delivered: 2, read: 3, played: 4 };

/** Baileys WAMessageStatus: ERROR=0, PENDING=1, SERVER_ACK=2, DELIVERY_ACK=3, READ=4, PLAYED=5. */
export function normalizeOutboundStatus(value: unknown): OutboundStatus | null {
  if (typeof value === "number") {
    if (value === 0) return "failed";
    if (value === 1) return null;
    if (value === 2) return "accepted";
    if (value === 3) return "delivered";
    if (value === 4) return "read";
    if (value === 5) return "played";
    return null;
  }
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  if (status === "sent" || status === "server_ack" || status === "accepted") return "accepted";
  if (status === "delivered" || status === "delivery_ack") return "delivered";
  if (status === "read" || status === "read_ack") return "read";
  if (status === "played" || status === "played_ack") return "played";
  if (status === "failed" || status === "error") return "failed";
  return null;
}

export async function recordOutboundReceipt(db: Db, input: DeliveryUpdate & { contentHash?: string }): Promise<void> {
  if (!input.messageId.trim()) throw new Error("ID da mensagem ausente");
  const { error } = await db.rpc("record_outbound_receipt", {
    p_message_id: input.messageId,
    p_recipient: input.recipient ?? null,
    p_status: input.status,
    p_content_hash: input.contentHash ?? null,
  });
  if (error) throw new Error(`recibo de mensagem: ${error.message}`);
}

export async function recordAcceptedOutbound(db: Db, messageId: string, recipient: string, text?: string): Promise<void> {
  await recordOutboundReceipt(db, { messageId, recipient, status: "accepted", ...(text === undefined ? {} : { contentHash: outboundContentHash(text) }) });
}

export async function applyDeliveryUpdates(db: Db, updates: DeliveryUpdate[]): Promise<number> {
  let applied = 0;
  for (const update of updates) {
    await recordOutboundReceipt(db, update);
    applied++;
  }
  return applied;
}

export async function recentOutboundReceipts(db: Db, recipient: string, messageId?: string, limit = 5): Promise<OutboundReceipt[]> {
  let query = db.from("outbound_receipts").select("message_id, recipient, status, status_updated_at").eq("recipient", recipient);
  if (messageId) query = query.eq("message_id", messageId);
  const { data, error } = await query.order("status_updated_at", { ascending: false }).limit(Math.max(1, Math.min(limit, 10)));
  if (error) throw new Error(`consulta de status de mensagem: ${error.message}`);
  return (data ?? []).map((row) => ({
    messageId: String(row.message_id),
    recipient: typeof row.recipient === "string" ? row.recipient : null,
    status: row.status as OutboundStatus,
    updatedAt: String(row.status_updated_at),
  }));
}

export async function recentOutboundReceiptsForPanel(db: Db, limit = 50): Promise<OutboundReceiptPanelRow[]> {
  const { data, error } = await db.from("outbound_receipts").select("message_id, recipient, status, status_updated_at").order("status_updated_at", { ascending: false }).limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(`recibos recentes: ${error.message}`);
  const rows = data ?? [];
  const recipients = [...new Set(rows.map((r) => typeof r.recipient === "string" ? r.recipient : "").filter(Boolean))];
  const groupJids = recipients.filter((r) => r.endsWith("@g.us"));
  const numbers = recipients.filter((r) => !r.endsWith("@g.us"));
  const [groups, contacts] = await Promise.all([
    groupJids.length ? db.from("maia_groups").select("jid,name").in("jid", groupJids) : Promise.resolve({ data: [], error: null }),
    numbers.length ? db.from("contacts").select("number,name").in("number", numbers) : Promise.resolve({ data: [], error: null }),
  ]);
  if (groups.error || contacts.error) throw new Error("Não foi possível resolver o nome do destino dos recibos");
  const groupNames = new Map((groups.data ?? []).map((r) => [String(r.jid), String(r.name)]));
  const contactNames = new Map((contacts.data ?? []).map((r) => [String(r.number), String(r.name)]));
  return rows.map((row) => {
    const recipient = typeof row.recipient === "string" ? row.recipient : "";
    const destination = recipient.endsWith("@g.us") ? `Grupo: ${groupNames.get(recipient) ?? "não cadastrado"}` : contactNames.get(recipient) ? `Contato: ${contactNames.get(recipient)}` : "Destino privado";
    return { messageId: String(row.message_id), destination, status: row.status as OutboundStatus, updatedAt: String(row.status_updated_at) };
  });
}

export function summarizeReceipt(status: OutboundStatus): string {
  switch (status) {
    case "accepted": return "aceita pelo serviço de envio; entrega ainda não confirmada";
    case "delivered": return "entregue, conforme atualização recebida da Evolution";
    case "read": return "lida, conforme atualização recebida da Evolution";
    case "played": return "reproduzida, conforme atualização recebida da Evolution";
    case "failed": return "falha de entrega informada pela Evolution";
  }
}

export function monotonicStatus(current: OutboundStatus | null, next: OutboundStatus): OutboundStatus {
  if (!current || rank[next] >= rank[current]) return next;
  return current;
}
