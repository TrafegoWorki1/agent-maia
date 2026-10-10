import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Db } from "../server/store.ts";
import { buildSystemPrompt, listRules } from "../server/rules.ts";
import { RULE_CATALOG, formatRules, renderRulesDocument, rulesChecksum, validateRules, type MaiaRule } from "../server/ruleCatalog.ts";

function mockDb(initial: readonly MaiaRule[] = RULE_CATALOG) {
  const order = vi.fn().mockResolvedValue({ data: initial, error: null });
  return { db: { from: () => ({ select: () => ({ order }) }) } as unknown as Db, order };
}
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("política compartilhada pelos executores", () => {
  it("estrutura títulos e categorias e omite regras desativadas", async () => {
    const rules = [{ ...RULE_CATALOG[1], ativa: false }, RULE_CATALOG[0]];
    const { db } = mockDb(rules);
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain("## Quem pede — Objetivo e capacidades [identidade]");
    expect(prompt).not.toContain("[estilo]");
    expect(prompt).toContain(rulesChecksum(rules));
  });
  it("lê os números do ambiente mesmo quando as regras estão em cache", async () => {
    const { db, order } = mockDb();
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5585999990000");
    expect(await buildSystemPrompt(db, 100)).toContain("5585999990000");
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5585999990001");
    const prompt = await buildSystemPrompt(db, 200);
    expect(prompt).toContain("5585999990001");
    expect(prompt).not.toContain("5585999990000");
    expect(order).toHaveBeenCalledTimes(1);
  });
  it("atualiza o cache em 60 segundos e isola clientes de banco", async () => {
    const a = mockDb([RULE_CATALOG[0]]);
    const b = mockDb([RULE_CATALOG[1]]);
    expect(await buildSystemPrompt(a.db, 0)).toContain("[identidade]");
    expect(await buildSystemPrompt(b.db, 1)).not.toContain("[identidade]");
    a.order.mockResolvedValue({ data: [RULE_CATALOG[2]], error: null });
    expect(await buildSystemPrompt(a.db, 59_999)).toContain("[identidade]");
    expect(await buildSystemPrompt(a.db, 60_000)).not.toContain("[identidade]");
    expect(a.order).toHaveBeenCalledTimes(2);
  });
  it("a reserva inicial mantém toda a política aprovada sem vazar erro bruto", async () => {
    const { db, order } = mockDb();
    order.mockResolvedValue({ data: null, error: { message: "token-privado" } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain(formatRules(RULE_CATALOG));
    expect(prompt).toContain("catálogo aprovado (reserva)");
    expect(prompt).not.toContain("token-privado");
    expect(JSON.stringify(log.mock.calls)).not.toContain("token-privado");
  });
  it("falha após uma leitura válida preserva as desativações do banco", async () => {
    const rules = RULE_CATALOG.map((r) => ({ ...r, ativa: r.codigo !== "instagram" }));
    const { db, order } = mockDb(rules);
    await buildSystemPrompt(db, 0);
    order.mockRejectedValue(new Error("indisponível"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const prompt = await buildSystemPrompt(db, 60_000);
    expect(prompt).toContain("última leitura validada");
    expect(prompt).not.toContain("[instagram]");
  });
  it.each([{ rules: [] }, { rules: RULE_CATALOG.map((r) => ({ ...r, ativa: false })) }])("um conjunto sem regras ativas interrompe a execução", async ({ rules }) => {
    const { db } = mockDb(rules);
    await expect(buildSystemPrompt(db)).rejects.toThrow("nenhuma regra ativa");
    await expect(buildSystemPrompt(db)).rejects.toThrow("nenhuma regra ativa");
  });
  it("recusa códigos duplicados e registros malformados", async () => {
    expect(() => validateRules([RULE_CATALOG[0], RULE_CATALOG[0]])).toThrow("duplicado");
    const { db, order } = mockDb();
    order.mockResolvedValue({ data: [{ texto: "registro incompleto" }], error: null });
    await expect(listRules(db)).rejects.toThrow("inválido");
  });
});

describe("contrato entre catálogo, Markdown e migração", () => {
  it("o documento é gerado da mesma origem do prompt de reserva", () => {
    const md = readFileSync(new URL("../docs/regras-da-maia.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(md).toBe(renderRulesDocument());
    expect(md).toContain(formatRules(RULE_CATALOG));
  });
  // Não lê um arquivo de migração específico: migração aplicada é imutável (docs/database-migrations.md),
  // então uma regra nova vem por migração nova, nunca editando a anterior. O teste roda TODAS as migrações
  // reais (PGlite) e confere se a tabela final bate com o catálogo — é o que importa de verdade.
  it("as migrações, todas juntas, entregam exatamente o catálogo revisado", async () => {
    // Monta um Postgres (PGlite) do zero e aplica as 24 migrações reais: mais lento que o padrão do vitest.
    const { buildLocalDb } = await import("../scripts/db/local.ts");
    const local = await buildLocalDb();
    try {
      const rows = (await local.db.query<Record<string, unknown>>("select codigo, categoria, titulo, texto, ordem, ativa from public.maia_rules order by ordem")).rows;
      expect(validateRules(rows)).toEqual(RULE_CATALOG);
    } finally {
      await local.close();
    }
    expect(JSON.stringify(RULE_CATALOG)).not.toMatch(/\b\d{10,15}\b/);
  }, 30_000);
});
