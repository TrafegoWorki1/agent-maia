import { describe, expect, it } from "vitest";
import { parseRoute, routeHash, sections } from "../src/lib/navigation";
describe("organização do painel", () => {
  it("tem dez áreas e uma única posição para cada página", () => {
    expect(sections).toHaveLength(10);
    const pages = sections.flatMap((s) => s.pages.map((p) => p.id));
    expect(new Set(pages).size).toBe(pages.length);
    expect(sections.find((s) => s.id === "sistema")!.pages.map((p) => p.id)).toEqual(["conexoes", "modelos"]);
    expect(sections.find((s) => s.id === "agente-maia")!.pages.map((p) => p.id)).toEqual(["regras", "manual"]);
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
    expect(parseRoute("#desconhecido")).toEqual({ section:"visao-geral",screen:"resumo" });
  });
  it("membro abre somente os próprios acessos", () => {
    for (const s of sections) for (const p of s.pages) {
      expect(parseRoute(`#${s.id}/${p.id}`, false)).toEqual({ section:"acessos",screen:"pessoas" });
    }
  });
});
