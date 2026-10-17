import { existsSync } from "node:fs";
import type { Db } from "./store.ts";
import { addTaskEvent } from "./store.ts";
import { sendOwnerImage } from "./evolutionSend.ts";
import { recordAcceptedOutbound } from "./outboundReceipts.ts";

export interface CreativeAssetMatch {
  itemId: number;
  jobId: number;
  jobTitle: string;
  seq: number;
  briefing: string;
  format: string;
  status: string;
  artifactPath: string | null;
  messageId: string | null;
  createdAt: string;
}

export type AssetResolveResult =
  | { kind: "found"; asset: CreativeAssetMatch }
  | { kind: "multiple"; assets: CreativeAssetMatch[]; question: string }
  | { kind: "not_found"; searched: string };

// "lâmina 8", "imagem 3", "arte 2", "item 5", "slide 1"
function extractSeq(q: string): number | null {
  const m =
    q.match(/(?:lâmina|lamina|imagem|arte|item|slide|frame|peça|peca|quadro)\s+(\d+)/i) ??
    q.match(/\b(\d+)\s*(?:ª|°|º|a)?\s*(?:arte|imagem|lâmina|lamina|item|slide)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 10 ? n : null;
}

// "a capa", "cover", "primeira arte"
function isCoverRef(q: string): boolean {
  return /\b(?:capa|cover|thumbnail|primeira\s+arte|primeiro\s+item)\b/i.test(q);
}

// "o arquivo que faltou", "a que falhou", "incerta"
function wantsFailed(q: string): boolean {
  return /\b(?:faltou|falhou|não\s+chegou|perdid[ao]|incerto)\b/i.test(q);
}

const STOP_RX =
  /\b(?:lâmina|lamina|imagem|arte|item|capa|cover|essa|esse|aquela|aquele|o|a|as|os|de|do|da|que|faltou|errou|falhou|incerto|reenviar|reenvia|mandar|manda|me|novamente|outra|vez|por|favor|pfv)\b/gi;

function extractKeywords(q: string): string[] {
  return q
    .replace(STOP_RX, " ")
    .replace(/[^\wÀ-ú\s]/g, " ")
    .split(/\s+/)
    .map(k => k.trim())
    .filter(k => k.length >= 3);
}

type ItemRow = {
  id: number; job_id: number; seq: number; briefing: string; format: string;
  status: string; artifact_path: string | null; message_id: string | null;
  created_at: string;
  creative_jobs: { title: string } | Array<{ title: string }> | null;
};

function rowToMatch(r: ItemRow): CreativeAssetMatch {
  const j = Array.isArray(r.creative_jobs) ? r.creative_jobs[0] : r.creative_jobs;
  return {
    itemId: r.id, jobId: r.job_id, jobTitle: j?.title ?? "",
    seq: r.seq, briefing: r.briefing, format: r.format, status: r.status,
    artifactPath: r.artifact_path, messageId: r.message_id, createdAt: r.created_at,
  };
}

async function fetchItems(
  db: Db, jobId: number | undefined, seq: number | null, failed: boolean,
): Promise<CreativeAssetMatch[]> {
  let q = db
    .from("creative_job_items")
    .select("id,job_id,seq,briefing,format,status,artifact_path,message_id,created_at,creative_jobs(title)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (jobId !== undefined) q = q.eq("job_id", jobId);
  if (seq !== null) q = q.eq("seq", seq);
  if (failed) q = q.in("status", ["failed", "uncertain"]);
  const { data, error } = await q;
  if (error) throw new Error(`busca de artes: ${error.message}`);
  return (data as ItemRow[]).map(rowToMatch);
}

function scoreAndRank(
  assets: CreativeAssetMatch[], kws: string[], preferJobId?: number,
): CreativeAssetMatch[] {
  return assets
    .map(a => {
      let s = 0;
      if (preferJobId !== undefined && a.jobId === preferJobId) s += 100;
      if (a.artifactPath) s += 2;
      for (const kw of kws) {
        if (a.briefing.toLowerCase().includes(kw)) s += 10;
        else if (a.jobTitle.toLowerCase().includes(kw)) s += 5;
      }
      return { a, s };
    })
    .filter(({ s }) => kws.length === 0 || s > 0)
    .sort((x, y) => y.s - x.s)
    .map(({ a }) => a);
}

/**
 * Resolve natural language reference to a specific creative_job_item.
 * Checks currentJobId scope first, then falls back to global.
 */
export async function resolveCreativeAsset(
  db: Db, query: string, currentJobId?: number,
): Promise<AssetResolveResult> {
  const searched = query.trim().slice(0, 200);
  if (!searched) return { kind: "not_found", searched: "(consulta vazia)" };

  const seq = extractSeq(searched);
  const cover = isCoverRef(searched);
  const failed = wantsFailed(searched);
  const kws = extractKeywords(searched);
  const effectiveSeq = cover ? 1 : seq;

  let candidates = scoreAndRank(
    await fetchItems(db, currentJobId, effectiveSeq, failed), kws, currentJobId,
  );
  if (candidates.length === 0 && currentJobId !== undefined) {
    candidates = scoreAndRank(
      await fetchItems(db, undefined, effectiveSeq, failed), kws, undefined,
    );
  }

  if (candidates.length === 0) return { kind: "not_found", searched };
  if (candidates.length === 1) return { kind: "found", asset: candidates[0] };

  const top = candidates.slice(0, 4);
  const question =
    `Encontrei ${candidates.length} arte(s) para "${searched.slice(0, 50)}". Qual delas?\n` +
    top
      .map((a, i) =>
        `${i + 1}. Arte ${a.seq} (${a.format}) · "${a.jobTitle.slice(0, 40)}" — ${a.briefing.slice(0, 60)}${a.briefing.length > 60 ? "…" : ""}`,
      )
      .join("\n") +
    (candidates.length > 4 ? `\n(…e mais ${candidates.length - 4})` : "");

  return { kind: "multiple", assets: top, question };
}

/** List recent creative assets, optionally filtered by job. */
export async function listRecentCreativeAssets(
  db: Db, limit = 10, jobId?: number,
): Promise<CreativeAssetMatch[]> {
  let q = db
    .from("creative_job_items")
    .select("id,job_id,seq,briefing,format,status,artifact_path,message_id,created_at,creative_jobs(title)")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 30)));
  if (jobId !== undefined) q = q.eq("job_id", jobId);
  const { data, error } = await q;
  if (error) throw new Error(`listagem de artes: ${error.message}`);
  return (data as ItemRow[]).map(rowToMatch);
}

/** One-line summary for display in tool responses. */
export function formatAssetSummary(a: CreativeAssetMatch): string {
  const fileOk = a.artifactPath ? existsSync(a.artifactPath) : false;
  const labels: Record<string, string> = {
    queued: "na fila", generating: "gerando", artifact_ready: "gerada",
    preview_sending: "enviando prévia", ready_for_review: "pronta p/ revisão",
    failed: "falhou", uncertain: "incerto",
  };
  const stato = labels[a.status] ?? a.status;
  const file = fileOk ? " ✓ arquivo ok" : a.artifactPath ? " ⚠ arquivo ausente" : "";
  return `Arte ${a.seq} (${a.format}) · "${a.jobTitle}" · ${stato}${file}`;
}

export type ResendResult =
  | { ok: true; messageId: string }
  | { ok: false; state: "uncertain" | "failed" | "blocked"; message: string };

export interface PanelRetryInput {
  itemId: number;
  ownerNumber: string;
  confirmUncertain?: boolean;
  retryKey?: string;
}

type IdempCached = {
  result_ok: boolean;
  message_id: string | null;
  state: string | null;
  error_message: string | null;
};

function cachedToResult(c: IdempCached): ResendResult {
  if (c.state === "pending") {
    return { ok: false, state: "uncertain", message: "Envio já em andamento para esta operação. Tente novamente em instantes." };
  }
  if (c.result_ok && c.message_id) return { ok: true, messageId: c.message_id };
  return {
    ok: false,
    state: (c.state ?? "uncertain") as "uncertain" | "failed" | "blocked",
    message: c.error_message ?? "Operação anterior registrada.",
  };
}

/**
 * Build idempotency key for arte_reenviar.
 * With taskId: key is scoped to the task (allows retry in a new task).
 * Without taskId: deterministic key based on item+owner (deduplicated for 48h).
 */
export function buildIdempotencyKey(taskId: number | undefined, itemId: number, ownerNumber: string): string {
  return taskId !== undefined
    ? `task-${taskId}-item-${itemId}`
    : `resend-item-${itemId}-${ownerNumber}`;
}

/**
 * Panel-initiated retry: revalidates ownership, checks the last idempotency state,
 * and calls resendCreativeArt with a fresh key. Blocks uncertain unless
 * confirmUncertain is explicitly set. If retryKey is provided it is reused,
 * giving the caller client-side idempotency on double-click or network retry.
 */
export async function retryCreativeSendFromPanel(db: Db, input: PanelRetryInput): Promise<ResendResult> {
  const { itemId, ownerNumber, confirmUncertain = false, retryKey } = input;

  // Revalidate: ownerNumber must match the configured env owner.
  const envOwner = (process.env.EVOLUTION_OWNER_NUMBER ?? "").replace(/\D/g, "");
  if (!envOwner || ownerNumber.replace(/\D/g, "") !== envOwner) {
    return { ok: false, state: "blocked", message: "Número do destinatário não coincide com o dono configurado." };
  }

  // Inspect the most recent idempotency record for this item+owner.
  const lastOp = db
    .from("creative_resend_idempotency")
    .select("state")
    .eq("item_id", itemId)
    .eq("owner_number", ownerNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: last } = await (lastOp as unknown as Promise<{ data: { state: string | null } | null; error: unknown }>);
  if (last?.state === "uncertain" && !confirmUncertain) {
    return { ok: false, state: "blocked", message: `Arte #${itemId} está com estado incerto. Confirme explicitamente para tentar novamente.` };
  }

  const key = retryKey ?? `panel-retry-${Date.now()}-item-${itemId}`;
  return resendCreativeArt(db, itemId, ownerNumber, undefined, undefined, key);
}

/**
 * Core resend logic, extracted for testability. Guards (isOwner, channel) must be
 * checked by the caller before invoking this function.
 *
 * Idempotency: inserts a 'pending' lock before sending to block concurrent calls.
 * On conflict, re-reads the record and returns without sending. After send, updates
 * the record to the final state (ok/uncertain/failed). Blocked pre-send validation
 * errors are never persisted, so fixing the underlying issue and retrying works.
 */
export async function resendCreativeArt(
  db: Db,
  itemId: number,
  ownerNumber: string,
  taskId: number | undefined,
  caption?: string,
  idempotencyKey?: string,
): Promise<ResendResult> {
  // ── Idempotency: check cache ──────────────────────────────────────────────
  if (idempotencyKey) {
    const { data: cached } = await db
      .from("creative_resend_idempotency")
      .select("result_ok,message_id,state,error_message")
      .eq("key", idempotencyKey)
      .maybeSingle();
    if (cached) return cachedToResult(cached as IdempCached);
  }

  // ── Fetch and validate item ───────────────────────────────────────────────
  const { data: item, error: fetchError } = await db
    .from("creative_job_items")
    .select("id,job_id,seq,status,artifact_path,creative_jobs(title)")
    .eq("id", itemId)
    .maybeSingle();
  if (fetchError) return { ok: false, state: "failed", message: `Não consegui consultar a arte: ${fetchError.message}` };
  if (!item) return { ok: false, state: "blocked", message: `Arte #${itemId} não encontrada.` };
  // Never automatically repeat uncertain operations
  if ((item as { status: string }).status === "uncertain") {
    return { ok: false, state: "blocked", message: `Arte #${itemId} está com estado incerto. Revise no painel antes de pedir novo envio.` };
  }
  const path = typeof (item as { artifact_path: unknown }).artifact_path === "string"
    ? (item as { artifact_path: string }).artifact_path
    : null;
  if (!path) {
    return { ok: false, state: "blocked", message: `Arte #${itemId} não tem arquivo gerado ainda (estado: ${(item as { status: string }).status}).` };
  }
  if (!existsSync(path)) {
    return { ok: false, state: "blocked", message: `Arquivo da arte #${itemId} não encontrado em disco (pode ter sido removido).` };
  }

  // ── Acquire idempotency lock before send ──────────────────────────────────
  let acquired = false;
  if (idempotencyKey) {
    const lockOp = db.from("creative_resend_idempotency").insert(
      { key: idempotencyKey, item_id: itemId, owner_number: ownerNumber, result_ok: false, state: "pending" },
    );
    const lockRes = await (lockOp as unknown as Promise<{ error: { code?: string } | null }>);
    if (lockRes.error) {
      // Concurrent call already holds the lock; re-read and return without sending
      const { data: concurrent } = await db
        .from("creative_resend_idempotency")
        .select("result_ok,message_id,state,error_message")
        .eq("key", idempotencyKey)
        .maybeSingle();
      if (concurrent) return cachedToResult(concurrent as IdempCached);
      // Couldn't re-read — proceed without lock (edge case)
    } else {
      acquired = true;
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  const jRaw = (item as { creative_jobs: unknown }).creative_jobs;
  const jobTitle = jRaw
    ? Array.isArray(jRaw) ? ((jRaw[0] as { title?: string })?.title ?? "") : ((jRaw as { title?: string }).title ?? "")
    : "";
  const finalCaption = caption ?? `Arte ${(item as { seq: number }).seq} · ${jobTitle || `trabalho ${(item as { job_id: number }).job_id}`} · pré-visualização`;
  if (taskId) await addTaskEvent(db, taskId, "arte_preparada", "arte_reenviar", `item=${itemId}`).catch(() => {});
  let messageId: string | null = null;
  let state: "sent" | "uncertain" | "failed" = "failed";
  let errMsg = "";
  try {
    messageId = await sendOwnerImage(ownerNumber, path, finalCaption);
    state = messageId ? "sent" : "uncertain";
    if (!messageId) errMsg = "WhatsApp aceitou o envio mas não devolveu ID; não reenviado automaticamente.";
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    state = /timeout|AbortError|incerto/i.test(msg) ? "uncertain" : "failed";
    errMsg = msg;
  }

  let result: ResendResult;
  if (state === "sent" && messageId) {
    try { await recordAcceptedOutbound(db, messageId, ownerNumber); } catch {}
    if (taskId) {
      await addTaskEvent(db, taskId, "external_done", "arte_reenviar", `item=${itemId};msg=${messageId}`).catch(() => {});
      await addTaskEvent(db, taskId, "task_verified", "arte_reenviar", `mensagem ${messageId}`).catch(() => {});
    }
    result = { ok: true, messageId };
  } else {
    if (taskId) {
      await addTaskEvent(db, taskId, state === "uncertain" ? "arte_incerta" : "tool_failed", "arte_reenviar", `item=${itemId};${errMsg.slice(0, 200)}`).catch(() => {});
    }
    result = {
      ok: false, state: state as "uncertain" | "failed",
      message: state === "uncertain"
        ? `Resultado incerto: ${errMsg.slice(0, 200)}. Não reenviado automaticamente.`
        : `Falha ao enviar arte: ${errMsg.slice(0, 300)}.`,
    };
  }

  // ── Persist: update pending lock to final result ──────────────────────────
  if (idempotencyKey && acquired) {
    await (db
      .from("creative_resend_idempotency")
      .update({
        result_ok: result.ok,
        message_id: result.ok ? (result as { messageId: string }).messageId : null,
        state: result.ok ? null : (result as { state: string }).state,
        error_message: result.ok ? null : (result as { message: string }).message,
      })
      .eq("key", idempotencyKey) as unknown as Promise<unknown>
    ).catch(() => {});
  }

  return result;
}
