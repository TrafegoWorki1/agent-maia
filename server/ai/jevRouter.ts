import type { JevResult } from "../jev.ts";
import type { Category, Classification, Complexity, Risk, RoutingConfig } from "./types.ts";

// O Jev recomenda o roteamento; nunca autoriza nada. Por padrão ele fica em modo sombra: a classificação por regras decide.
// Só passa a decidir quando a configuração liga jev.activeRouting, com confiança suficiente e risco baixo.
const INTENT_TO_CATEGORY: Record<string, Category> = {
  conversa: "conversa",
  consulta: "consulta",
  resumo: "resumo",
  analise: "analise",
  criacao_conteudo: "geral",
  imagem: "imagem",
  carrossel: "carrossel",
  tarefa_tecnica: "tarefa_tecnica",
  escrita_externa: "escrita_externa",
  acao_sensivel: "escrita_externa",
  fora_do_escopo: "geral",
};

export function categoryFromIntent(intent: string | null): Category | null {
  return intent ? (INTENT_TO_CATEGORY[intent] ?? null) : null;
}

function asComplexity(value: string | null): Complexity | null {
  return value === "simples" || value === "intermediaria" || value === "complexa" ? value : null;
}

function asRisk(value: string | null): Risk | null {
  return value === "baixo" || value === "moderado" || value === "alto" ? value : null;
}

export function pickClassification(rules: Classification, jev: JevResult | null, cfg: RoutingConfig): Classification {
  if (!cfg.jev.activeRouting || !jev) return rules;
  if ((jev.confianca ?? 0) < cfg.jev.minConfidence) return rules;
  const category = categoryFromIntent(jev.intencao);
  const complexity = asComplexity(jev.complexidade);
  const risk = asRisk(jev.risco);
  if (!category || !complexity || !risk) return rules;
  // Pedido que pode alterar algo externo nunca é decidido só pelo Jev.
  if (risk !== "baixo" || category === "escrita_externa") return rules;
  return { category, complexity, risk, source: "jev", confidence: jev.confianca, motivo: `Jev recomendou ${jev.intencao}` };
}
