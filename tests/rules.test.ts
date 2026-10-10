import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../server/store.ts";

describe("números do dono/aprovador vêm do .env, nunca do texto das regras", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("o prompt traz o número real, mesmo com a regra do banco sem nenhum número", async () => {
    vi.resetModules();
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5585999990000");
    vi.stubEnv("EVOLUTION_APPROVER_NUMBER", "5585888880000");
    const { buildSystemPrompt } = await import("../server/rules.ts");
    const db = { from: () => ({ select: () => ({ order: async () => ({ data: [{ ativa: true, texto: "A aprovação pode ser dada pelo dono ou pelo aprovador cadastrados." }], error: null }) }) }) } as unknown as Db;
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain("5585999990000");
    expect(prompt).toContain("5585888880000");
  });
});

describe("orientação de execução nos dois modelos", () => {
  it("mantém as regras ativas do banco e acrescenta consulta e conferência", async () => {
    vi.resetModules();
    const { buildSystemPrompt, EXECUTION_GUIDELINES } = await import("../server/rules.ts");
    const db = { from: () => ({ select: () => ({ order: async () => ({ data: [{ ativa: true, texto: "Não altere orçamento sem aprovação." }, { ativa: false, texto: "Regra desativada" }], error: null }) }) }) } as unknown as Db;
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain("Não altere orçamento sem aprovação.");
    expect(prompt).not.toContain("Regra desativada");
    expect(prompt).toContain(EXECUTION_GUIDELINES);
  });

  it("falha do banco preserva as instruções de conferência e permissões", async () => {
    vi.resetModules();
    const { buildSystemPrompt, EXECUTION_GUIDELINES } = await import("../server/rules.ts");
    const db = { from: () => ({ select: () => ({ order: async () => ({ data: null, error: { message: "banco indisponível" } }) }) }) } as unknown as Db;
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const prompt = await buildSystemPrompt(db);
      expect(prompt).toContain("Nunca contorne uma recusa.");
      expect(prompt).toContain(EXECUTION_GUIDELINES);
    } finally { warn.mockRestore(); }
  });
});
