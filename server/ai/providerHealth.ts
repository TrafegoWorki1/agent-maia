import type { Db } from "../store.ts";
import type { ErrorKind, HealthRecord, ProviderId, RoutingConfig } from "./types.ts";

// Circuit breaker por provedor. A lógica de transição é pura (testável); o estado fica na tabela provider_health,
// compartilhada entre o worker e o webhook. Só erros do PROVEDOR contam: erro de tarefa (permissão, orçamento) não.

export type HealthEvent = { type: "success" } | { type: "failure"; kind: ErrorKind; retryAfterMs: number | null; message: string } | { type: "tick" };

export function initialHealth(provider: ProviderId): HealthRecord {
  return { provider, state: "healthy", consecutiveFailures: 0, cooldownUntil: null, lastError: null, lastErrorClass: null };
}

export function applyEvent(rec: HealthRecord, event: HealthEvent, now: number, cfg: RoutingConfig["health"]): HealthRecord {
  if (event.type === "success") return { ...rec, state: "healthy", consecutiveFailures: 0, cooldownUntil: null };

  if (event.type === "tick") {
    const waiting = rec.state === "cooldown" || rec.state === "unavailable";
    if (waiting && rec.cooldownUntil && Date.parse(rec.cooldownUntil) <= now) return { ...rec, state: "recovering" };
    return rec;
  }

  const providerError = ["rate_limit", "quota", "unavailable", "timeout", "auth"].includes(event.kind);
  if (!providerError) return rec;
  const failures = rec.consecutiveFailures + 1;
  const base = { ...rec, consecutiveFailures: failures, lastError: event.message.slice(0, 200), lastErrorClass: event.kind };
  const until = new Date(now + (event.retryAfterMs ?? cfg.cooldownMs)).toISOString();
  if (event.kind === "rate_limit" || event.kind === "quota") return { ...base, state: "cooldown", cooldownUntil: until };
  if (event.kind === "auth") return { ...base, state: "unavailable", cooldownUntil: until };
  if (failures >= cfg.unavailableAfter) return { ...base, state: "unavailable", cooldownUntil: until };
  if (failures >= cfg.degradedAfter) return { ...base, state: "degraded" };
  return base;
}

// "recovering" deixa passar uma tentativa de verificação; cooldown e unavailable não recebem tráfego.
export function isRoutable(rec: HealthRecord, now: number): boolean {
  const current = applyEvent(rec, { type: "tick" }, now, { cooldownMs: 0, degradedAfter: 0, unavailableAfter: 0 });
  return current.state === "healthy" || current.state === "degraded" || current.state === "recovering";
}

export async function loadHealth(db: Db, provider: ProviderId): Promise<HealthRecord> {
  const { data, error } = await db.from("provider_health").select("*").eq("provider", provider).maybeSingle();
  if (error || !data) return initialHealth(provider);
  const row = data as { state: HealthRecord["state"]; consecutive_failures: number; cooldown_until: string | null; last_error: string | null; last_error_class: ErrorKind | null };
  return { provider, state: row.state, consecutiveFailures: row.consecutive_failures, cooldownUntil: row.cooldown_until, lastError: row.last_error, lastErrorClass: row.last_error_class };
}

export async function saveHealth(db: Db, rec: HealthRecord): Promise<void> {
  const { error } = await db.from("provider_health").upsert(
    {
      provider: rec.provider,
      state: rec.state,
      consecutive_failures: rec.consecutiveFailures,
      cooldown_until: rec.cooldownUntil,
      last_error: rec.lastError,
      last_error_class: rec.lastErrorClass,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) console.error("[ai] não consegui gravar o estado do provedor:", error.message);
}

// Registra um resultado e devolve o novo estado.
export async function recordProviderEvent(db: Db, provider: ProviderId, event: HealthEvent, cfg: RoutingConfig["health"], now = Date.now()): Promise<HealthRecord> {
  const current = await loadHealth(db, provider);
  const next = applyEvent(current, event, now, cfg);
  if (JSON.stringify(next) !== JSON.stringify(current)) await saveHealth(db, next);
  return next;
}
