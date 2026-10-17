import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import type { Requester } from "./access.ts";
import { sendFile } from "./evolutionSend.ts";
import { samePhone } from "./evolutionWebhook.ts";
import { supabaseFromEnv } from "./supabaseClient.ts";
import type { Db } from "./store.ts";

const BUCKET = "midia-recebida";
const SEARCH_CAP = 200;

type AssetStatus = "draft" | "pending_approval" | "approved" | "rejected" | "published" | "missing" | "archived";
type DeliveryStatus = "not_sent" | "accepted" | "sent" | "delivered" | "failed" | "uncertain";

export interface CreativeAsset {
  asset_id: string;
  job_id: number | null;
  job_item_id: number | null;
  project_id: string | null;
  client_id: string | null;
  conversation_id: string;
  source_message_id: string | null;
  asset_kind: "image" | "carousel_slide" | "video" | "document" | "archive";
  sequence_number: number | null;
  sequence_total: number | null;
  title: string;
  filename: string;
  mime_type: string;
  storage_provider: string;
  storage_key: string | null;
  thumbnail_key: string | null;
  checksum: string | null;
  status: AssetStatus;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  sent_at: string | null;
  delivery_id: string | null;
  delivery_status: DeliveryStatus;
  error_code: string | null;
}

export type CreativeAssetRef = Pick<CreativeAsset, "asset_id" | "job_id" | "project_id" | "client_id" | "asset_kind" | "sequence_number" | "sequence_total" | "title" | "filename" | "mime_type" | "status" | "created_at" | "updated_at" | "approved_at" | "sent_at" | "delivery_id" | "delivery_status" | "error_code">;

function publicAssetRef(asset: CreativeAsset): CreativeAssetRef {
  const { asset_id, job_id, project_id, client_id, asset_kind, sequence_number, sequence_total, title, filename, mime_type, status, created_at, updated_at, approved_at, sent_at, delivery_id, delivery_status, error_code } = asset;
  return { asset_id, job_id, project_id, client_id, asset_kind, sequence_number, sequence_total, title, filename, mime_type, status, created_at, updated_at, approved_at, sent_at, delivery_id, delivery_status, error_code };
}

export type AssetResolution =
  | { status: "found"; asset: CreativeAssetRef; title: string; coverage: string }
  | { status: "ambiguous"; options: Array<{ asset_id: string; title: string; sequence_number: number | null; sequence_total: number | null; filename: string; client_id: string | null; project_id: string | null }>; coverage: string }
  | { status: "missing"; searched: string; coverage: string; next_step: string };

function ownerConversation(requester: Requester): string {
  if (requester.role !== "owner" || requester.groupScope) throw new Error("Catálogo privado disponível somente ao owner numa conversa privada.");
  const digits = requester.number.replace(/\D/g, "");
  const configured = process.env.EVOLUTION_OWNER_NUMBER?.replace(/\D/g, "") ?? "";
  if (!digits || !configured || !samePhone(digits, configured)) throw new Error("Não foi possível confirmar a identidade do owner para este ativo.");
  return `dm:${digits}`;
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "arte.png";
  return base.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/, "").slice(0, 120) || "arte.png";
}

/** Persiste o original em Storage e associa o item de job ao catálogo. Chamadas repetidas não criam ativos duplicados. */
export async function persistCreativeAsset(db: Db, input: { jobId: number; itemId: number; sequence: number; total: number; sourceTaskId: number; localPath: string }): Promise<CreativeAsset> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  if (!owner) throw new Error("Owner não configurado para associar o ativo à conversa privada.");
  const conversationId = `dm:${owner.replace(/\D/g, "")}`;
  const [job, task] = await Promise.all([
    db.from("creative_jobs").select("id,title").eq("id", input.jobId).single(),
    db.from("work_tasks").select("client_ref_id,project_ref_id").eq("source_task_id", input.sourceTaskId).maybeSingle(),
  ]);
  if (job.error || !job.data) throw new Error(`Trabalho criativo não encontrado: ${job.error?.message ?? "sem dados"}`);
  if (task.error) throw new Error(`Não foi possível conferir o escopo do projeto: ${task.error.message}`);
  const existing = await db.from("creative_assets").select("*").eq("job_item_id", input.itemId).maybeSingle();
  if (existing.error) throw new Error(`Não foi possível consultar o catálogo: ${existing.error.message}`);
  let row = existing.data as CreativeAsset | null;
  const bytes = readFileSync(input.localPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const assetId = row?.asset_id ?? randomUUID();
  const ext = extname(input.localPath).toLowerCase() || ".png";
  const mimeType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  const filename = cleanFileName(`arte-${input.sequence}${ext}`);
  const storageKey = `creative-assets/${input.jobId}/${assetId}/${filename}`;
  const title = String(job.data.title);
  const count = input.total;
  const assetKind = count > 1 ? "carousel_slide" : "image";
  if (!row) {
    const inserted = await db.from("creative_assets").insert({
      asset_id: assetId, job_id: input.jobId, job_item_id: input.itemId,
      client_id: task.data?.client_ref_id ?? null, project_id: task.data?.project_ref_id ?? null,
      conversation_id: conversationId, source_message_id: null, asset_kind: assetKind,
      sequence_number: input.sequence, sequence_total: count, title, filename, mime_type: mimeType,
      storage_provider: "supabase", storage_key: null, thumbnail_key: null, checksum,
      status: "missing", delivery_status: "not_sent", error_code: "storage_pending",
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error(`Não foi possível criar o registro do ativo: ${inserted.error?.message ?? "sem dados"}`);
    row = inserted.data as CreativeAsset;
  }
  if (!row.storage_key || row.checksum !== checksum || row.status === "missing") {
    const client = supabaseFromEnv();
    const uploaded = await client.storage.from(BUCKET).upload(storageKey, bytes, { contentType: mimeType, upsert: true });
    if (uploaded.error) {
      await db.from("creative_assets").update({ status: "missing", error_code: "storage_upload_failed", updated_at: new Date().toISOString() }).eq("asset_id", assetId);
      throw new Error(`O original foi gerado, mas o armazenamento persistente falhou: ${uploaded.error.message}`);
    }
    const saved = await db.from("creative_assets").update({ storage_key: storageKey, thumbnail_key: storageKey, checksum, status: "draft", error_code: null, updated_at: new Date().toISOString() }).eq("asset_id", assetId).select("*").single();
    if (saved.error || !saved.data) throw new Error(`Original armazenado, mas não consegui atualizar o catálogo: ${saved.error?.message ?? "sem dados"}`);
    row = saved.data as CreativeAsset;
  }
  await db.from("creative_job_items").update({ asset_id: assetId }).eq("id", input.itemId);
  return row;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function sequenceFromReference(reference: string): number | null {
  const match = /(?:rascunho|lamina|imagem|slide)\s*(\d+)(?:\s*\/\s*\d+)?/i.exec(normalize(reference));
  if (match) return Number(match[1]);
  return null;
}

/** Resolve exclusivamente no histórico da conversa privada do owner; não usa a lista genérica de artes locais. */
export async function resolveCreativeAsset(db: Db, requester: Requester, context: { conversationId?: string; clientId?: string; projectId?: string; reference: string }): Promise<AssetResolution> {
  const ownConversation = ownerConversation(requester);
  const conversationId = context.conversationId ?? ownConversation;
  if (conversationId !== ownConversation) throw new Error("A busca foi recusada porque a conversa informada não pertence ao owner autenticado.");
  let query = db.from("creative_assets").select("asset_id,job_id,job_item_id,project_id,client_id,conversation_id,source_message_id,asset_kind,sequence_number,sequence_total,title,filename,mime_type,storage_provider,storage_key,thumbnail_key,checksum,status,created_at,updated_at,approved_at,sent_at,delivery_id,delivery_status,error_code").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(SEARCH_CAP);
  if (context.clientId) query = query.eq("client_id", context.clientId);
  if (context.projectId) query = query.eq("project_id", context.projectId);
  const { data, error } = await query;
  if (error) throw new Error(`Busca do catálogo de ativos falhou: ${error.message}`);
  const rows = (data ?? []) as CreativeAsset[];
  const reference = context.reference.trim();
  const exactId = rows.find((r) => r.asset_id.toLowerCase() === reference.toLowerCase());
  let matches = exactId ? [exactId] : rows;
  const sequence = sequenceFromReference(reference);
  const normalizedReference = normalize(reference);
  const words = normalizedReference.replace(/(?:rascunho|lamina|imagem|slide)\s*\d+(?:\s*\/\s*\d+)?/i, "").replace(/\b(a|o|os|as|do|da|dos|das|de|carrossel|arquivo|que|faltou|aquele|aquela|aquilo|esse|essa|este|esta|ultimo|ultima)\b/g, " ").trim();
  if (!exactId && sequence !== null) matches = matches.filter((r) => r.sequence_number === sequence && r.status !== "archived");
  if (!exactId && /\bcapa\b/i.test(reference)) matches = matches.filter((r) => r.sequence_number === 1);
  if (!exactId && /\b(encerramento|ultima|ultimo)\b/i.test(normalize(reference))) matches = matches.filter((r) => r.sequence_number === r.sequence_total);
  if (words) matches = matches.filter((r) => normalize(r.title).includes(words) || words.split(/\s+/).every((w) => normalize(r.title).includes(w)));
  if (!exactId && !sequence && !/\bcapa\b|encerramento|ultima|ultimo/i.test(normalizedReference) && !words) matches = rows.slice(0, 1);
  const coverage = `Pesquisa nos ${rows.length} ativos mais recentes da conversa${rows.length === SEARCH_CAP ? ` (limite de ${SEARCH_CAP}; ativos mais antigos podem não estar nesta página)` : ""}.`;
  if (matches.length === 1) return { status: "found", asset: publicAssetRef(matches[0]), title: matches[0].title, coverage };
  if (matches.length > 1) return { status: "ambiguous", options: matches.slice(0, 6).map((r) => ({ asset_id: r.asset_id, title: r.title, sequence_number: r.sequence_number, sequence_total: r.sequence_total, filename: r.filename, client_id: r.client_id, project_id: r.project_id })), coverage };
  return { status: "missing", searched: reference, coverage, next_step: "Posso procurar por outro título/identificador ou pedir que a imagem original seja enviada novamente." };
}

export async function getCreativeAsset(db: Db, requester: Requester, assetId: string): Promise<CreativeAsset> {
  const conv = ownerConversation(requester);
  const { data, error } = await db.from("creative_assets").select("*").eq("asset_id", assetId).eq("conversation_id", conv).maybeSingle();
  if (error) throw new Error(`Não foi possível consultar o ativo: ${error.message}`);
  if (!data) throw new Error("Ativo não encontrado neste escopo de conversa.");
  return data as CreativeAsset;
}

export async function signedAssetUrl(db: Db, requester: Requester, assetId: string, ttlSeconds = 300): Promise<string> {
  const asset = await getCreativeAsset(db, requester, assetId);
  if (!asset.storage_key || asset.status === "missing" || asset.status === "archived") throw new Error("O original não está disponível no armazenamento.");
  const client = supabaseFromEnv();
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(asset.storage_key, Math.max(60, Math.min(ttlSeconds, 600)));
  if (error || !data?.signedUrl) throw new Error(`Não foi possível criar uma pré-visualização privada: ${error?.message ?? "URL ausente"}`);
  return data.signedUrl;
}

export type ResendResult = { status: DeliveryStatus; deliveryId: string | null; message: string };
/** Reenvia somente para o privado do owner. A reserva persistida torna repetições e resultados incertos fail-closed. */
export async function resendCreativeAsset(db: Db, requester: Requester, input: { assetId: string; channel: string; destination: string; idempotencyKey: string }): Promise<ResendResult> {
  const conversation = ownerConversation(requester);
  const ownerNumber = process.env.EVOLUTION_OWNER_NUMBER ?? "";
  if (input.channel !== "whatsapp" || input.destination !== "owner_private" || !samePhone(requester.number, ownerNumber)) throw new Error("Reenvio permitido somente ao privado do owner autenticado.");
  if (!/^[A-Za-z0-9:_-]{1,180}$/.test(input.idempotencyKey)) throw new Error("Chave idempotente inválida.");
  const asset = await getCreativeAsset(db, requester, input.assetId);
  if (asset.conversation_id !== conversation) throw new Error("O ativo não pertence a esta conversa.");
  if (!asset.storage_key || asset.status === "missing" || asset.status === "archived" || asset.status === "rejected") throw new Error("O original não está disponível para reenvio neste estado.");
  const open = await db.from("creative_asset_deliveries").select("id,status,delivery_id").eq("asset_id", asset.asset_id).in("status", ["prepared", "accepted", "sent", "uncertain"]).limit(1);
  if (open.error) throw new Error(`Não foi possível verificar reenvios anteriores: ${open.error.message}`);
  if (open.data?.length) {
    const prior = open.data[0];
    return { status: prior.status as DeliveryStatus, deliveryId: typeof prior.delivery_id === "string" ? prior.delivery_id : null, message: prior.status === "uncertain" ? "Há uma tentativa de resultado incerto; confira o WhatsApp. Não será repetida automaticamente." : "Já existe uma tentativa aberta para este ativo; não foi enviado novamente." };
  }
  const inserted = await db.from("creative_asset_deliveries").insert({ asset_id: asset.asset_id, idempotency_key: input.idempotencyKey, channel: "whatsapp", destination_scope: "owner_private", status: "prepared" }).select("id").single();
  if (inserted.error) {
    if (inserted.error.code === "23505") return { status: "not_sent", deliveryId: null, message: "Esta chave de idempotência já foi usada; a ação não foi repetida." };
    throw new Error(`Não foi possível reservar o reenvio: ${inserted.error.message}`);
  }
  const deliveryRowId = Number(inserted.data.id);
  let directory: string | null = null;
  let sendAttempted = false;
  let sentId: string | null = null;
  try {
    const client = supabaseFromEnv();
    const downloaded = await client.storage.from(BUCKET).download(asset.storage_key);
    if (downloaded.error || !downloaded.data) {
      await db.from("creative_assets").update({ status: "missing", error_code: "storage_object_missing", updated_at: new Date().toISOString() }).eq("asset_id", asset.asset_id);
      await db.from("creative_asset_deliveries").update({ status: "failed", error_code: "storage_object_missing", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", deliveryRowId);
      return { status: "failed", deliveryId: null, message: "Encontrei o trabalho, mas o arquivo original não está disponível no storage." };
    }
    directory = mkdtempSync(join(tmpdir(), "maia-asset-"));
    const filePath = join(directory, cleanFileName(asset.filename));
    writeFileSync(filePath, Buffer.from(await downloaded.data.arrayBuffer()));
    sendAttempted = true;
    const id = await sendFile(ownerNumber, filePath, "image", asset.mime_type, `Reenvio · ${asset.title} · lâmina ${asset.sequence_number ?? 1}/${asset.sequence_total ?? 1}`, asset.filename);
    if (!id) {
      await db.from("creative_asset_deliveries").update({ status: "uncertain", error_code: "connector_no_id", updated_at: new Date().toISOString() }).eq("id", deliveryRowId);
      await db.from("creative_assets").update({ delivery_status: "uncertain", error_code: "connector_no_id", updated_at: new Date().toISOString() }).eq("asset_id", asset.asset_id);
      return { status: "uncertain", deliveryId: null, message: "O conector não devolveu ID; resultado incerto e sem repetição automática." };
    }
    sentId = id;
    const deliverySaved = await db.from("creative_asset_deliveries").update({ status: "accepted", delivery_id: id, updated_at: new Date().toISOString() }).eq("id", deliveryRowId);
    const assetSaved = await db.from("creative_assets").update({ delivery_id: id, delivery_status: "accepted", sent_at: new Date().toISOString(), error_code: null, updated_at: new Date().toISOString() }).eq("asset_id", asset.asset_id);
    if (deliverySaved.error || assetSaved.error) throw new Error("O WhatsApp aceitou o envio, mas não foi possível persistir o recibo; resultado incerto.");
    return { status: "accepted", deliveryId: id, message: `O WhatsApp aceitou o envio do ativo; a entrega ainda depende de recibo. ID ${id}.` };
  } catch (error) {
    const status = sendAttempted ? "uncertain" : "failed";
    const safeCode = sendAttempted ? "connector_result_uncertain" : "asset_preparation_failed";
    await db.from("creative_asset_deliveries").update({ status, delivery_id: sentId, error_code: safeCode, ...(status === "failed" ? { finished_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", deliveryRowId);
    await db.from("creative_assets").update({ delivery_id: sentId, delivery_status: status, error_code: safeCode, updated_at: new Date().toISOString() }).eq("asset_id", asset.asset_id);
    return { status, deliveryId: sentId, message: status === "uncertain" ? "O resultado do conector é incerto; confira o WhatsApp. Não vou repetir automaticamente." : "Não consegui preparar o original para reenvio. O estado foi marcado como falha e não houve envio." };
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}

export async function updateCreativeAssetDelivery(db: Db, messageId: string, status: "accepted" | "delivered" | "failed"): Promise<void> {
  const { data: rows, error } = await db.from("creative_assets").select("asset_id").eq("delivery_id", messageId).limit(10);
  if (error) throw new Error(`Não foi possível ligar o recibo ao ativo: ${error.message}`);
  for (const row of rows ?? []) {
    const update = await db.from("creative_assets").update({ delivery_status: status, updated_at: new Date().toISOString() }).eq("asset_id", row.asset_id);
    if (update.error) throw new Error(`Não foi possível atualizar o estado de entrega do ativo: ${update.error.message}`);
    const delivery = await db.from("creative_asset_deliveries").update({ status, updated_at: new Date().toISOString(), ...(status === "delivered" || status === "failed" ? { finished_at: new Date().toISOString() } : {}) }).eq("delivery_id", messageId);
    if (delivery.error) throw new Error(`Não foi possível atualizar o histórico de envio do ativo: ${delivery.error.message}`);
  }
}

export async function listCreativeAssetsForJob(db: Db, requester: Requester, jobId: number): Promise<Array<CreativeAssetRef & { preview_url: string | null }>> {
  const conversation = ownerConversation(requester);
  const { data: job, error: jobError } = await db.from("creative_jobs").select("id").eq("id", jobId).maybeSingle();
  if (jobError || !job) throw new Error("Trabalho criativo não encontrado.");
  const { data, error } = await db.from("creative_assets").select("*").eq("job_id", jobId).eq("conversation_id", conversation).order("sequence_number", { ascending: true }).limit(20);
  if (error) throw new Error(`Não foi possível consultar os ativos do trabalho: ${error.message}`);
  return Promise.all((data ?? []).map(async (r) => {
    const asset = r as CreativeAsset;
    let preview_url: string | null = null;
    if (asset.storage_key && asset.status !== "missing" && asset.status !== "archived") {
      try { const client = supabaseFromEnv(); const signed = await client.storage.from(BUCKET).createSignedUrl(asset.thumbnail_key ?? asset.storage_key, 300); preview_url = signed.data?.signedUrl ?? null; } catch { preview_url = null; }
    }
    return { ...publicAssetRef(asset), preview_url };
  }));
}
