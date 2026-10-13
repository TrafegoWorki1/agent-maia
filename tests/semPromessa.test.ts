import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../server/rules.ts";
import type { Db } from "../server/store.ts";

// Decisão do owner (13/10/2026): o agente não promete o que o sistema não executa sozinho (ex.: "quando ele entrar, eu
// dou as boas-vindas" sem um plano com gatilho) e explica bloqueios sem citar "a ferramenta exige".
vi.mock("../server/ownerPreferences.ts", () => ({ listOwnerPreferences: async () => [] }));

describe("prompt da Maia", () => {
  it("manda não prometer ação futura sem plano, lembrete ou tarefa agendada, e falar em linguagem natural", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "sem banco" } }) }) }) } as unknown as Db;
    const prompt = await buildSystemPrompt(db);
    expect(prompt).toContain("nunca prometa uma ação futura que nenhum mecanismo do sistema executa sozinho");
    expect(prompt).toContain("plano gravado (plano_criar) com gatilho");
    expect(prompt).toContain("sem citar nomes de ferramenta");
  });
});
