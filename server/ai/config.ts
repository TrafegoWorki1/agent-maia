import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RoutingConfig } from "./types.ts";

// Configuração do roteador: config/ai-routing.json por cima dos valores padrão abaixo.
// Se o arquivo faltar ou estiver quebrado, a Maia segue com os padrões e registra o aviso.
export const DEFAULT_CONFIG: RoutingConfig = {
  providers: { claude: { enabled: true, models: { economico: "haiku", principal: null } }, codex: { enabled: true, model: null } },
  budgetUsd: { conversa: 0.25, resumo: 0.25, consulta: 0.5, analise: 1, geral: 1 },
  timeoutMs: { claude: 300_000, codex: 120_000 },
  concurrency: { claude: 1, codex: 1 },
  health: { cooldownMs: 15 * 60 * 1000, degradedAfter: 2, unavailableAfter: 5 },
  fallback: { enabled: true, categories: ["conversa", "resumo"] },
  jev: { activeRouting: false, minConfidence: 0.8 },
  images: { dailyLimit: 10 },
};

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../config/ai-routing.json");
let cached: RoutingConfig | null = null;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Mescla seção por seção: a configuração só substitui o que está nela.
export function mergeConfig(base: RoutingConfig, override: unknown): RoutingConfig {
  if (!isObject(override)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    out[key] = isObject(current) && isObject(value) ? mergeConfig(current as never, value) : value;
  }
  return out as unknown as RoutingConfig;
}

export function loadRoutingConfig(force = false): RoutingConfig {
  if (cached && !force) return cached;
  try {
    if (existsSync(FILE)) cached = mergeConfig(DEFAULT_CONFIG, JSON.parse(readFileSync(FILE, "utf8")));
    else cached = DEFAULT_CONFIG;
  } catch (error) {
    console.error("[ai] config/ai-routing.json inválido, usando os padrões:", error instanceof Error ? error.message : error);
    cached = DEFAULT_CONFIG;
  }
  return cached;
}
