export const sections = [
  { id: "visao-geral", label: "Visão geral", icon: "home", pages: [{ id: "resumo", label: "Resumo" }, { id: "indicadores", label: "Indicadores" }] },
  { id: "marketing", label: "Marketing", icon: "marketing", pages: [{ id: "campanhas", label: "Campanhas" }, { id: "vendas", label: "Vendas e comunidade" }, { id: "insights", label: "Conversas e insights" }, { id: "tom", label: "Tom de voz" }] },
  { id: "execucao", label: "Execução", icon: "execution", pages: [{ id: "tarefas", label: "Tarefas e eficácia" }, { id: "ocorrencias", label: "Ocorrências" }] },
  { id: "grupos-clientes", label: "Grupos e clientes", icon: "groups", pages: [{ id: "grupos", label: "Grupos do WhatsApp" }, { id: "clientes", label: "Clientes" }] },
  { id: "acessos", label: "Equipe e acessos", icon: "access", pages: [{ id: "pessoas", label: "Acessos" }, { id: "grupos-acesso", label: "Grupos de acesso" }] },
  { id: "agente-maia", label: "Agente Maia", icon: "agent", pages: [{ id: "agente", label: "Conversa" }, { id: "regras", label: "Regras ativas" }, { id: "manual", label: "Continuidade" }] },
  { id: "sistema", label: "Sistema e integrações", icon: "system", pages: [{ id: "conexoes", label: "Conexões e fontes" }, { id: "modelos", label: "Executor e roteamento" }] },
] as const;
export type SectionId = typeof sections[number]["id"];
export type ScreenId = typeof sections[number]["pages"][number]["id"];
export interface PanelRoute { section: SectionId; screen: ScreenId }
export function routeHash(route: PanelRoute): string { return `#${route.section}/${route.screen}`; }
export function parseRoute(hash: string, owner = true): PanelRoute {
  const raw = hash.replace(/^#/, "");
  const value = raw === "operacao" ? "manual" : raw;
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
