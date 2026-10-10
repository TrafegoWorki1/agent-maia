import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../server/ai/config.ts";
import { decideFallback, effectFromTools } from "../server/ai/fallback.ts";

const base = { fallbackAllowed: true, errorKind: "quota", category: "conversa" as const, effect: "read_only" as const, codexRoutable: true, cfg: DEFAULT_CONFIG };

describe("política de fallback", () => {
  it("permite quando é erro de provedor, sem efeito externo e tarefa compatível", () => {
    expect(decideFallback(base).allowed).toBe(true);
  });

  it("não troca de provedor por erro de autenticação ou permissão", () => {
    expect(decideFallback({ ...base, fallbackAllowed: false, errorKind: "auth" }).allowed).toBe(false);
    expect(decideFallback({ ...base, fallbackAllowed: false, errorKind: "permission" }).allowed).toBe(false);
  });

  it("não repete quando um efeito externo já começou", () => {
    const d = decideFallback({ ...base, effect: effectFromTools(["consulta", "escrita"]) });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("external_effect_started");
  });

  it("não envia ao Codex o que precisa de conectores", () => {
    expect(decideFallback({ ...base, category: "analise" }).allowed).toBe(true);
    expect(decideFallback({ ...base, category: "consulta" }).allowed).toBe(true);
  });

  it("não tenta o Codex quando ele está indisponível (sem laço de tentativas)", () => {
    expect(decideFallback({ ...base, codexRoutable: false }).allowed).toBe(false);
  });

  it("respeita o desligamento na configuração", () => {
    expect(decideFallback({ ...base, cfg: { ...DEFAULT_CONFIG, fallback: { ...DEFAULT_CONFIG.fallback, enabled: false } } }).allowed).toBe(false);
  });

  it("deduz o estado do efeito pelas ferramentas usadas", () => {
    expect(effectFromTools([])).toBe("read_only");
    expect(effectFromTools(["consulta"])).toBe("read_only");
    expect(effectFromTools(["arte"])).toBe("local_creation");
    expect(effectFromTools(["escrita"])).toBe("external_effect_started");
  });
});
