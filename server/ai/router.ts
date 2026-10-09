import { claudeTierFor, codexCanTake } from "./capabilities.ts";
import { isRoutable } from "./providerHealth.ts";
import type { BlockedRoute, Classification, HealthRecord, RouteDecision, RoutingConfig } from "./types.ts";

// Decide quem executa. Função pura: recebe a classificação, o estado dos provedores e a configuração.
// A decisão é de ROTEAMENTO, não de autorização: permissões e aprovações são checadas depois, no executor.
export function route(input: { classification: Classification; claude: HealthRecord; codex: HealthRecord; cfg: RoutingConfig; now: number }): RouteDecision | BlockedRoute {
  const { classification, claude, codex, cfg, now } = input;
  const { category, complexity } = classification;

  if (category === "carrossel") {
    return { blocked: true, motivo: "A criação de carrossel ainda não está disponível. Posso criar uma arte avulsa." };
  }

  if (category === "imagem") {
    if (!cfg.providers.codex.enabled || !isRoutable(codex, now)) return { blocked: true, motivo: "O criador de artes está indisponível agora." };
    return { provider: "codex", tier: "principal", model: cfg.providers.codex.model, category, complexity, direct: "imagem", motivo: "arte vai direto ao executor criativo" };
  }

  const tier = claudeTierFor(category, complexity);
  const model = tier === "economico" ? cfg.providers.claude.models.economico : cfg.providers.claude.models.principal;
  if (cfg.providers.claude.enabled && isRoutable(claude, now)) {
    return { provider: "claude", tier, model, category, complexity, direct: null, motivo: `${classification.motivo}; modelo ${tier}` };
  }

  const canFallback = cfg.fallback.enabled && cfg.fallback.categories.includes(category) && codexCanTake(category) && cfg.providers.codex.enabled && isRoutable(codex, now);
  if (canFallback) {
    return { provider: "codex", tier: "principal", model: cfg.providers.codex.model, category, complexity, direct: null, motivo: "Claude indisponível; tarefa de texto compatível com o Codex" };
  }
  const until = claude.cooldownUntil ? ` até ${claude.cooldownUntil.slice(11, 16)} UTC` : "";
  return { blocked: true, motivo: `O Claude está indisponível${until} e este pedido precisa dele (conectores ou aprovação). Peça de novo depois desse horário.` };
}
