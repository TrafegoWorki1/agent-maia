import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "../server/knowledge.ts";

describe("divisão da base de conhecimento", () => {
  it("guarda a seção de cada trecho", () => {
    const chunks = chunkMarkdown("# Regras\n\nNada sem aprovação.\n\n## Anúncios\n\nOrçamento só com SIM.");
    expect(chunks).toEqual([
      { secao: "Regras", conteudo: "Nada sem aprovação." },
      { secao: "Anúncios", conteudo: "Orçamento só com SIM." },
    ]);
  });

  it("quebra textos longos em trechos menores", () => {
    const paragraph = "Texto de teste. ".repeat(40);
    const chunks = chunkMarkdown(`# Longo\n\n${paragraph}\n\n${paragraph}\n\n${paragraph}`, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.conteudo.length).toBeLessThanOrEqual(600);
    for (const chunk of chunks) expect(chunk.secao).toBe("Longo");
  });

  it("ignora texto vazio", () => {
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });
});
