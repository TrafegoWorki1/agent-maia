import { describe, expect, it } from "vitest";
import { agreement, intentAgreement, jevMetrics, toolLabels } from "../server/jev.ts";

describe("toolLabels", () => {
  it("ignora ferramentas neutras", () => {
    for (const t of ["ToolSearch", "TodoWrite", "Read", "WebSearch"]) expect(toolLabels(t)).toEqual([]);
  });
  it("mapeia arte, grupo, tarefa e escrita", () => {
    expect(toolLabels("mcp__maia__gerar_imagem")).toEqual(["arte"]);
    expect(toolLabels("mcp__maia__grupo_enviar_texto")).toEqual(["grupo", "escrita"]);
    expect(toolLabels("mcp__maia__grupos_listar")).toEqual(["grupo", "consulta"]);
    expect(toolLabels("mcp__maia__tarefa_criar")).toEqual(["tarefa", "escrita"]);
    expect(toolLabels("mcp__maia__avisar_dono")).toEqual(["fora_do_escopo", "consulta"]);
  });
});

describe("agreement", () => {
  it("sem ferramenta só confirma conversa/fora do escopo", () => {
    expect(agreement({ categoria: "conversa" }, [])).toBe(true);
    expect(agreement({ categoria: "escrita" }, [])).toBeNull();
    expect(agreement(null, [])).toBeNull();
  });
  it("conversa com ferramenta discorda", () => {
    expect(agreement({ categoria: "conversa" }, ["consulta"])).toBe(false);
    expect(agreement({ categoria: "grupo" }, ["grupo", "escrita"])).toBe(true);
  });
});

describe("intentAgreement", () => {
  it("compara pela intenção", () => {
    expect(intentAgreement({ intencao: "conversa" }, [])).toBe(true);
    expect(intentAgreement({ intencao: "imagem" }, ["arte"])).toBe(true);
    expect(intentAgreement({ intencao: "consulta" }, ["escrita"])).toBe(false);
    expect(intentAgreement({ intencao: "tarefa_tecnica" }, ["escrita"])).toBeNull();
    expect(intentAgreement({ intencao: null }, [])).toBeNull();
  });
});

describe("jevMetrics", () => {
  const row = (o: object) => ({ categoria: "conversa", confianca: 0.9, manipulacao: 0, intencao: "conversa", complexidade: "simples", ms: 400, erro: null, ferramentas: [], ...o });
  it("calcula concordância, latência e falhas", () => {
    const m = jevMetrics([
      row({}),
      row({ categoria: "consulta", intencao: "consulta", ferramentas: ["mcp__maia__conversas_listar"], ms: 600 }),
      row({ ferramentas: ["mcp__maia__tarefa_criar"] }),
      row({ categoria: null, erro: "timeout", ms: null }),
    ]);
    expect(m.triadas).toBe(4);
    expect(m.falhas).toBe(1);
    expect(m.comparaveis).toBe(3);
    expect(m.concordancia).toBe(67);
    expect(m.porCategoria.conversa).toEqual({ n: 2, concordancia: 50 });
    expect(m.latenciaMs.max).toBe(600);
  });
  it("lida com lista vazia", () => {
    const m = jevMetrics([]);
    expect(m.concordancia).toBeNull();
    expect(m.latenciaMs.p50).toBeNull();
  });
});
