import { describe, expect, it } from "vitest";
import { parseRoute, routeHash, sections } from "../src/lib/navigation";
describe("organização do painel", () => {
  it("tem onze áreas e uma única posição para cada página", () => {
    expect(sections).toHaveLength(11);
    const pages = sections.flatMap((s) => s.pages.map((p) => p.id));
    expect(new Set(pages).size).toBe(pages.length);
    expect(sections.find((s) => s.id === "sistema")!.pages.map((p) => p.id)).toEqual(["conexoes", "modelos"]);
    expect(sections.find((s) => s.id === "agente-maia")!.pages.map((p) => p.id)).toEqual(["regras", "memoria", "nucleo", "manual"]);
  });
  it("preserva endereços antigos e produz rotas canônicas", () => {
    for (const s of sections) for (const p of s.pages) {
      const route = { section: s.id, screen: p.id };
      expect(parseRoute(`#${p.id}`)).toEqual(route);
      expect(parseRoute(routeHash(route))).toEqual(route);
    }
    expect(parseRoute("#operacao")).toEqual({ section:"agente-maia",screen:"manual" });
    expect(parseRoute("#agente")).toEqual({ section:"agente-maia",screen:"regras" });
    expect(parseRoute("#agente-maia/agente")).toEqual({ section:"agente-maia",screen:"regras" });
    expect(parseRoute("#grupos-clientes/grupos")).toEqual({ section:"clientes-cs",screen:"grupos" });
    expect(parseRoute("#grupos-clientes/clientes")).toEqual({ section:"clientes-cs",screen:"clientes" });
    expect(parseRoute("#grupos-clientes")).toEqual({ section:"clientes-cs",screen:"clientes" });
    expect(parseRoute("#desconhecido")).toEqual({ section:"trabalho",screen:"meu-dia" });
  });
  it("membro abre somente os próprios acessos", () => {
    for (const s of sections) for (const p of s.pages) {
      expect(parseRoute(`#${s.id}/${p.id}`, false)).toEqual({ section:"acessos",screen:"pessoas" });
    }
  });
  it("membro recebe somente as telas colaborativas autorizadas", () => {
    expect(parseRoute("#trabalho/meu-dia",["meu-dia"])).toEqual({section:"trabalho",screen:"meu-dia"});
    expect(parseRoute("#trabalho/direcao",["meu-dia"])).toEqual({section:"trabalho",screen:"meu-dia"});
  });
  it("áreas especializadas respeitam telas concedidas sem liberar administração",()=>{
    const access=["meu-dia","acompanhamento","projetos-lista","trabalho-marketing"];
    expect(parseRoute("#clientes-cs",access)).toEqual({section:"clientes-cs",screen:"acompanhamento"});
    expect(parseRoute("#projetos/projetos-lista?task=42",access)).toEqual({section:"projetos",screen:"projetos-lista"});
    expect(parseRoute("#clientes-cs/clientes",access)).toEqual({section:"trabalho",screen:"meu-dia"});
    expect(parseRoute("#marketing/campanhas",access)).toEqual({section:"trabalho",screen:"meu-dia"});
  });
});
