import { describe, expect, it } from "vitest";
import { classifyError } from "../server/ai/errorClassifier.ts";
import { applyEvent, initialHealth, isRoutable } from "../server/ai/providerHealth.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const cfg = { cooldownMs: 15 * 60 * 1000, degradedAfter: 2, unavailableAfter: 5 };

describe("classificação de erros", () => {
  it("limite de uso e rate limit permitem fallback, com o tempo informado", () => {
    const quota = classifyError(new Error("Claude usage limit reached. Try again in 30 minutes"));
    expect([quota.kind, quota.fallbackAllowed, quota.retryAfterMs]).toEqual(["quota", true, 30 * 60 * 1000]);
    expect(classifyError("429 Too Many Requests").kind).toBe("rate_limit");
  });

  it("autenticação, permissão, orçamento e limite de passos nunca permitem fallback", () => {
    for (const text of ["Invalid API key (401)", "permission denied", "Agent SDK falhou (error_max_budget_usd)", "error_max_turns"]) {
      expect(classifyError(text).fallbackAllowed).toBe(false);
    }
    expect(classifyError("Invalid API key (401)").kind).toBe("auth");
    expect(classifyError("permission denied").kind).toBe("permission");
  });

  it("indisponibilidade e timeout permitem fallback; erro desconhecido não", () => {
    expect(classifyError("fetch failed").fallbackAllowed).toBe(true);
    expect(classifyError("tempo esgotado no Claude").kind).toBe("timeout");
    expect(classifyError("algo inesperado").fallbackAllowed).toBe(false);
  });
});

describe("circuit breaker", () => {
  it("limite confirmado coloca o provedor em cooldown e fecha o tráfego", () => {
    const rec = applyEvent(initialHealth("claude"), { type: "failure", kind: "quota", retryAfterMs: 20 * 60 * 1000, message: "limit" }, NOW, cfg);
    expect(rec.state).toBe("cooldown");
    expect(Date.parse(rec.cooldownUntil!)).toBe(NOW + 20 * 60 * 1000);
    expect(isRoutable(rec, NOW)).toBe(false);
  });

  it("depois do cooldown, o provedor entra em recuperação e aceita uma tentativa", () => {
    const rec = applyEvent(initialHealth("claude"), { type: "failure", kind: "rate_limit", retryAfterMs: null, message: "429" }, NOW, cfg);
    const later = NOW + cfg.cooldownMs + 1000;
    expect(isRoutable(rec, later)).toBe(true);
    expect(applyEvent(rec, { type: "tick" }, later, cfg).state).toBe("recovering");
  });

  it("sucesso volta ao normal e zera as falhas", () => {
    let rec = applyEvent(initialHealth("codex"), { type: "failure", kind: "timeout", retryAfterMs: null, message: "t" }, NOW, cfg);
    rec = applyEvent(rec, { type: "success" }, NOW, cfg);
    expect(rec).toMatchObject({ state: "healthy", consecutiveFailures: 0, cooldownUntil: null });
  });

  it("falhas repetidas degradam e depois tornam o provedor indisponível", () => {
    let rec = initialHealth("claude");
    for (let i = 0; i < 2; i += 1) rec = applyEvent(rec, { type: "failure", kind: "unavailable", retryAfterMs: null, message: "x" }, NOW, cfg);
    expect(rec.state).toBe("degraded");
    for (let i = 0; i < 3; i += 1) rec = applyEvent(rec, { type: "failure", kind: "unavailable", retryAfterMs: null, message: "x" }, NOW, cfg);
    expect(rec.state).toBe("unavailable");
  });

  it("erro de tarefa (permissão, orçamento) não conta contra o provedor", () => {
    const rec = applyEvent(initialHealth("claude"), { type: "failure", kind: "permission", retryAfterMs: null, message: "negado" }, NOW, cfg);
    expect(rec.state).toBe("healthy");
    expect(rec.consecutiveFailures).toBe(0);
  });
});
