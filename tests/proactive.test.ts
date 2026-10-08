import { describe, expect, it } from "vitest";
import { brtDay, brtHour, buildDailySummary, runProactive, sourceTransitions } from "../server/proactive.ts";

// 2026-10-08 12:00 UTC = 09:00 em Brasília
const NINE_AM = new Date("2026-10-08T12:00:00Z");

describe("fuso de Brasília", () => {
  it("converte dia e hora de UTC para UTC-3", () => {
    expect(brtDay(NINE_AM)).toBe("2026-10-08");
    expect(brtHour(NINE_AM)).toBe(9);
    expect(brtDay(new Date("2026-10-08T01:00:00Z"))).toBe("2026-10-07");
  });
});

describe("transições de conexão", () => {
  it("alerta quando cai e avisa quando volta", () => {
    expect(sourceTransitions({ gmail: "ok" }, { gmail: "error" })).toEqual([{ source: "gmail", to: "error" }]);
    expect(sourceTransitions({ gmail: "error" }, { gmail: "ok" })).toEqual([{ source: "gmail", to: "ok" }]);
  });

  it("não avisa quando nada mudou nem na primeira observação saudável", () => {
    expect(sourceTransitions({ gmail: "ok" }, { gmail: "ok" })).toEqual([]);
    expect(sourceTransitions({}, { gmail: "ok" })).toEqual([]);
  });

  it("alerta já na primeira observação, se estiver com erro", () => {
    expect(sourceTransitions({}, { meta: "error" })).toEqual([{ source: "meta", to: "error" }]);
  });
});
