import type { Category, Classification, Complexity, Risk } from "./types.ts";

// Classificação determinística. É a base do roteamento e o plano B quando o Jev falha ou tem pouca confiança.
// Só olha o texto do pedido. Não concede nenhuma permissão.
function make(category: Category, complexity: Complexity, risk: Risk, motivo: string): Classification {
  return { category, complexity, risk, source: "regras", confidence: null, motivo };
}

export function classifyByRules(text: string): Classification {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/carrosse?l/.test(t)) return make("carrossel", "complexa", "baixo", "pedido de carrossel");
  if (/\b(cri[ae]\w*|faz\w*|gera\w*|monta\w*)\b.*\b(arte|imagem|criativo|banner|capa|post|story|stories)\b/.test(t)) {
    return make("imagem", "intermediaria", "baixo", "pedido de arte ou imagem");
  }
  if (/\b(envi\w+|publi\w+|exclu\w+|apag\w+|alter\w+|mud\w+|ativ\w+|paus\w+)\b/.test(t) && /\b(campanha|anuncio|orcamento|planilha|email|e-mail|evento|post)\b/.test(t)) {
    return make("escrita_externa", "intermediaria", "alto", "pedido que altera algo externo");
  }
  if (/\b(analis\w+|compar\w+|relatorio|desempenho|roi|cpl|cpa|estrategia|planej\w+)\b/.test(t)) return make("analise", "complexa", "baixo", "pedido de análise");
  if (/\bresum\w+/.test(t)) return make("resumo", "simples", "baixo", "pedido de resumo");
  if (/\b(quanto|quais|qual|mostre|liste|me diz\w*|status|gasto|saldo|tem algum)\b/.test(t)) return make("consulta", "intermediaria", "baixo", "pergunta de consulta");
  if (text.trim().length < 40 && /^(oi|ola|bom dia|boa tarde|boa noite|obrigad\w+|valeu|ok|certo|beleza)\b/.test(t)) return make("conversa", "simples", "baixo", "cumprimento ou conversa curta");
  return make("geral", "intermediaria", "baixo", "sem categoria específica");
}
