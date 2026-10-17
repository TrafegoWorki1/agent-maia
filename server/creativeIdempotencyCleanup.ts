import type { Db } from "./store.ts";

export interface IdempotencyCleanupResult {
  failedPurged: number;
  pendingPurged: number;
  ranAt: string;
}

/**
 * Remove expired idempotency records:
 * - failed records older than 48 h (can no longer be retried via same key)
 * - pending orphan locks older than 1 h (worker was interrupted before update)
 *
 * Never removes uncertain or result_ok=true records — those are permanent audit.
 */
export async function purgeExpiredIdempotencyRecords(db: Db, now = new Date()): Promise<IdempotencyCleanupResult> {
  const failedCutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const pendingCutoff = new Date(now.getTime() - 3_600_000).toISOString();

  const failedOp = db
    .from("creative_resend_idempotency")
    .delete()
    .eq("result_ok", false)
    .eq("state", "failed")
    .lt("created_at", failedCutoff)
    .select("key");
  const { data: failedData, error: failedError } = await (failedOp as unknown as Promise<{ data: Array<{ key: string }> | null; error: { message: string } | null }>);
  if (failedError) throw new Error(`Limpeza de idempotência (failed): ${failedError.message}`);

  const pendingOp = db
    .from("creative_resend_idempotency")
    .delete()
    .eq("state", "pending")
    .lt("created_at", pendingCutoff)
    .select("key");
  const { data: pendingData, error: pendingError } = await (pendingOp as unknown as Promise<{ data: Array<{ key: string }> | null; error: { message: string } | null }>);
  if (pendingError) throw new Error(`Limpeza de idempotência (pending): ${pendingError.message}`);

  return {
    failedPurged: (failedData ?? []).length,
    pendingPurged: (pendingData ?? []).length,
    ranAt: now.toISOString(),
  };
}
