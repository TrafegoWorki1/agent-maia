import {describe,expect,it} from "vitest";
import {canonicalRouteHash,parseRoute,routeHash,sections} from "../src/lib/navigation";
describe("Navegação gerencial",()=>{
 it("organiza nove áreas sem duplicar telas",()=>{expect(sections).toHaveLength(9);const pages=sections.flatMap(s=>s.pages.map(p=>p.id));expect(new Set(pages).size).toBe(pages.length);expect(pages).toHaveLength(34);});
 it("abre todas as telas por ID e endereço canônico",()=>{for(const s of sections)for(const p of s.pages){const route={section:s.id,screen:p.id};expect(parseRoute("#"+p.id)).toEqual(route);expect(parseRoute(routeHash(route))).toEqual(route);}});
 it("mantém aliases e parâmetros de registro",()=>{
 const aliases={"#trabalho/coordenacao":"#gestao/coordenacao","#trabalho/planejamento?task=42":"#gestao/planejamento?task=42","#visao-geral/indicadores":"#execucao/indicadores","#marketing/vendas":"#comercial/vendas","#marketing/insights":"#execucao/insights","#clientes-cs/clientes":"#administracao/clientes","#acessos/pessoas":"#administracao/pessoas","#sistema/modelos":"#execucao/modelos","#sistema/conexoes":"#administracao/conexoes","#agente-maia/nucleo":"#administracao/nucleo","#operacao":"#administracao/manual","#agente":"#administracao/regras","#grupos-clientes":"#administracao/clientes","#grupos-clientes/grupos":"#clientes-cs/grupos","#projetos/projetos-lista?project=a&task=42":"#projetos/projetos-lista?project=a&task=42"};
 for(const [before,after] of Object.entries(aliases))expect(canonicalRouteHash(before)).toBe(after);
 });
 it("abre Gestão por padrão para o proprietário",()=>expect(parseRoute("#desconhecido")).toEqual({section:"gestao",screen:"panorama"}));
 it("mantém o acesso de membros, coordenação e financeiro",()=>{
 for(const s of sections)for(const p of s.pages)expect(parseRoute("#"+s.id+"/"+p.id,false)).toEqual({section:"administracao",screen:"pessoas"});
 const member=["meu-dia","projetos-lista","trabalho-marketing"],coord=["meu-dia","coordenacao","planejamento"],finance=["meu-dia","receitas","custos","metricas"];
 expect(canonicalRouteHash("#trabalho/coordenacao",coord)).toBe("#gestao/coordenacao");
 expect(canonicalRouteHash("#financeiro/custos",finance)).toBe("#financeiro/custos");
 for(const access of [member,coord,finance])for(const hash of ["#administracao/dados?task=99","#gestao/panorama","#clientes-cs/clientes","#marketing/campanhas"])expect(canonicalRouteHash(hash,access)).toBe("#trabalho/meu-dia");
 expect(parseRoute("#gestao/metricas",finance)).toEqual({section:"gestao",screen:"metricas"});
 });
});
