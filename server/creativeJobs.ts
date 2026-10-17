import type { Db } from "./store.ts";
import { addTaskEvent } from "./store.ts";
import { createImage, existingImageForOutputKey, type ImageFormat } from "./imagegen.ts";
import { sendOwnerImage } from "./evolutionSend.ts";
import { listCreativeAssetsForJob, persistCreativeAsset } from "./creativeAssets.ts";
import { ownerRequester } from "./access.ts";

export type CreativeJobStatus = "queued" | "running" | "review" | "partial" | "uncertain";
export type CreativeItemStatus = "queued" | "generating" | "artifact_ready" | "preview_sending" | "ready_for_review" | "failed" | "uncertain";

export interface CreativeItemInput {
  briefing: string;
  format: ImageFormat;
  refs?: string[];
}

export interface CreativeJobItem {
  id: number;
  job_id: number;
  seq: number;
  source_task_id: number;
  briefing: string;
  format: ImageFormat;
  refs: string[];
  prior_status: "queued" | "artifact_ready";
  artifact_path: string | null;
}

export interface CreativeJobPanelRow {
  id: number;
  title: string;
  status: CreativeJobStatus;
  created_at: string;
  updated_at: string;
  source_task_id: number;
  items: Array<{ seq: number; format: ImageFormat; status: CreativeItemStatus; artifact_name: string | null; error: string | null; asset_id: string | null; asset_status: string | null; delivery_status: string | null; preview_url: string | null }>;
}

function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

export async function createCreativeJob(db: Db, input: { sourceTaskId: number; title: string; items: CreativeItemInput[] }): Promise<number> {
  if (!Number.isSafeInteger(input.sourceTaskId) || input.sourceTaskId < 1) throw new Error("Tarefa de origem inválida");
  const title = input.title.trim();
  if (!title || title.length > 160) throw new Error("Título do trabalho deve ter de 1 a 160 caracteres");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) throw new Error("Um trabalho criativo deve conter de 1 a 10 artes");
  for (const item of input.items) {
    if (!item.briefing.trim() || item.briefing.trim().length > 2000) throw new Error("Cada briefing deve ter de 1 a 2000 caracteres");
    if (!Object.hasOwn({ feed: true, story: true, quadrado: true }, item.format)) throw new Error("Formato de arte inválido");
    if ((item.refs?.length ?? 0) > 4) throw new Error("Cada arte aceita no máximo 4 referências");
  }
  const existing = await db.from("creative_jobs").select("id").eq("source_task_id", input.sourceTaskId).maybeSingle();
  if (existing.error) throw new Error(`Não foi possível verificar trabalhos criativos existentes: ${existing.error.message}`);
  if (existing.data) throw new Error(`Já existe o trabalho criativo #${Number(existing.data.id)} nesta tarefa; esta chamada não acrescentou artes. Consulte o progresso no painel.`);
  const { data, error } = await db.rpc("create_creative_job", {
    p_source_task_id: input.sourceTaskId,
    p_title: title,
    p_items: input.items.map((item) => ({ briefing: item.briefing.trim(), format: item.format, refs: item.refs ?? [] })),
  });
  if (error) throw new Error(`Não foi possível guardar o trabalho criativo: ${error.message}`);
  const id = Number(data);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("O banco não devolveu o ID do trabalho criativo");
  return id;
}

async function refreshCreativeJob(db: Db, jobId: number): Promise<void> {
  const { data, error } = await db.from("creative_job_items").select("status").eq("job_id", jobId);
  if (error) throw new Error(`Não foi possível atualizar o estado do trabalho: ${error.message}`);
  const statuses = (data ?? []).map((row) => String(row.status));
  const active = statuses.some((s) => ["queued", "generating", "artifact_ready", "preview_sending"].includes(s));
  const hasUncertain = statuses.includes("uncertain");
  const hasFailed = statuses.includes("failed");
  const status: CreativeJobStatus = active ? "running" : hasUncertain ? "uncertain" : hasFailed ? "partial" : "review";
  const { error: updateError } = await db.from("creative_jobs").update({ status, updated_at: new Date().toISOString(), ...(active ? {} : { finished_at: new Date().toISOString() }) }).eq("id", jobId);
  if (updateError) throw new Error(`Não foi possível guardar o estado do trabalho: ${updateError.message}`);
}

export async function listCreativeJobsForPanel(db: Db, limit = 20): Promise<CreativeJobPanelRow[]> {
  const { data, error } = await db.from("creative_jobs").select("id,title,status,created_at,updated_at,source_task_id").order("created_at", { ascending: false }).limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(`Não foi possível carregar os trabalhos criativos: ${error.message}`);
  const jobs = data ?? [];
  if (!jobs.length) return [];
  const ids = jobs.map((row) => Number(row.id));
  const { data: items, error: itemsError } = await db.from("creative_job_items").select("job_id,seq,format,status,artifact_path,error,asset_id").in("job_id", ids).order("seq", { ascending: true });
  if (itemsError) throw new Error(`Não foi possível carregar as artes do trabalho: ${itemsError.message}`);
  const byJob = new Map<number, CreativeJobPanelRow["items"]>();
  for (const row of items ?? []) {
    const id = Number(row.job_id);
    const path = typeof row.artifact_path === "string" ? row.artifact_path.replaceAll("\\", "/").split("/").pop() ?? null : null;
    const arr = byJob.get(id) ?? [];
    arr.push({ seq: Number(row.seq), format: row.format as ImageFormat, status: row.status as CreativeItemStatus, artifact_name: path, error: typeof row.error === "string" ? row.error : null, asset_id: typeof row.asset_id === "string" ? row.asset_id : null, asset_status: null, delivery_status: null, preview_url: null });
    byJob.set(id, arr);
  }
  return Promise.all(jobs.map(async (row) => {
    const id = Number(row.id);
    const assets = await listCreativeAssetsForJob(db, ownerRequester(), id).catch(() => []);
    const panelItems = (byJob.get(id) ?? []).map((item) => {
      const asset = assets.find((candidate) => candidate.sequence_number === item.seq);
      return { ...item, asset_id: asset?.asset_id ?? item.asset_id, asset_status: asset?.status ?? null, delivery_status: asset?.delivery_status ?? null, preview_url: asset?.preview_url ?? null };
    });
    return { id, title: String(row.title), status: row.status as CreativeJobStatus, created_at: String(row.created_at), updated_at: String(row.updated_at), source_task_id: Number(row.source_task_id), items: panelItems };
  }));
}

async function deliverPreview(db: Db, item: CreativeJobItem & { title: string; item_count: number }): Promise<void> {
  if (!item.artifact_path) throw new Error("Arte pronta sem caminho local");
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  if (!owner) {
    await db.from("creative_job_items").update({ status: "uncertain", error: "EVOLUTION_OWNER_NUMBER ausente; pré-visualização não enviada", updated_at: new Date().toISOString() }).eq("id", item.id);
    return;
  }
  try {
    const messageId = await sendOwnerImage(owner, item.artifact_path, `Rascunho ${item.seq}/${item.item_count} · ${item.title} · para aprovação (não publicado)`);
    if (!messageId) {
      await db.from("creative_job_items").update({ status: "uncertain", error: "WhatsApp aceitou ou pode ter aceite o rascunho, mas não devolveu ID; não reenviado automaticamente", updated_at: new Date().toISOString() }).eq("id", item.id);
      await db.from("creative_assets").update({ delivery_status: "uncertain", error_code: "preview_no_message_id", updated_at: new Date().toISOString() }).eq("job_item_id", item.id);
      return;
    }
    await db.from("creative_assets").update({ status: "pending_approval", delivery_id: messageId, delivery_status: "accepted", sent_at: new Date().toISOString(), error_code: null, updated_at: new Date().toISOString() }).eq("job_item_id", item.id);
    const { error } = await db.from("creative_job_items").update({ status: "ready_for_review", message_id: messageId, error: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", item.id);
    if (error) throw new Error(error.message);
    await addTaskEvent(db, item.source_task_id, "creative_item_ready", "preview", `trabalho=${item.job_id}; item=${item.seq}; mensagem=${messageId}`).catch(() => {});
  } catch (error) {
    const saved = await db.from("creative_job_items").update({ status: "uncertain", error: `Resultado do envio do rascunho incerto: ${safeError(error)}; não reenviado automaticamente`, updated_at: new Date().toISOString() }).eq("id", item.id);
    if (saved.error) console.error("[trabalho criativo] não consegui guardar estado incerto:", saved.error.message);
    await db.from("creative_assets").update({ delivery_status: "uncertain", error_code: "preview_send_uncertain", updated_at: new Date().toISOString() }).eq("job_item_id", item.id);
  }
}

export async function runCreativeQueueOnce(db: Db): Promise<boolean> {
  const { data, error } = await db.rpc("claim_next_creative_item");
  if (error) throw new Error(`Não foi possível reservar a próxima arte: ${error.message}`);
  const item = (Array.isArray(data) ? data[0] : null) as (CreativeJobItem & { title: string; item_count: number }) | null;
  if (!item) return false;
  if (item.prior_status === "artifact_ready") {
    try { await persistCreativeAsset(db, { jobId: item.job_id, itemId: item.id, sequence: item.seq, total: item.item_count, sourceTaskId: item.source_task_id, localPath: item.artifact_path ?? "" }); }
    catch (error) {
      await db.from("creative_job_items").update({ status: "uncertain", error: `Original não persistido; preview não enviado: ${safeError(error)}`, updated_at: new Date().toISOString() }).eq("id", item.id);
      await refreshCreativeJob(db, item.job_id); return true;
    }
    await deliverPreview(db, item);
    await refreshCreativeJob(db, item.job_id);
    return true;
  }

  const outputKey = `job-${item.job_id}-item-${item.seq}`;
  const generated = await createImage({ briefing: item.briefing, format: item.format, refs: item.refs ?? [], outputKey });
  if (!generated.ok) {
    const nextStatus = generated.uncertain ? "uncertain" : "failed";
    await db.from("creative_job_items").update({ status: nextStatus, error: safeError(generated.error), updated_at: new Date().toISOString(), ...(generated.uncertain ? {} : { finished_at: new Date().toISOString() }) }).eq("id", item.id);
    await addTaskEvent(db, item.source_task_id, "creative_item_failed", "gerar_imagem", `trabalho=${item.job_id}; item=${item.seq}; estado=${nextStatus}`).catch(() => {});
    await refreshCreativeJob(db, item.job_id);
    return true;
  }

  const ready = await db.from("creative_job_items").update({ status: "artifact_ready", artifact_path: generated.path, error: null, updated_at: new Date().toISOString() }).eq("id", item.id);
  if (ready.error) throw new Error(`A imagem foi gerada, mas não consegui guardar o checkpoint: ${ready.error.message}`);
  try { await persistCreativeAsset(db, { jobId: item.job_id, itemId: item.id, sequence: item.seq, total: item.item_count, sourceTaskId: item.source_task_id, localPath: generated.path }); }
  catch (error) {
    await db.from("creative_job_items").update({ status: "uncertain", error: `Original não persistido; preview não enviado: ${safeError(error)}`, updated_at: new Date().toISOString() }).eq("id", item.id);
    await refreshCreativeJob(db, item.job_id); return true;
  }
  await refreshCreativeJob(db, item.job_id);
  await deliverPreview(db, { ...item, artifact_path: generated.path });
  await refreshCreativeJob(db, item.job_id);
  return true;
}

export async function recoverStaleCreativeItems(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  const { data, error } = await db.from("creative_job_items").select("id,job_id,seq,status").in("status", ["generating", "preview_sending"]).lt("updated_at", cutoff).limit(50);
  if (error) throw new Error(`Não foi possível recuperar trabalhos criativos: ${error.message}`);
  let recovered = 0;
  for (const row of data ?? []) {
    const status = String(row.status);
    if (status === "generating") {
      const path = existingImageForOutputKey(`job-${row.job_id}-item-${row.seq}`);
      if (path) {
        await db.from("creative_job_items").update({ status: "artifact_ready", artifact_path: path, error: null, updated_at: now.toISOString() }).eq("id", row.id);
      } else {
        await db.from("creative_job_items").update({ status: "uncertain", error: "Worker reiniciou durante a geração; sem arte válida no diretório persistente. Requer revisão antes de tentar novamente.", updated_at: now.toISOString() }).eq("id", row.id);
      }
    } else {
      await db.from("creative_job_items").update({ status: "uncertain", error: "Worker reiniciou durante o envio do rascunho; resultado incerto e não reenviado automaticamente.", updated_at: now.toISOString() }).eq("id", row.id);
    }
    await refreshCreativeJob(db, Number(row.job_id));
    recovered++;
  }
  return recovered;
}
