import { describe, expect, it } from "vitest";
import { monotonicStatus, normalizeOutboundStatus, outboundContentHash, summarizeReceipt } from "../server/outboundReceipts.ts";

describe("recibos de mensagens de saída", () => {
  it("gera HMAC estável para a comparação exata sem persistir texto claro", () => {
    const previous = process.env.EVOLUTION_API_KEY;
    process.env.EVOLUTION_API_KEY = "test-secret-key";
    try {
      const hash = outboundContentHash("Olá, grupo!");
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(outboundContentHash("Olá, grupo!")).toBe(hash);
      expect(outboundContentHash("Olá grupo!")).not.toBe(hash);
      expect(hash).not.toContain("Olá");
    } finally {
      if (previous === undefined) delete process.env.EVOLUTION_API_KEY;
      else process.env.EVOLUTION_API_KEY = previous;
    }
  });
  it("reconhece apenas estados textuais suportados", () => {
    expect(normalizeOutboundStatus("sent")).toBe("accepted");
    expect(normalizeOutboundStatus("delivered")).toBe("delivered");
    expect(normalizeOutboundStatus("read")).toBe("read");
    expect(normalizeOutboundStatus("played")).toBe("played");
    expect(normalizeOutboundStatus("failed")).toBe("failed");
    expect(normalizeOutboundStatus(0)).toBe("failed");
    expect(normalizeOutboundStatus(1)).toBeNull();
    expect(normalizeOutboundStatus(2)).toBe("accepted");
    expect(normalizeOutboundStatus(3)).toBe("delivered");
    expect(normalizeOutboundStatus(4)).toBe("read");
    expect(normalizeOutboundStatus(5)).toBe("played");
    expect(normalizeOutboundStatus(6)).toBeNull();
    expect(normalizeOutboundStatus("ack_4")).toBeNull();
  });

  it("não rebaixa leitura quando eventos chegam fora de ordem", () => {
    expect(monotonicStatus("read", "accepted")).toBe("read");
    expect(monotonicStatus("delivered", "read")).toBe("read");
    expect(monotonicStatus("delivered", "failed")).toBe("delivered");
    expect(monotonicStatus("failed", "delivered")).toBe("delivered");
  });

  it("distingue aceite do serviço de entrega e leitura", () => {
    expect(summarizeReceipt("accepted")).toContain("ainda não confirmada");
    expect(summarizeReceipt("delivered")).toContain("entregue");
    expect(summarizeReceipt("read")).toContain("lida");
  });
});
