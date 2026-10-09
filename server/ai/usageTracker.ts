import type { Db } from "../store.ts";

// Métricas por execução na tabela agent_runs. Quando o provedor não informa um valor, grava null (nunca inventa).
export interface RunMetrics {
  provider: string;
  model: string | null;
  categoria: string;
  complexidade: string;
  motivo: string;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  fallbackDe: string | null;
  erroClasse: string | null;
  tentativas: number;
}

export async function annotateRun(db: Db, runId: number, m: RunMetrics): Promise<void> {
  const { error } = await db
    .from("agent_runs")
    .update({
      provider: m.provider,
      model: m.model,
      categoria: m.categoria,
      complexidade: m.complexidade,
      motivo: m.motivo.slice(0, 300),
      tokens_in: m.tokensIn,
      tokens_out: m.tokensOut,
      duration_ms: m.durationMs,
      fallback_de: m.fallbackDe,
      erro_classe: m.erroClasse,
      tentativas: m.tentativas,
    })
    .eq("id", runId);
  if (error) console.error("[ai] não consegui gravar as métricas da execução:", error.message);
}

interface RunRow {
  provider: string | null;
  model: string | null;
  categoria: string | null;
  status: string;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  fallback_de: string | null;
  erro_classe: string | null;
  started_at: string;
}

function avg(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function sum(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

// Agrupa as execuções por provedor e modelo. Função pura, usada pelo painel e testada à parte.
export function summarizeRuns(rows: RunRow[]) {
  const groups = new Map<string, RunRow[]>();
  for (const r of rows) {
    const key = `${r.provider}|${r.model ?? "padrão"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const porModelo = [...groups.entries()].map(([key, list]) => {
    const [provider, model] = key.split("|");
    return {
      provider,
      model,
      execucoes: list.length,
      sucesso: Math.round((list.filter((r) => r.status === "ok").length / list.length) * 100),
      duracaoMediaMs: avg(list.map((r) => r.duration_ms)),
      tokensEntrada: sum(list.map((r) => r.tokens_in)),
      tokensSaida: sum(list.map((r) => r.tokens_out)),
      custoUsd: sum(list.map((r) => r.cost_usd)),
    };
  });
  const porCategoria: Record<string, number> = {};
  for (const r of rows) {
    const key = r.categoria ?? "sem categoria";
    porCategoria[key] = (porCategoria[key] ?? 0) + 1;
  }
  const comFallback = rows.filter((r) => r.fallback_de);
  return {
    total: rows.length,
    porModelo,
    porCategoria,
    taxaFallback: rows.length ? Math.round((comFallback.length / rows.length) * 100) : 0,
    fallbacks: comFallback.slice(0, 10).map((r) => ({ em: r.started_at, de: r.fallback_de, para: r.provider, motivo: r.erro_classe })),
  };
}

// Visão para o painel "Modelos e Roteamento": últimos 7 dias.
export async function modelsView(db: Db, now = new Date()): Promise<Record<string, unknown>> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const runs = await db
    .from("agent_runs")
    .select("provider, model, categoria, status, duration_ms, tokens_in, tokens_out, cost_usd, fallback_de, erro_classe, started_at")
    .gte("started_at", since)
    .not("provider", "is", null)
    .order("id", { ascending: false })
    .limit(500);
  if (runs.error) return { error: runs.error.message, total: 0, porModelo: [], porCategoria: {}, taxaFallback: 0, fallbacks: [], saude: [], imagensHoje: null };
  const health = await db.from("provider_health").select("provider, state, cooldown_until, last_error_class, consecutive_failures, updated_at");
  const img = await db.from("image_quota").select("dia, usadas").order("dia", { ascending: false }).limit(1);
  return { ...summarizeRuns((runs.data ?? []) as RunRow[]), saude: health.data ?? [], imagensHoje: (img.data ?? [])[0] ?? null };
}
