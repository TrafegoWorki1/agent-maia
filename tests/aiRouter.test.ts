import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "../server/ai/config.ts";
import { classifyByRules } from "../server/ai/rulesClassifier.ts";
import { initialHealth } from "../server/ai/providerHealth.ts";
import { route } from "../server/ai/router.ts";
import type { HealthRecord } from "../server/ai/types.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const cfg = DEFAULT_CONFIG;
const healthy = (provider: "claude" | "codex") => initialHealth(provider);
const cooling = (provider: "claude" | "codex"): HealthRecord => ({
  ...initialHealth(provider),
  state: "cooldown",
  cooldownUntil: new Date(NOW + 10 * 60 * 1000).toISOString(),
});

describe("classificação por regras", () => {
  it("reconhece arte, carrossel, análise, resumo, consulta e conversa", () => {
    expect(classifyByRules("cria uma arte quadrada para o lançamento").category).toBe("imagem");
    expect(classifyByRules("quero um carrossel de 7 páginas").category).toBe("carrossel");
    expect(classifyByRules("analisa o desempenho das campanhas de setembro").category).toBe("analise");
    expect(classifyByRules("resume a conversa de ontem").category).toBe("resumo");
    expect(classifyByRules("quanto gastei hoje?").category).toBe("consulta");
    expect(classifyByRules("bom dia").category).toBe("conversa");
  });

  it("marca como risco alto o que altera algo externo", () => {
    const c = classifyByRules("pausa a campanha de remarketing");
    expect(c.category).toBe("escrita_externa");
    expect(c.risk).toBe("alto");
  });
});

describe("roteador", () => {
  it("manda arte direto ao executor criativo, sem o Claude", () => {
    const d = route({ classification: classifyByRules("cria uma arte para o story"), claude: healthy("claude"), codex: healthy("codex"), cfg, now: NOW });
    expect("blocked" in d).toBe(false);
    if (!("blocked" in d)) expect([d.provider, d.direct]).toEqual(["codex", "imagem"]);
  });

  it("não promete carrossel enquanto ele não existe", () => {
    const d = route({ classification: classifyByRules("faz um carrossel"), claude: healthy("claude"), codex: healthy("codex"), cfg, now: NOW });
    expect("blocked" in d).toBe(true);
  });

  it("usa o modelo econômico para conversa simples e o principal para análise", () => {
    const simples = route({ classification: classifyByRules("oi"), claude: healthy("claude"), codex: healthy("codex"), cfg, now: NOW });
    const analise = route({ classification: classifyByRules("analisa as campanhas"), claude: healthy("claude"), codex: healthy("codex"), cfg, now: NOW });
    if ("blocked" in simples || "blocked" in analise) throw new Error("não deveria bloquear");
    expect([simples.provider, simples.tier, simples.model]).toEqual(["claude", "economico", "haiku"]);
    expect([analise.provider, analise.tier, analise.model]).toEqual(["claude", "principal", null]);
  });

  it("com o Claude em cooldown, conversa vai ao Codex", () => {
    const d = route({ classification: classifyByRules("oi, tudo bem?"), claude: cooling("claude"), codex: healthy("codex"), cfg, now: NOW });
    if ("blocked" in d) throw new Error("não deveria bloquear");
    expect(d.provider).toBe("codex");
  });

  it("com o Claude em cooldown, análise não vai ao Codex (precisa de conectores)", () => {
    const d = route({ classification: classifyByRules("analisa as campanhas"), claude: cooling("claude"), codex: healthy("codex"), cfg, now: NOW });
    expect("blocked" in d).toBe(true);
  });

  it("arte com o executor criativo indisponível bloqueia com motivo claro", () => {
    const d = route({ classification: classifyByRules("cria uma arte"), claude: healthy("claude"), codex: cooling("codex"), cfg, now: NOW });
    expect("blocked" in d && d.motivo).toContain("indisponível");
  });
});

describe("configuração", () => {
  it("o arquivo só substitui o que está nele", () => {
    const merged = mergeConfig(DEFAULT_CONFIG, { fallback: { enabled: false }, images: { dailyLimit: 3 } });
    expect(merged.fallback.enabled).toBe(false);
    expect(merged.fallback.categories).toEqual(["conversa", "resumo"]);
    expect(merged.images.dailyLimit).toBe(3);
    expect(merged.providers.claude.models.economico).toBe("haiku");
  });
});
