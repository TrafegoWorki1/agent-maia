import retention from "../config/data-retention.json" with { type: "json" };
import { kvSet, type Db } from "./store.ts";

export const RETENTION = Object.freeze(retention);
export interface RetentionResult {
  messages: number;
  ownerSessionMessages: number;
  scopedSessionMessages: number;
  summaries: number;
  ranAt: string;
  legacyFallback: boolean;
}

function cutoff(days: number, now: Date) { return new Date(now.getTime() - days * 86_400_000).toISOString(); }

export async function purgeRetainedMessages(db: Db, now = new Date()): Promise<RetentionResult> {
  const modern = await db.rpc("purge_maia_raw_messages", {
    p_owner_before: cutoff(RETENTION.ownerMessageRetentionDays, now),
    p_scoped_before: cutoff(RETENTION.scopedConversationRetentionDays, now),
  });
  let result: RetentionResult;
  if (!modern.error && modern.data) {
    const row = modern.data as Record<string, unknown>;
    result = {
      messages: Number(row.messages ?? 0),
      ownerSessionMessages: Number(row.ownerSessionMessages ?? 0),
      scopedSessionMessages: Number(row.scopedSessionMessages ?? 0),
      summaries: Number(row.summaries ?? 0),
      ranAt: String(row.ranAt ?? now.toISOString()),
      legacyFallback: false,
    };
  } else {
    // Compatibilidade durante a implantação: a migration nova pode ainda não existir. Mantém a limpeza
    // anterior dos escopos curtos e não apaga mensagens do owner sem a função versionada.
    const legacy = await db.rpc("purge_maia_scoped_history", { p_before: cutoff(RETENTION.scopedConversationRetentionDays, now) });
    if (legacy.error) throw new Error(`Limpeza de retenção indisponível: ${modern.error?.message ?? "função nova ausente"}; ${legacy.error.message}`);
    result = { messages: 0, ownerSessionMessages: 0, scopedSessionMessages: Number(legacy.data ?? 0), summaries: 0, ranAt: now.toISOString(), legacyFallback: true };
  }
  await kvSet(db, "retention:last_run", JSON.stringify(result), now);
  return result;
}
