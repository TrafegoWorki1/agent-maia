export const sections = [
  { id: "trabalho", label: "Central de trabalho", icon: "work", pages: [{ id: "meu-dia", label: "Meu dia" }, { id: "minha-equipe", label: "Minha equipe" }, { id: "coordenacao", label: "Coordenação" }, { id: "direcao", label: "Direção" }, { id: "planejamento", label: "Planejamento" }, { id: "metricas", label: "Métricas" }] },
  { id: "visao-geral", label: "Saúde da Maia", icon: "home", pages: [{ id: "resumo", label: "Resumo técnico" }, { id: "indicadores", label: "Indicadores da IA" }] },
  { id: "marketing", label: "Marketing", icon: "marketing", pages: [{ id: "trabalho-marketing", label: "Trabalho e calendário" }, { id: "campanhas", label: "Fonte Meta (owner)" }, { id: "vendas", label: "Vendas e comunidade" }, { id: "insights", label: "Conversas e insights" }, { id: "tom", label: "Tom de voz" }] },
  { id: "execucao", label: "Operação da Maia", icon: "execution", pages: [{ id: "tarefas", label: "Filas, entregas e eficácia" }, { id: "ocorrencias", label: "Ocorrências" }] },
  { id: "comercial", label: "Comercial", icon: "comercial", pages: [{ id: "oportunidades", label: "Oportunidades" }, { id: "funil", label: "Funil" }] },
  { id: "projetos", label: "Projetos", icon: "projetos", pages: [{ id: "projetos-lista", label: "Projetos" }, { id: "implementacoes", label: "Implementações" }] },
  { id: "clientes-cs", label: "Clientes e CS", icon: "groups", pages: [{ id: "acompanhamento", label: "Acompanhamento" }, { id: "clientes", label: "Cadastro (owner)" }, { id: "grupos", label: "Grupos do WhatsApp" }] },
  { id: "financeiro", label: "Financeiro", icon: "financeiro", pages: [{ id: "receitas", label: "Receitas" }, { id: "custos", label: "Custos e despesas" }] },
  { id: "acessos", label: "Equipe e acessos", icon: "access", pages: [{ id: "pessoas", label: "Acessos" }, { id: "grupos-acesso", label: "Grupos de acesso" }] },
  { id: "agente-maia", label: "Agente Maia", icon: "agent", pages: [{ id: "regras", label: "Regras ativas" }, { id: "memoria", label: "Memória e combinados" }, { id: "nucleo", label: "Núcleo e automações" }, { id: "manual", label: "Continuidade" }] },
  { id: "sistema", label: "Sistema e integrações", icon: "system", pages: [{ id: "conexoes", label: "Conexões e fontes" }, { id: "modelos", label: "Executor e roteamento" }] },
] as const;

export type SectionId = typeof sections[number]["id"];
export type ScreenId = typeof sections[number]["pages"][number]["id"];
export interface PanelRoute { section: SectionId; screen: ScreenId }
export function routeHash(route: PanelRoute): string { return `#${route.section}/${route.screen}`; }

export function parseRoute(hash: string, access: boolean | readonly string[] = true): PanelRoute {
  const owner = typeof access === "boolean" ? access : false;
  const screens = new Set(typeof access === "boolean" ? [] : access);
  const raw = hash.replace(/^#/, "").split("?")[0];
  const value = raw === "operacao" ? "manual"
    : raw === "agente" || raw === "agente-maia/agente" ? "regras"
    : raw === "grupos-clientes/grupos" ? "clientes-cs/grupos"
    : raw === "grupos-clientes/clientes" ? "clientes-cs/clientes"
    : raw === "grupos-clientes" ? "clientes-cs/clientes"
    : raw;
  const allowed = sections.filter((section) => owner || section.pages.some((page) => screens.has(page.id)) || (typeof access === "boolean" && !access && section.id === "acessos"));
  for (const section of allowed) {
    if (value === section.id) {const first=section.pages.find(page=>owner||screens.has(page.id)||(typeof access==="boolean"&&page.id==="pessoas"));if(first)return {section:section.id,screen:first.id};}
    for (const page of section.pages) {
      if (!owner && !screens.has(page.id) && !(typeof access === "boolean" && page.id === "pessoas")) continue;
      if (value === page.id || value === `${section.id}/${page.id}`) return { section: section.id, screen: page.id };
    }
  }
  if (owner) return { section: "trabalho", screen: "meu-dia" };
  const first = sections[0].pages.find((page) => screens.has(page.id));
  return first ? { section:"trabalho",screen:first.id } : { section: "acessos", screen: "pessoas" };
}
