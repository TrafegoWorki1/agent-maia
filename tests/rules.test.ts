import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Db } from "../server/store.ts";
import { buildSystemPrompt, listRules } from "../server/rules.ts";
import { RULE_CATALOG, formatRules, renderRulesDocument, rulesChecksum, validateRules, type MaiaRule } from "../server/ruleCatalog.ts";

function mockDb(initial: readonly MaiaRule[] = RULE_CATALOG, preferences: { scope: string; instruction: string }[] = []) {
  const order = vi.fn().mockResolvedValue({ data: initial, error: null });
  const preferenceOrder = vi.fn().mockResolvedValue({ data: preferences, error: null });
  const from = (table: string) => table === "maia_rules"
    ? { select: () => ({ order }) }
    : { select: () => ({ eq: () => ({ order: preferenceOrder }) }) };
  return { db: { from } as unknown as Db, order, preferenceOrder };
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
  it("carrega preferências confirmadas como instruções subordinadas à política operacional", async () => {
    const { db } = mockDb(RULE_CATALOG, [{ scope: "restricao", instruction: "Nunca crie arte sem um pedido direto meu." }]);
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain("Preferências confirmadas do owner");
    expect(prompt).toContain('restricao: "Nunca crie arte sem um pedido direto meu."');
    expect(prompt).toContain("nunca concedem permissões, removem aprovações, enfraquecem segurança");
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
    // Monta um Postgres (PGlite) do zero e aplica todas as migrações reais: mais lento que o padrão do vitest.
    const { buildLocalDb } = await import("../scripts/db/local.ts");
    const local = await buildLocalDb();
    try {
      const rows = (await local.db.query<Record<string, unknown>>("select codigo, categoria, titulo, texto, ordem, ativa from public.maia_rules order by ordem")).rows;
      expect(validateRules(rows)).toEqual(RULE_CATALOG);
      const pending = (await local.db.query<{ id: number }>("insert into maia_owner_preference_proposals(scope,instruction) values('restricao','Nunca crie arte sem um pedido direto meu.') returning id")).rows[0];
      expect((await local.db.query<{ active: boolean }>("select activate_owner_preference($1) as active", [pending.id])).rows[0].active).toBe(true);
      const saved = (await local.db.query<{ instruction: string; active: boolean }>("select instruction, active from maia_owner_preferences where scope='restricao'")).rows;
      expect(saved).toEqual([{ instruction: "Nunca crie arte sem um pedido direto meu.", active: true }]);
      expect((await local.db.query<{ allowed: boolean }>("select has_function_privilege('anon','public.activate_owner_preference(bigint)','execute') as allowed")).rows[0].allowed).toBe(false);
      expect((await local.db.query<{ allowed: boolean }>("select has_table_privilege('anon','public.maia_owner_preferences','select') as allowed")).rows[0].allowed).toBe(false);
      const replacement = (await local.db.query<{ id: number }>("insert into maia_owner_preference_proposals(scope,instruction) values('restricao','Nunca gere arte sem um pedido direto meu.') returning id")).rows[0];
      expect((await local.db.query<{ active: boolean }>("select activate_owner_preference($1) as active", [replacement.id])).rows[0].active).toBe(true);
      expect((await local.db.query<{ instruction: string; active: boolean }>("select instruction, active from maia_owner_preferences where scope='restricao' order by id")).rows).toEqual([
        { instruction: "Nunca crie arte sem um pedido direto meu.", active: false },
        { instruction: "Nunca gere arte sem um pedido direto meu.", active: true },
      ]);
      const expired = (await local.db.query<{ id: number }>("insert into maia_owner_preference_proposals(scope,instruction,expires_at) values('resposta','Seja breve.',now() - interval '1 minute') returning id")).rows[0];
      expect((await local.db.query<{ active: boolean }>("select activate_owner_preference($1) as active", [expired.id])).rows[0].active).toBe(false);
      expect((await local.db.query<{ status: string }>("select status from maia_owner_preference_proposals where id=$1", [expired.id])).rows[0].status).toBe("expired");
    } finally {
      await local.close();
    }
    expect(JSON.stringify(RULE_CATALOG)).not.toMatch(/\b\d{10,15}\b/);
  }, 30_000);
});
