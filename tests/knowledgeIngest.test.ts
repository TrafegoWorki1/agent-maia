import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestDocument, searchKnowledge } from "../server/knowledge.ts";
import type { Db } from "../server/store.ts";

const doc = { slug: "regras-maia", titulo: "Regras", origem: "docs/regras-da-maia.md", text: "# Política\n\nConteúdo aprovado." };
const hash = createHash("sha256").update(doc.text).digest("hex");
function setup(existing: Record<string, unknown> | null = null, count = 1) {
  vi.stubEnv("SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(384).fill(0.1) }) });
  vi.stubGlobal("fetch", fetchMock);
  const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
  const from = vi.fn((table: string) => ({ select: () => ({ eq: () => table === "knowledge_sources" ? { maybeSingle: async () => ({ data: existing, error: null }) } : Promise.resolve({ count, error: null }) }) }));
  return { db: { from, rpc } as unknown as Db, rpc, from, fetchMock };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("indexação recuperável", () => {
  it("falha ao gerar vetor não faz nenhuma escrita", async () => {
    const { db, rpc, fetchMock } = setup({ id: 1, checksum: "anterior" });
    fetchMock.mockRejectedValue(new Error("embed indisponível"));
    await expect(ingestDocument(db, doc)).rejects.toThrow("embed indisponível");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("envia conteúdo completo e a versão anterior para uma única transação", async () => {
    const { db, rpc } = setup({ id: 1, checksum: "anterior" });
    expect(await ingestDocument(db, doc)).toBe("atualizado");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("replace_knowledge_document", expect.objectContaining({ p_checksum: hash, p_expected_checksum: "anterior", p_chunks: [expect.objectContaining({ conteudo: "Conteúdo aprovado." })] }));
  });
  it.each([{ ativo: false, count: 1 }, { ativo: true, count: 0 }])("repara fonte inativa ou índice incompleto mesmo com checksum igual", async ({ ativo, count }) => {
    const { db, rpc } = setup({ id: 1, checksum: hash, ativo, titulo: doc.titulo, origem: doc.origem }, count);
    expect(await ingestDocument(db, doc)).toBe("atualizado");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("fonte íntegra e inalterada não gera vetores nem grava", async () => {
    const { db, rpc, fetchMock } = setup({ id: 1, checksum: hash, ativo: true, titulo: doc.titulo, origem: doc.origem });
    expect(await ingestDocument(db, doc)).toBe("sem_mudanca");
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("conflito de versão é uma falha visível, sem nova tentativa de escrita", async () => {
    const { db, rpc } = setup();
    rpc.mockResolvedValue({ data: null, error: { message: "documento alterado durante a indexação" } });
    await expect(ingestDocument(db, doc)).rejects.toThrow("documento alterado");
    expect(rpc).toHaveBeenCalledOnce();
  });
  it("busca não devolve histórico ou plano antigo como política vigente", async () => {
    const { db, rpc } = setup();
    const result = { titulo: "Fonte", secao: "Seção", conteudo: "Texto", score: "0.5" };
    rpc.mockResolvedValue({ error: null, data: [ { ...result, origem: "plan.md" }, { ...result, origem: "docs/erros-e-mudancas.md" }, { ...result, origem: doc.origem } ] });
    expect(await searchKnowledge(db, "permissões")).toEqual([{ ...result, score: 0.5, origem: doc.origem }]);
  });
});
