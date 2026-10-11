import type { Category, Classification, Complexity, Risk } from "./types.ts";

// Classificação determinística. É a base do roteamento e o plano B quando o Jev falha ou tem pouca confiança.
// Só olha o texto do pedido. Não concede nenhuma permissão.
function make(category: Category, complexity: Complexity, risk: Risk, motivo: string): Classification {
  return { category, complexity, risk, source: "regras", confidence: null, motivo };
}

export function classifyByRules(text: string): Classification {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/carrosse?l/.test(t)) return make("carrossel", "complexa", "baixo", "pedido de carrossel");
  if (isImageCreationRequest(text)) {
    return make("imagem", "intermediaria", "baixo", "pedido de arte ou imagem");
  }
  if (/\b(envi\w+|publi\w+|exclu\w+|apag\w+|alter\w+|mud\w+|ativ\w+|paus\w+)\b/.test(t) && /\b(campanha|anuncio|orcamento|planilha|email|e-mail|evento|post)\b/.test(t)) {
    return make("escrita_externa", "intermediaria", "alto", "pedido que altera algo externo");
  }
  if (/\b(analis\w+|compar\w+|relatorio|desempenho|roi|cpl|cpa|estrategia|planej\w+)\b/.test(t)) return make("analise", "complexa", "baixo", "pedido de análise");
  if (/\bresum\w+/.test(t)) return make("resumo", "simples", "baixo", "pedido de resumo");
  if (/\b(quanto|quais|qual|mostre|liste|me diz\w*|status|gasto|saldo|tem algum)\b/.test(t)) return make("consulta", "intermediaria", "baixo", "pergunta de consulta");
  if (text.trim().length < 40 && /^(oi+|ola|bom dia|boa tarde|boa noite|obrigad\w+|valeu|ok|certo|beleza)\b/.test(t)) return make("conversa", "simples", "baixo", "cumprimento ou conversa curta");
  return make("geral", "intermediaria", "baixo", "sem categoria específica");
}

// A criação de imagem é um efeito local com custo/tempo. Não basta o tema da conversa
// mencionar Stories ou a Maia oferecer uma possibilidade: a mensagem original precisa
// conter um pedido afirmativo de criação.
export function isImageCreationRequest(text: string): boolean {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(nao|nunca|sem)\b.{0,60}\b(crie|criar|faca|fazer|gere|gerar|monte|montar)\b/.test(t)) return false;
  const asksForImage = /\b(arte|imagem|criativo|banner|capa|post|story|stories)\b/.test(t);
  if (!asksForImage) return false;
  const directImperative = /^(?:(?:por favor|me)\s+)*(?:cria|crie|faz|faca|gera|gere|monta|monte)\b/.test(t);
  const directPoliteRequest = /^(?:voce\s+)?pode\s+(?:(?:por favor|me)\s+)*(?:criar|cria|crie|fazer|faz|faca|gerar|gere|montar|monte)\b/.test(t);
  const couldYouRequest = /^(?:voce\s+)?poderia\s+(?:(?:por favor|me)\s+)*(?:criar|cria|crie|fazer|faz|faca|gerar|gere|montar|monte)\b/.test(t);
  const explicitIntent = /^(?:eu\s+)?(?:quero|preciso|gostaria)\b.{0,50}\b(?:criar|crie|cria|fazer|faz|faca|gerar|gere|montar|monte)\b/.test(t);
  return directImperative || directPoliteRequest || couldYouRequest || explicitIntent;
}
