import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../server/ai/config.ts";
import { categoryFromIntent, pickClassification } from "../server/ai/jevRouter.ts";
import { classifyByRules } from "../server/ai/rulesClassifier.ts";
import type { JevResult } from "../server/jev.ts";
import { quotaDay, detectFormat } from "../server/creative/creativeRouter.ts";
import { summarizeRuns } from "../server/ai/usageTracker.ts";

const jev = (over: Partial<JevResult> = {}): JevResult => ({
  categoria: "arte",
  confianca: 0.95,
  manipulacao: 0.01,
  urgencia: 0.3,
  intencao: "imagem",
  complexidade: "intermediaria",
  risco: "baixo",
  ms: 700,
  ...over,
});
const active = { ...DEFAULT_CONFIG, jev: { activeRouting: true, minConfidence: 0.8 } };
const rules = classifyByRules("faz uma coisa qualquer");

describe("Jev no roteamento", () => {
  it("em modo sombra (padrão), as regras decidem", () => {
    expect(pickClassification(rules, jev(), DEFAULT_CONFIG)).toBe(rules);
  });

  it("ativo, com confiança alta e risco baixo, o Jev recomenda", () => {
    expect(pickClassification(rules, jev(), active)).toMatchObject({ category: "imagem", source: "jev" });
  });

  it("não decide com pouca confiança, risco alto ou escrita externa", () => {
    expect(pickClassification(rules, jev({ confianca: 0.4 }), active)).toBe(rules);
    expect(pickClassification(rules, jev({ risco: "alto" }), active)).toBe(rules);
    expect(pickClassification(rules, jev({ intencao: "escrita_externa" }), active)).toBe(rules);
  });

  it("Jev indisponível não derruba o roteamento", () => {
    expect(pickClassification(rules, null, active)).toBe(rules);
  });

  it("mapeia as intenções do Jev para as categorias da Maia", () => {
    expect(categoryFromIntent("acao_sensivel")).toBe("escrita_externa");
    expect(categoryFromIntent("criacao_conteudo")).toBe("geral");
    expect(categoryFromIntent("inexistente")).toBeNull();
  });
});

describe("arte direta", () => {
  it("detecta o formato pedido", () => {
    expect(detectFormat("arte para o story")).toBe("story");
    expect(detectFormat("arte quadrada")).toBe("quadrado");
    expect(detectFormat("arte para o instagram")).toBe("feed");
  });

  it("o dia da cota usa o fuso de Fortaleza (UTC-3)", () => {
    expect(quotaDay(new Date("2026-10-09T02:30:00Z"))).toBe("2026-10-08");
    expect(quotaDay(new Date("2026-10-09T04:00:00Z"))).toBe("2026-10-09");
  });
});

describe("métricas por modelo", () => {
  const run = (over: Record<string, unknown>) => ({
    provider: "claude", model: "haiku", categoria: "conversa", status: "ok", duration_ms: 1000, tokens_in: 10, tokens_out: 5, cost_usd: 0.01,
    fallback_de: null, erro_classe: null, started_at: "2026-10-09T12:00:00Z", ...over,
  });

  it("agrupa por provedor e modelo e conta o fallback", () => {
    const view = summarizeRuns([run({}), run({ status: "error" }), run({ provider: "codex", model: null, fallback_de: "claude", erro_classe: "quota", tokens_in: null, tokens_out: null, cost_usd: null })] as never);
    expect(view.total).toBe(3);
    expect(view.taxaFallback).toBe(33);
    const haiku = view.porModelo.find((m) => m.model === "haiku");
    expect([haiku?.execucoes, haiku?.sucesso]).toEqual([2, 50]);
    const codex = view.porModelo.find((m) => m.provider === "codex");
    expect([codex?.tokensEntrada, codex?.custoUsd]).toEqual([null, null]);
  });
});
