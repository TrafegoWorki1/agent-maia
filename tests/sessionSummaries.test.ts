import { describe, expect, it } from "vitest";
import { parseGeneratedSummary } from "../server/sessionSummaries.ts";

describe("resumos persistentes de sessão", () => {
  it("separa fatos e exige referência a mensagens reais", () => {
    const raw = JSON.stringify({ summary: "Decisão registrada; ação ainda pendente.", confirmed: [{ text: "O owner decidiu revisar", ids: [11] }], pending: [{ text: "Aguardando confirmação", ids: [12] }] });
    const parsed = parseGeneratedSummary(raw, new Set([11, 12]));
    expect(parsed.confirmed[0].ids).toEqual([11]);
    expect(parsed.pending).toHaveLength(1);
    expect(() => parseGeneratedSummary(raw, new Set([11]))).toThrow(/referência ausente/);
  });
});
