import type { Category, RouteDecision, RoutingConfig } from "../types.ts";

// Parâmetros do Claude escolhidos pelo roteador. O modelo vem da configuração: null usa o padrão do SDK.
export function claudeModelFor(decision: RouteDecision): string | undefined {
  return decision.model ?? undefined;
}

export function budgetFor(category: Category, cfg: RoutingConfig): number {
  return cfg.budgetUsd[category] ?? cfg.budgetUsd.geral ?? 1;
}
