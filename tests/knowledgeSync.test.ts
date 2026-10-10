import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../server/store.ts";
import { RULE_CATALOG } from "../server/ruleCatalog.ts";
const mocks = vi.hoisted(() => ({ ingest: vi.fn(), listRules: vi.fn(), kvSet: vi.fn() }));
vi.mock("../server/knowledge.ts", () => ({ ingestDocument: mocks.ingest }));
vi.mock("../server/rules.ts", () => ({ listRules: mocks.listRules }));
vi.mock("../server/store.ts", () => ({ kvGet: vi.fn(), kvSet: mocks.kvSet }));
import { syncKnowledge } from "../server/knowledgeSync.ts";

function setup() {
  mocks.ingest.mockResolvedValue("atualizado");
  mocks.listRules.mockResolvedValue(RULE_CATALOG);
  const eq = vi.fn().mockResolvedValue({ error: null });
  const inFilter = vi.fn(() => ({ eq }));
  const update = vi.fn(() => ({ in: inFilter }));
  return { db: { from: () => ({ update }) } as unknown as Db, update, inFilter, eq };
}
afterEach(() => vi.resetAllMocks());
describe("ativação das fontes vigentes", () => {
  it("desativa apenas fontes históricas conhecidas após indexar a política", async () => {
    const { db, update, inFilter } = setup();
    const result = await syncKnowledge(db);
    expect(result.erros).toEqual([]);
    expect(mocks.ingest).toHaveBeenCalledWith(db, expect.objectContaining({ slug: "regras-maia" }));
    expect(update).toHaveBeenCalledWith({ ativo: false });
    expect(inFilter).toHaveBeenCalledWith("slug", ["claude-md", "erros-e-mudancas", "plano"]);
    expect(mocks.kvSet).toHaveBeenCalledOnce();
  });
  it("falha na indexação preserva fontes antigas e não registra sucesso", async () => {
    const { db, update } = setup();
    mocks.ingest.mockRejectedValue(new Error("vetor indisponível"));
    expect((await syncKnowledge(db)).erros).toHaveLength(1);
    expect(update).not.toHaveBeenCalled();
    expect(mocks.kvSet).not.toHaveBeenCalled();
  });
  it("divergência no banco interrompe a sincronização sem sobrescrever regras", async () => {
    const { db, update } = setup();
    mocks.listRules.mockResolvedValue(RULE_CATALOG.slice(1));
    expect((await syncKnowledge(db)).erros[0]).toContain("divergem");
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("falha ao desativar históricos não é registrada como sincronização completa", async () => {
    const { db, eq } = setup();
    eq.mockResolvedValue({ error: { message: "indisponível" } });
    expect((await syncKnowledge(db)).erros[0]).toContain("desativar fontes");
    expect(mocks.kvSet).not.toHaveBeenCalled();
  });
});
