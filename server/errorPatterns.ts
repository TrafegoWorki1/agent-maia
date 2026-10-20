import type { Db } from "./store.ts";

export interface ErrorPattern {
  id: string;
  created_at: string;
  codigo: string;
  descricao: string;
  regra_prevencao: string;
  aprovado_em: string | null;
  ativa: boolean;
  incident_id: string | null;
}

const CACHE_MS = 60_000;
let cache: { at: number; patterns: ErrorPattern[] } | null = null;

export async function loadActivePatterns(db: Db, now = Date.now()): Promise<ErrorPattern[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.patterns;
  const { data, error } = await db.from("maia_error_patterns").select("*").eq("ativa", true).order("created_at", { ascending: true });
  if (error) throw new Error(`error_patterns: ${error.message}`);
  cache = { at: now, patterns: (data ?? []) as ErrorPattern[] };
  return cache.patterns;
}

export function invalidatePatternsCache(): void {
  cache = null;
}

export async function proposePattern(
  db: Db,
  codigo: string,
  descricao: string,
  regraPrevencao: string,
  incidentId?: string,
): Promise<string> {
  const { data, error } = await db
    .from("maia_error_patterns")
    .insert({ codigo, descricao, regra_prevencao: regraPrevencao, ativa: false, incident_id: incidentId ?? null })
    .select("id")
    .single();
  if (error) throw new Error(`error_patterns: ${error.message}`);
  return (data as { id: string }).id;
}

export async function approvePattern(db: Db, codigo: string): Promise<void> {
  const { error } = await db
    .from("maia_error_patterns")
    .update({ ativa: true, aprovado_em: new Date().toISOString() })
    .eq("codigo", codigo);
  if (error) throw new Error(`error_patterns: ${error.message}`);
  invalidatePatternsCache();
}
