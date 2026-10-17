import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Db } from "../server/store.ts";
import { resendCreativeArt, buildIdempotencyKey } from "../server/creativeAssetResolver.ts";

vi.mock("../server/evolutionSend.ts", () => ({ sendOwnerImage: vi.fn() }));
vi.mock("../server/outboundReceipts.ts", () => ({ recordAcceptedOutbound: vi.fn() }));
vi.mock("../server/store.ts", () => ({ addTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn((p: string) => !p.includes("absent") && !p.includes("missing")),
}));

import { sendOwnerImage } from "../server/evolutionSend.ts";
import { recordAcceptedOutbound } from "../server/outboundReceipts.ts";
import { addTaskEvent } from "../server/store.ts";

const OWNER = "5511999990000";
const TASK = 42;
const KEY = "task-42-item-1";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, job_id: 10, seq: 2, status: "ready_for_review",
    artifact_path: "/data/arte/present/arte.png",
    creative_jobs: { title: "Campanha Summer" },
    ...overrides,
  };
}

type IdempRow = { result_ok: boolean; message_id: string | null; state: string | null; error_message: string | null } | null;

function mockDb(
  itemRow: unknown | null = makeRow(),
  fetchError: string | null = null,
  idempotencyRow: IdempRow = null,
  lockConflict = false,
  idempotencyRowAfterConflict: IdempRow = null,
) {
  let maybeSingleCallCount = 0;
  const idempUpdateChain = {
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const idempChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(() => {
      maybeSingleCallCount++;
      if (maybeSingleCallCount === 1) {
        return Promise.resolve({ data: idempotencyRow, error: null });
      }
      return Promise.resolve({ data: idempotencyRowAfterConflict ?? idempotencyRow, error: null });
    }),
    insert: vi.fn().mockImplementation(() => {
      if (lockConflict) {
        return Promise.resolve({
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
    update: vi.fn().mockReturnValue(idempUpdateChain),
  };
  const itemChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(
      fetchError
        ? { data: null, error: { message: fetchError } }
        : { data: itemRow, error: null },
    ),
  };
  const db = {
    from: vi.fn((table: string) =>
      table === "creative_resend_idempotency" ? idempChain : itemChain,
    ),
  } as unknown as Db;
  return { db, idempChain, idempUpdateChain };
}

describe("resendCreativeArt", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Confirmação de entrega ────────────────────────────────────────────────
  it("envia e registra receipt quando sendOwnerImage devolve ID (confirmação de entrega)", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-abc");
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result).toEqual({ ok: true, messageId: "msg-abc" });
    expect(recordAcceptedOutbound).toHaveBeenCalledWith(db, "msg-abc", OWNER);
    expect(addTaskEvent).toHaveBeenCalledWith(db, TASK, "arte_preparada", "arte_reenviar", "item=1");
    expect(addTaskEvent).toHaveBeenCalledWith(db, TASK, "external_done", "arte_reenviar", expect.stringContaining("msg-abc"));
    expect(addTaskEvent).toHaveBeenCalledWith(db, TASK, "task_verified", "arte_reenviar", expect.stringContaining("msg-abc"));
  });

  // ── Resultado incerto — sendOwnerImage retorna null ───────────────────────
  it("retorna uncertain quando sendOwnerImage não devolve ID (sem confirmação)", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue(null);
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("uncertain");
      expect(result.message).toMatch(/incerto/i);
    }
    expect(recordAcceptedOutbound).not.toHaveBeenCalled();
    expect(addTaskEvent).toHaveBeenCalledWith(db, TASK, "arte_incerta", "arte_reenviar", expect.any(String));
  });

  // ── Resultado incerto — timeout de rede ──────────────────────────────────
  it("retorna uncertain quando sendOwnerImage lança erro de timeout", async () => {
    vi.mocked(sendOwnerImage).mockRejectedValue(new Error("timeout exceeded after 30s"));
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("uncertain");
    expect(recordAcceptedOutbound).not.toHaveBeenCalled();
  });

  // ── Falha de envio — erro HTTP ────────────────────────────────────────────
  it("retorna failed quando sendOwnerImage lança erro HTTP (não é incerto)", async () => {
    vi.mocked(sendOwnerImage).mockRejectedValue(new Error("Evolution sendMedia falhou: HTTP 500"));
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state).toBe("failed");
    expect(addTaskEvent).toHaveBeenCalledWith(db, TASK, "tool_failed", "arte_reenviar", expect.any(String));
  });

  // ── Pessoa inativa / cliente incorreto — item não existe ─────────────────
  it("retorna blocked quando item não existe (pessoa inativa ou cliente incorreto)", async () => {
    const { db } = mockDb(null);
    const result = await resendCreativeArt(db, 999, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/#999/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Pessoa inativa / cliente incorreto — erro de banco ───────────────────
  it("retorna failed quando o banco reporta erro ao buscar o item", async () => {
    const { db } = mockDb(null, "permission denied for table creative_job_items");
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("failed");
      expect(result.message).toMatch(/consultar/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Não repete incerto automaticamente (status do item) ──────────────────
  it("recusa reenvio de item com status 'uncertain' — não repete automaticamente", async () => {
    const { db } = mockDb(makeRow({ status: "uncertain" }));
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/incerto/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
    expect(addTaskEvent).not.toHaveBeenCalledWith(db, TASK, "arte_preparada", expect.any(String), expect.any(String));
  });

  // ── Arquivo ausente em disco ──────────────────────────────────────────────
  it("retorna blocked quando artifact_path aponta para arquivo ausente no disco", async () => {
    const { db } = mockDb(makeRow({ artifact_path: "/data/arte/absent/arte.png" }));
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/disco/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Arquivo ausente — artifact_path null ─────────────────────────────────
  it("retorna blocked quando artifact_path é null (arte ainda não gerada)", async () => {
    const { db } = mockDb(makeRow({ artifact_path: null, status: "queued" }));
    const result = await resendCreativeArt(db, 1, OWNER, TASK);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("blocked");
      expect(result.message).toMatch(/arquivo gerado/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Aprovação implícita — owner no WhatsApp ───────────────────────────────
  it("executa sem pedir aprovação adicional quando owner chama com path válido", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-ok");
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, TASK, "legenda custom");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe("msg-ok");
    expect(sendOwnerImage).toHaveBeenCalledWith(OWNER, expect.any(String), "legenda custom");
  });

  // ── Sem taskId — não registra eventos ────────────────────────────────────
  it("não chama addTaskEvent quando taskId é undefined", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-ok");
    const { db } = mockDb();
    const result = await resendCreativeArt(db, 1, OWNER, undefined);
    expect(result.ok).toBe(true);
    expect(addTaskEvent).not.toHaveBeenCalled();
  });

  // ── Idempotência: mesma chave não gera segundo envio ─────────────────────
  it("mesma chave não gera segundo envio — resultado ok anterior reutilizado", async () => {
    const cachedOk = { result_ok: true, message_id: "cached-msg", state: null, error_message: null };
    const { db } = mockDb(makeRow(), null, cachedOk);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result).toEqual({ ok: true, messageId: "cached-msg" });
    expect(sendOwnerImage).not.toHaveBeenCalled();
    expect(recordAcceptedOutbound).not.toHaveBeenCalled();
    expect(addTaskEvent).not.toHaveBeenCalled();
  });

  // ── Idempotência: resultado uncertain anterior reutilizado ───────────────
  it("mesma chave retorna resultado uncertain anterior sem chamar sendOwnerImage", async () => {
    const cachedUncertain = { result_ok: false, message_id: null, state: "uncertain", error_message: "timeout anterior" };
    const { db } = mockDb(makeRow(), null, cachedUncertain);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("uncertain");
      expect(result.message).toMatch(/timeout anterior/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Idempotência: resultado failed anterior reutilizado ──────────────────
  it("mesma chave retorna resultado failed anterior sem chamar sendOwnerImage", async () => {
    const cachedFailed = { result_ok: false, message_id: null, state: "failed", error_message: "HTTP 500" };
    const { db } = mockDb(makeRow(), null, cachedFailed);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("failed");
      expect(result.message).toMatch(/HTTP 500/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Idempotência: chaves diferentes permitem dois envios ─────────────────
  it("chaves diferentes permitem dois envios independentes", async () => {
    vi.mocked(sendOwnerImage)
      .mockResolvedValueOnce("msg-1")
      .mockResolvedValueOnce("msg-2");
    const { db: db1 } = mockDb();
    const { db: db2 } = mockDb();
    const r1 = await resendCreativeArt(db1, 1, OWNER, TASK, undefined, "task-42-item-1-a");
    const r2 = await resendCreativeArt(db2, 1, OWNER, TASK, undefined, "task-42-item-1-b");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(sendOwnerImage).toHaveBeenCalledTimes(2);
  });

  // ── Idempotência: lock pending inserido antes do envio ───────────────────
  it("lock pending inserido antes do envio — update com resultado final", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-abc");
    const { db, idempChain, idempUpdateChain } = mockDb();
    await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(idempChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      key: KEY,
      item_id: 1,
      state: "pending",
      result_ok: false,
    }));
    expect(sendOwnerImage).toHaveBeenCalled();
    expect(idempUpdateChain.eq).toHaveBeenCalled();
  });

  // ── Idempotência: resultado ok persistido via update ─────────────────────
  it("send bem-sucedido persiste resultado via update na tabela de idempotência", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-abc");
    const { db, idempChain, idempUpdateChain } = mockDb();
    await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(idempChain.insert).toHaveBeenCalledWith(expect.objectContaining({ state: "pending" }));
    expect(idempUpdateChain.eq).toHaveBeenCalledWith("key", KEY);
  });

  // ── Idempotência: resultado uncertain persistido via update ──────────────
  it("send uncertain persiste resultado uncertain via update na tabela de idempotência", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue(null);
    const { db, idempChain, idempUpdateChain } = mockDb();
    await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(idempChain.insert).toHaveBeenCalledWith(expect.objectContaining({ state: "pending" }));
    expect(idempUpdateChain.eq).toHaveBeenCalledWith("key", KEY);
  });

  // ── Idempotência: erros de validação (blocked) não adquirem lock ─────────
  it("blocked (item não existe) não persiste na tabela de idempotência", async () => {
    const { db, idempChain } = mockDb(null);
    await resendCreativeArt(db, 999, OWNER, TASK, undefined, KEY);
    expect(idempChain.insert).not.toHaveBeenCalled();
  });

  // ── Idempotência: sem chave — sem acesso à tabela de idempotência ─────────
  it("sem idempotencyKey não acessa a tabela de idempotência", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-ok");
    const { db, idempChain } = mockDb();
    await resendCreativeArt(db, 1, OWNER, TASK);
    expect(idempChain.select).not.toHaveBeenCalled();
    expect(idempChain.insert).not.toHaveBeenCalled();
  });

  // ── buildIdempotencyKey: chave por tarefa ────────────────────────────────
  it("buildIdempotencyKey — com taskId gera chave escopo-tarefa", () => {
    expect(buildIdempotencyKey(42, 1, OWNER)).toBe("task-42-item-1");
    expect(buildIdempotencyKey(99, 7, "551199999999")).toBe("task-99-item-7");
  });

  // ── buildIdempotencyKey: chave determinística sem taskId ─────────────────
  it("buildIdempotencyKey — sem taskId gera chave determinística por item+dono", () => {
    expect(buildIdempotencyKey(undefined, 1, OWNER)).toBe(`resend-item-1-${OWNER}`);
    expect(buildIdempotencyKey(undefined, 5, OWNER)).toBe(`resend-item-5-${OWNER}`);
    expect(buildIdempotencyKey(undefined, 1, OWNER)).toBe(buildIdempotencyKey(undefined, 1, OWNER));
  });

  // ── Concorrência: conflito de lock impede segundo envio ──────────────────
  it("chamada simultânea — conflito de lock retorna uncertain sem chamar sendOwnerImage", async () => {
    const pendingRow = { result_ok: false, message_id: null, state: "pending", error_message: null };
    const { db } = mockDb(makeRow(), null, null, true, pendingRow);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("uncertain");
      expect(result.message).toMatch(/em andamento/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Limpeza: estado pending em cache tratado como uncertain (lock orfão) ──
  it("estado pending em cache é tratado como uncertain (lock orfão expirável)", async () => {
    const pendingCached = { result_ok: false, message_id: null, state: "pending", error_message: null };
    const { db } = mockDb(makeRow(), null, pendingCached);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("uncertain");
      expect(result.message).toMatch(/em andamento|tente novamente/i);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Recuperação de falhas: failed não aciona novo envio com a mesma chave ─
  it("failed reutilizado somente quando for a mesma operação — sem reenvio", async () => {
    const cachedFailed = { result_ok: false, message_id: null, state: "failed", error_message: "Connection refused ao conectar ao Evolution" };
    const { db } = mockDb(makeRow(), null, cachedFailed);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("failed");
      expect(result.message).toMatch(/Connection refused/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });

  // ── Recuperação de falhas: novo pedido explícito usa chave diferente ───────
  it("novo pedido explícito após failed gera chave nova via taskId diferente", () => {
    const keyFailed = buildIdempotencyKey(TASK, 1, OWNER);       // task-42-item-1
    const keyRetry = buildIdempotencyKey(TASK + 1, 1, OWNER);    // task-43-item-1
    expect(keyRetry).not.toBe(keyFailed);
    expect(keyRetry).toBe(`task-${TASK + 1}-item-1`);
  });

  // ── Recuperação de falhas: nova chave chama o conector novamente ──────────
  it("novo envio após failed com nova chave chama sendOwnerImage novamente", async () => {
    vi.mocked(sendOwnerImage).mockResolvedValue("msg-recovery");
    const newKey = buildIdempotencyKey(TASK + 1, 1, OWNER);
    const { db } = mockDb(makeRow(), null, null); // nova chave — sem cache
    const result = await resendCreativeArt(db, 1, OWNER, TASK + 1, undefined, newKey);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messageId).toBe("msg-recovery");
    expect(sendOwnerImage).toHaveBeenCalledTimes(1);
  });

  // ── Recuperação de falhas: uncertain segue sem retry automático ───────────
  it("uncertain continua sem retry automático — mesma chave não aciona novo envio", async () => {
    const cachedUncertain = { result_ok: false, message_id: null, state: "uncertain", error_message: "Timeout ao enviar para Evolution" };
    const { db } = mockDb(makeRow(), null, cachedUncertain);
    const result = await resendCreativeArt(db, 1, OWNER, TASK, undefined, KEY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state).toBe("uncertain");
      expect(result.message).toMatch(/Timeout ao enviar/);
    }
    expect(sendOwnerImage).not.toHaveBeenCalled();
  });
});
