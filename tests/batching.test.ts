import { describe, expect, it } from "vitest";
import { consolidate, isDue } from "../server/batching.ts";

describe("agrupamento de mensagens do dono", () => {
  const opened = Date.parse("2026-10-08T12:00:00Z");
  const at = (seconds: number) => new Date(opened + seconds * 1000);
  const batch = { ready_at: new Date(opened + 15_000).toISOString(), deadline_at: new Date(opened + 60_000).toISOString() };

  it("não fica pronto antes do silêncio de 15 segundos", () => {
    expect(isDue(batch, at(10))).toBe(false);
  });

  it("fica pronto depois de 15 segundos sem nova mensagem", () => {
    expect(isDue(batch, at(15))).toBe(true);
  });

  it("fica pronto no limite de 60 segundos, mesmo com mensagens chegando", () => {
    // Mensagens chegando sem parar: o ready_at fica limitado ao prazo de 60 s.
    const busy = { ready_at: new Date(opened + 60_000).toISOString(), deadline_at: new Date(opened + 60_000).toISOString() };
    expect(isDue(busy, at(59))).toBe(false);
    expect(isDue(busy, at(60))).toBe(true);
  });

  it("junta as mensagens na ordem de chegada, uma por linha", () => {
    const text = consolidate([
      { seq: 3, payload: "Quero também custo por resultado." },
      { seq: 1, payload: "Maia, quero um relatório das campanhas." },
      { seq: 2, payload: "Compara setembro com outubro." },
    ]);
    expect(text).toBe("Maia, quero um relatório das campanhas.\nCompara setembro com outubro.\nQuero também custo por resultado.");
  });

  it("ignora mensagens vazias ao juntar", () => {
    expect(consolidate([{ seq: 1, payload: "  " }, { seq: 2, payload: "oi" }, { seq: 3, payload: null }])).toBe("oi");
  });
});
