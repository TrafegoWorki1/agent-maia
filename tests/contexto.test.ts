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
    expect(pickContext([row(1, "owner", "tarefa revisar campanha")], "tarefa revisar campanha", NOW)).toBe("");
  });
  it("ignora mensagens fora da janela de 24 horas e de terceiros", () => {
    const rows = [row(25 * 60, "owner", "antiga"), row(2, "terceiro", "não entra"), row(3, "maia", "recente")];
    expect(pickContext(rows, "agora", NOW)).toBe("Maia: recente");
  });
  it("não corta resposta longa da Maia que o owner confirma depois", () => {
    const longo = "a".repeat(3500);
    expect(pickContext([row(1, "maia", longo)], "Ok", NOW)).toBe(`Maia: ${longo}`);
  });
  it("preserva até 48 linhas recentes para conversas com várias trocas", () => {
    const rows = Array.from({ length: 52 }, (_, i) => row(52 - i, "owner", `msg${i}`));
    const picked = pickContext(rows, "atual", NOW).split("\n");
    expect(picked).toHaveLength(48);
    expect(picked[0]).toBe("Dono: msg4");
    expect(picked[47]).toBe("Dono: msg51");
  });
  it("respeita o orçamento total quando muitas linhas são longas", () => {
    const rows = Array.from({ length: 48 }, (_, i) => row(48 - i, "maia", `m${i} ${"x".repeat(3000)}`));
    const picked = pickContext(rows, "atual", NOW);
    expect(picked.length).toBeLessThanOrEqual(28_000);
    expect(picked.split("\n").length).toBeGreaterThan(1);
  });
});
