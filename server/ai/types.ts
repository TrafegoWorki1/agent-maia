// Tipos do roteador multi-IA. A Maia é uma só: o modelo muda, as regras e as permissões não.

export type ProviderId = "claude" | "codex";
export type Category = "conversa" | "consulta" | "resumo" | "analise" | "imagem" | "carrossel" | "tarefa_tecnica" | "escrita_externa" | "geral";
export type Complexity = "simples" | "intermediaria" | "complexa";
export type Risk = "baixo" | "moderado" | "alto";
export type ModelTier = "economico" | "principal";
export type ProviderState = "healthy" | "degraded" | "cooldown" | "unavailable" | "recovering";
export type ErrorKind = "rate_limit" | "quota" | "unavailable" | "timeout" | "auth" | "permission" | "tool_missing" | "budget" | "max_turns" | "unknown";

// Estado dos efeitos externos de uma execução que falhou. Só "read_only" permite repetir em outro provedor.
export type EffectState = "read_only" | "local_creation" | "write_requires_approval" | "external_effect_started" | "uncertain";

export interface Classification {
  category: Category;
  complexity: Complexity;
  risk: Risk;
  source: "regras" | "jev";
  confidence: number | null;
  motivo: string;
}

export interface RouteDecision {
  provider: ProviderId;
  tier: ModelTier;
  model: string | null;
  category: Category;
  complexity: Complexity;
  motivo: string;
  // "imagem": o pedido vai direto ao executor criativo, sem chamar o Claude.
  direct: "imagem" | null;
}

export interface BlockedRoute {
  blocked: true;
  motivo: string;
}

export interface HealthRecord {
  provider: ProviderId;
  state: ProviderState;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  lastError: string | null;
  lastErrorClass: ErrorKind | null;
}

export interface RoutingConfig {
  providers: { claude: { enabled: boolean; models: { economico: string | null; principal: string | null } }; codex: { enabled: boolean; model: string | null } };
  budgetUsd: Record<string, number>;
  timeoutMs: Record<ProviderId, number>;
  concurrency: Record<ProviderId, number>;
  health: { cooldownMs: number; degradedAfter: number; unavailableAfter: number };
  fallback: { enabled: boolean; categories: Category[] };
  jev: { activeRouting: boolean; minConfidence: number };
  images: { dailyLimit: number };
}
