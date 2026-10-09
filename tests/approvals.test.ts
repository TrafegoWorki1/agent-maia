import { describe, expect, it } from "vitest";
import { parseDecision, processAlive } from "../server/approvals.ts";

describe("respostas de aprovação", () => {
  it("lê SIM e NÃO, com ou sem número", () => {
    expect(parseDecision("SIM 12")).toEqual({ approved: true, id: 12 });
    expect(parseDecision("não 7")).toEqual({ approved: false, id: 7 });
    expect(parseDecision("nao")).toEqual({ approved: false, id: null });
    expect(parseDecision("  sim  ")).toEqual({ approved: true, id: null });
  });

  it("ignora texto comum e números sem resposta", () => {
    expect(parseDecision("oi, tudo bem?")).toBeNull();
    expect(parseDecision("sim, pode fazer isso")).toBeNull();
    expect(parseDecision("12")).toBeNull();
  });

  it("reconhece processo vivo e processo morto", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(null)).toBe(false);
    expect(processAlive(999999)).toBe(false);
  });
});
