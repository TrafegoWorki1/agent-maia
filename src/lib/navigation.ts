export const sections = [
  { id: "visao-geral", label: "Visão geral", icon: "home", pages: [{ id: "resumo", label: "Resumo" }, { id: "indicadores", label: "Indicadores" }] },
  { id: "marketing", label: "Marketing", icon: "marketing", pages: [{ id: "campanhas", label: "Campanhas" }, { id: "vendas", label: "Vendas e comunidade" }, { id: "insights", label: "Conversas e insights" }, { id: "tom", label: "Tom de voz" }] },
  { id: "execucao", label: "Execução", icon: "execution", pages: [{ id: "tarefas", label: "Tarefas e eficácia" }, { id: "ocorrencias", label: "Ocorrências" }] },
  { id: "comercial", label: "Comercial", icon: "comercial", pages: [{ id: "oportunidades", label: "Oportunidades" }, { id: "funil", label: "Funil" }] },
  { id: "projetos", label: "Projetos", icon: "projetos", pages: [{ id: "projetos-lista", label: "Projetos" }, { id: "implementacoes", label: "Implementações" }] },
  { id: "clientes-cs", label: "Clientes e CS", icon: "groups", pages: [{ id: "clientes", label: "Clientes" }, { id: "grupos", label: "Grupos do WhatsApp" }] },
  { id: "financeiro", label: "Financeiro", icon: "financeiro", pages: [{ id: "receitas", label: "Receitas" }, { id: "custos", label: "Custos e despesas" }] },
  { id: "acessos", label: "Equipe e acessos", icon: "access", pages: [{ id: "pessoas", label: "Acessos" }, { id: "grupos-acesso", label: "Grupos de acesso" }] },
  { id: "agente-maia", label: "Agente Maia", icon: "agent", pages: [{ id: "regras", label: "Regras ativas" }, { id: "manual", label: "Continuidade" }] },
  { id: "sistema", label: "Sistema e integrações", icon: "system", pages: [{ id: "conexoes", label: "Conexões e fontes" }, { id: "modelos", label: "Executor e roteamento" }] },
] as const;

export type SectionId = typeof sections[number]["id"];
export type ScreenId = typeof sections[number]["pages"][number]["id"];
export interface PanelRoute { section: SectionId; screen: ScreenId }
export function routeHash(route: PanelRoute): string { return `#${route.section}/${route.screen}`; }

export function parseRoute(hash: string, owner = true): PanelRoute {
  const raw = hash.replace(/^#/, "");
  // Legacy redirects
  const value = raw === "operacao" ? "manual"
    : raw === "agente" || raw === "agente-maia/agente" ? "regras"
    : raw === "grupos-clientes/grupos" ? "clientes-cs/grupos"
    : raw === "grupos-clientes/clientes" ? "clientes-cs/clientes"
    : raw === "grupos-clientes" ? "clientes-cs/clientes"
    : raw;
  const allowed = sections.filter((s) => owner || s.id === "acessos");
  for (const section of allowed) {
    if (value === section.id) return { section: section.id, screen: section.pages[0].id };
    for (const page of section.pages) {
      if (!owner && page.id !== "pessoas") continue;
      if (value === page.id || value === `${section.id}/${page.id}`) return { section: section.id, screen: page.id };
    }
  }
  return owner ? { section: "visao-geral", screen: "resumo" } : { section: "acessos", screen: "pessoas" };
}
