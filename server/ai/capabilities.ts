import type { Category, Complexity, ModelTier, ProviderId } from "./types.ts";

// O que cada provedor consegue fazer. Não presumir que os dois têm as mesmas ferramentas:
// o Codex NÃO herda os conectores exclusivos da conta Claude.ai (hoje: Gmail e Meta Ads). Sheets e Agenda
// (Calendar) têm integração própria do servidor (server/sheetsTools.ts, server/calendarTools.ts) e por
// isso já funcionam nos dois executores, com as mesmas aprovações.
export const CAPABILITIES: Record<ProviderId, { tools: "mcp" | "nenhuma"; categories: Category[]; observacao: string }> = {
  claude: {
    tools: "mcp",
    categories: ["conversa", "consulta", "resumo", "analise", "tarefa_tecnica", "escrita_externa", "geral"],
    observacao: "Conectores do claude.ai e aprovação por número.",
  },
  codex: {
    tools: "nenhuma",
    categories: ["conversa", "consulta", "resumo", "analise", "tarefa_tecnica", "escrita_externa", "geral", "imagem", "carrossel"],
    observacao: "Texto sem ferramentas e geração de imagem em sandbox. Sem conectores.",
  },
};

// Escolha do modelo do Claude: econômico para o simples, principal para o resto.
export function claudeTierFor(category: Category, complexity: Complexity): ModelTier {
  const cheap: Category[] = ["conversa", "resumo", "consulta"];
  return complexity === "simples" && cheap.includes(category) ? "economico" : "principal";
}

export function codexCanTake(category: Category): boolean {
  return CAPABILITIES.codex.categories.includes(category);
}
