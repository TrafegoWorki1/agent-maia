import { describe, expect, it } from "vitest";
import { purgeRetainedMessages, RETENTION } from "../server/retention.ts";
import type { Db } from "../server/store.ts";

describe("retenção configurada", () => {
  it("limpa payload bruto e registra métricas sem tocar memória durável", async () => {
    const calls: string[] = [];
    const db = {
      rpc: async (name: string) => { calls.push(name); return { data: { messages: 2, ownerSessionMessages: 3, scopedSessionMessages: 4, summaries: 1, ranAt: "2026-10-16T00:00:00Z" }, error: null }; },
      from: (table: string) => { calls.push(table); const q: any = { upsert: () => q, then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }) }; return q; },
    } as unknown as Db;
    const result = await purgeRetainedMessages(db, new Date("2026-10-16T00:00:00Z"));
    expect(RETENTION.ownerMessageRetentionDays).toBe(90);
    expect(result.messages + result.ownerSessionMessages + result.scopedSessionMessages).toBe(9);
    expect(calls).toContain("purge_maia_raw_messages");
    expect(calls).toContain("kv");
    expect(calls).not.toContain("owner_memories");
  });
});
