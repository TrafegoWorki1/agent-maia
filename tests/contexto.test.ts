import { describe, expect, it } from "vitest";
import { pickContext } from "../server/context.ts";

const NOW = Date.parse("2026-10-09T03:40:00Z");
const row = (minAgo: number, author: string, text: string) => ({ at: new Date(NOW - minAgo * 60000).toISOString(), author, text });

describe("contexto da conversa", () => {
  it("inclui as mensagens recentes do dono e da Maia, em ordem", () => {
    const rows = [row(5, "owner", "criar grupo Operacional Worki digital"), row(4, "maia", "Qual o nome exato?"), row(1, "owner", "Operacional Worki digital")];
    expect(pickContext(rows, "Operacional Worki digital", NOW)).toBe("Dono: criar grupo Operacional Worki digital\nMaia: Qual o nome exato?");
  });

  it("não repete a mensagem atual", () => {
    const rows = [row(1, "owner", "tarefa revisar campanha")];
    expect(pickContext(rows, "tarefa revisar campanha", NOW)).toBe("");
  });

  it("ignora mensagens fora da janela de 30 minutos e de terceiros", () => {
    const rows = [row(45, "owner", "antiga"), row(2, "terceiro", "não entra"), row(3, "maia", "recente")];
    expect(pickContext(rows, "agora", NOW)).toBe("Maia: recente");
  });
});
