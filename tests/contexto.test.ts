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

  it("ignora mensagens fora da janela de 2 horas e de terceiros", () => {
    const rows = [row(150, "owner", "antiga"), row(2, "terceiro", "não entra"), row(3, "maia", "recente")];
    expect(pickContext(rows, "agora", NOW)).toBe("Maia: recente");
  });

  // Regressão real (10/10/2026): o dono mandou 5 posts longos; a Maia só viu o início do primeiro porque
  // cada linha era cortada em 400 caracteres e só entravam 8 linhas dos últimos 30 minutos. Diagnóstico
  // da própria Maia (sem acesso de escrita) corrigido aqui: 4000 caracteres, 14 linhas, 2 horas.
  it("não corta uma resposta longa da Maia (ex.: rascunho que o Ok do dono confirma)", () => {
    const longo = "a".repeat(3500);
    const rows = [row(1, "maia", longo)];
    expect(pickContext(rows, "Ok", NOW)).toBe(`Maia: ${longo}`);
  });

  it("mantém até 14 linhas recentes, não só 8", () => {
    const rows = Array.from({ length: 16 }, (_, i) => row(16 - i, "owner", `msg${i}`));
    const picked = pickContext(rows, "atual", NOW).split("\n");
    expect(picked).toHaveLength(14);
    expect(picked[0]).toBe("Dono: msg2");
    expect(picked[13]).toBe("Dono: msg15");
  });
});
