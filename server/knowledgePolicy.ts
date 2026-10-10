// Fontes aprovadas para a busca operacional. Planos e histórico não são política vigente.
export const KNOWLEDGE_DOCS = [
  { slug: "regras-maia", titulo: "Regras vigentes da Maia", origem: "docs/regras-da-maia.md", file: "docs/regras-da-maia.md" },
] as const;

export const RETIRED_KNOWLEDGE_SLUGS = ["claude-md", "erros-e-mudancas", "plano"] as const;

export function isCurrentKnowledgeSource(origem: string): boolean {
  return KNOWLEDGE_DOCS.some((doc) => doc.origem === origem);
}
