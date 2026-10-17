import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "../server/store.ts";
import { purgeExpiredIdempotencyRecords } from "../server/creativeIdempotencyCleanup.ts";
import { retryCreativeSendFromPanel } from "../server/creativeAssetResolver.ts";

vi.mock("../server/evolutionSend.ts", () => ({ sendOwnerImage: vi.fn() }));
vi.mock("../server/outboundReceipts.ts", () => ({ recordAcceptedOutbound: vi.fn() }));
vi.mock("../server/store.ts", () => ({ addTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => !p.includes("absent") && !p.includes("missing")),
}));

import { sendOwnerImage } from "../server/evolutionSend.ts";

const OWNER = "5511999990000";
const ITEM_ID = 1;

// ── Cleanup helpers ────────────────────────────────────────────────────────────

type DeleteChain = {
  eq: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
};

function makeDeleteChain(deletedRows: Array<{ key: string }>): DeleteChain {
  const chain: DeleteChain = {
    select: vi.fn().mockResolvedValue({ data: deletedRows, error: null }),
    lt: vi.fn(),
    eq: vi.fn(),
  };
  chain.lt.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function mockCleanupDb(failedDeleted: Array<{ key: string }>, pendingDeleted: Array<{ key: string }>) {
  let callIndex = 0;
  const chains = [makeDeleteChain(failedDeleted), makeDeleteChain(pendingDeleted)];
  const db = {
    from: vi.fn((_table: string) => ({
      delete: vi.fn(() => {
        const chain = chains[callIndex % 2];
        callIndex++;
        return chain;
      }),
    })),
  } as unknown as Db;
  return db;
}

// ── Panel retry helpers ────────────────────────────────────────────────────────

function makeItemRow() {
  return {
    id: ITEM_ID, job_id: 10, seq: 2, status: "ready_for_review",
    artifact_path: "/data/arte/present/arte.png",
    creative_jobs: { title: "Campanha Summer" },
  };
}

type IdempRow = { state: string | null; result_ok: boolean; message_id: string | null; error_message: string | null } | null;

function mockRetryDb(
  itemRow: unknown | null = makeItemRow(),
  lastIdempRow: IdempRow = null,
  lockConflict = false,
) {
  let maybeSingleCallCount = 0;
  const idempChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(() => {
      maybeSingleCallCount++;
      // First call: retryCreativeSendFromPanel's "last record" lookup
      if (maybeSingleCallCount === 1) return Promise.resolve({ data: lastIdempRow, error: null });
      // Second call: resendCreativeArt's cache check (new key → no cache)
      return Promise.resolve({ data: null, error: null });
    }),
    insert: vi.fn().mockImplementation(() =>
      lockConflict
        ? Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key" } })
        : Promise.resolve({ data: null, error: null }),
    ),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
  };
  const itemChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: itemRow, error: null }),
  };
  const db = {
    from: vi.fn((table: string) =>
      table === "creative_resend_idempotency" ? idempChain : itemChain,
    ),
  } as unknown as Db;
  return { db, idempChain };
}

describe("purgeExpiredIdempotencyRecords", () => {
  it("limpeza de failed expirado — registros com mais de 48h são deletados", async () => {
    const db = mockCleanupDb([{ key: "task-1-item-1" }, { key: "task-2-item-2" }], []);
    const result = await purgeExpiredIdempotencyRecords(db);
    expect(result.failedPurged).toBe(2);
    expect(result.pendingPurged).toBe(0);
  });

  it("limpeza de pending órfão — registros com mais de 1h são deletados", async () => {
    const db = mockCleanupDb([], [{ key: "task-3-item-3" }]);
    const result = await purgeExpiredIdempotencyRecords(db);
    expect(result.failedPurged).toBe(0);
    expect(result.pendingPurged).toBe(1);
  });

  it("preservação da auditoria — uncertain nunca entra nos filtros de deleção", async () => {
    // The cleanup queries filter by state='failed' and state='pending' only.
    // We verify the delete chains receive those exact eq filters.
    let failedChain: DeleteChain | null = null;
    let pendingChain: DeleteChain | null = null;
    let callIndex = 0;
    const db = {
      from: vi.fn((_table: string) => ({
        delete: vi.fn(() => {
          if (callIndex === 0) {
            failedChain = makeDeleteChain([]);
            callIndex++;
            return failedChain;
          }
          pendingChain = makeDeleteChain([]);
          callIndex++;
          return pendingChain;
        }),
      })),
    } as unknown as Db;
    await purgeExpiredIdempotencyRecords(db);
    // Verify failed chain filtered by state='failed' (not 'uncertain')
    expect(failedChain!.eq).toHaveBeenCalledWith("state", "failed");
    expect(failedChain!.eq).not.toHaveBeenCalledWith("state", "uncertain");
    // Verify pending chain filtered by state='pending'
    expect(pendingChain!.eq).toHaveBeenCalledWith("state", "pending");
  });

  it("sem registros expirados — devolve zeros sem erro", async () => {
    const db = mockCleanupDb([], []);
    const result = await purgeExpiredIdempotencyRecords(db);
    expect(result.failedPurged).toBe(0);
    expect(result.pendingPurged).toBe(0);
    expect(result.ranAt).toBeTruthy();
  });
});

describe("retryCreativeSendFromPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retry manual após failed — nova chave chama sendOwnerImage", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", OWNER);
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-retry");
    const { db } = mockRetryDb(makeItemRow(), { state: "failed", result_ok: false, message_id: null, error_message: "HTTP 500" });
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe("msg-retry");
    expect(sendOwnerImage).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("confirmação manual após uncertain — bloqueia sem confirmUncertain=true", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", OWNER);
    const { db } = mockRetryDb(makeItemRow(), { state: "uncertain", result_ok: false, message_id: null, error_message: "Timeout" });
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/incerto/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("confirmação manual após uncertain — prossegue com confirmUncertain=true", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", OWNER);
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-uncertain-retry");
    const { db } = mockRetryDb(makeItemRow(), { state: "uncertain", result_ok: false, message_id: null, error_message: "Timeout" });
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER, confirmUncertain: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe("msg-uncertain-retry");
    expect(sendOwnerImage).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("bloqueio para usuário sem permissão — ownerNumber diferente do env bloqueia", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5521888880000");
    const { db } = mockRetryDb();
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/não coincide/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("nova chave no retry — retryKey diferente da chave original não reutiliza cache", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", OWNER);
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-new-key");
    const retryKey = `panel-retry-${Date.now()}-item-${ITEM_ID}`;
    const { db, idempChain } = mockRetryDb(makeItemRow(), null);
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER, retryKey });
    expect(result.ok).toBe(true);
    // Verify the key passed to insert is the retryKey we provided
    expect(idempChain.insert).toHaveBeenCalledWith(expect.objectContaining({ key: retryKey }));
    vi.unstubAllEnvs();
  });

  it("ausência de duplicidade — mesma retryKey não aciona segundo envio", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", OWNER);
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-first");
    const retryKey = "panel-retry-fixed-key-item-1";
    // Second call: idempotency cache returns 'ok' result for this key
    const cachedOk = { state: null, result_ok: true, message_id: "msg-first", error_message: null };
    // mockRetryDb: first maybeSingle = lastIdempRow lookup (null = no uncertain block),
    // but for the second call the cache is already set. We need to simulate:
    // - first maybeSingle (last record lookup in retryCreativeSendFromPanel): null
    // - second maybeSingle (cache check in resendCreativeArt): cachedOk
    let callCount = 0;
    const idempChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ data: null, error: null }); // no uncertain block
        return Promise.resolve({ data: cachedOk, error: null }); // cache hit for same key
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    };
    const itemChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: makeItemRow(), error: null }),
    };
    const db = { from: vi.fn((t: string) => t === "creative_resend_idempotency" ? idempChain : itemChain) } as unknown as Db;
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER, retryKey });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe("msg-first");
    // sendOwnerImage NOT called because cache hit returned the previous result
    expect(sendOwnerImage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("env owner ausente — bloqueia sem enviar", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "");
    const { db } = mockRetryDb();
    const result = await retryCreativeSendFromPanel(db, { itemId: ITEM_ID, ownerNumber: OWNER });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("blocked");
    expect(sendOwnerImage).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
