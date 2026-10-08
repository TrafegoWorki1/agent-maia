import { describe, expect, it } from "vitest";
import { parseJsonObject } from "../server/refreshJob.ts";


describe("leitura da resposta das consultas", () => {
  it("extrai o JSON mesmo com texto em volta", () => {
    expect(parseJsonObject('Aqui está:\n{"unread_count": 2, "unread_last_24h": 0}\nFim.')).toEqual({ unread_count: 2, unread_last_24h: 0 });
  });

  it("rejeita resposta sem JSON", () => {
    expect(() => parseJsonObject("Não consegui consultar o Gmail agora.")).toThrow("resposta sem JSON");
  });
});
