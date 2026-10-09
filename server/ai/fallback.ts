import { codexCanTake } from "./capabilities.ts";
import type { Category, EffectState, RoutingConfig } from "./types.ts";

// Política de fallback Claude → Codex. Só repete a tarefa quando é seguro: nenhum efeito externo iniciado,
// erro de provedor confirmado (limite, indisponibilidade ou timeout) e categoria compatível com o Codex.
export function effectFromTools(toolCategories: string[]): EffectState {
  if (toolCategories.includes("escrita")) return "external_effect_started";
  if (toolCategories.includes("arte")) return "local_creation";
  return "read_only";
}

export interface FallbackInput {
  fallbackAllowed: boolean;
  errorKind: string;
  category: Category;
  effect: EffectState;
  codexRoutable: boolean;
  cfg: RoutingConfig;
}

export function decideFallback(input: FallbackInput): { allowed: boolean; reason: string } {
  const { cfg } = input;
  if (!cfg.fallback.enabled) return { allowed: false, reason: "fallback desligado na configuração" };
  if (!input.fallbackAllowed) return { allowed: false, reason: `erro "${input.errorKind}" não permite trocar de provedor` };
  if (input.effect !== "read_only") return { allowed: false, reason: `efeito anterior (${input.effect}): não repete sem reconciliação` };
  if (!cfg.fallback.categories.includes(input.category) || !codexCanTake(input.category)) return { allowed: false, reason: `categoria "${input.category}" não é compatível com o Codex` };
  if (!cfg.providers.codex.enabled || !input.codexRoutable) return { allowed: false, reason: "Codex indisponível" };
  return { allowed: true, reason: "erro de provedor, sem efeito externo, categoria compatível" };
}
