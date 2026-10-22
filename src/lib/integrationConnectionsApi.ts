import { supabase } from "./supabaseBrowser";

export interface IntegrationConnection { connected: boolean; detail: string; accountCount?: number }
export interface IntegrationConnections { meta_ads: IntegrationConnection }

async function authHeaders(): Promise<Record<string, string>> {
  const session = await supabase?.auth.getSession();
  return { "Content-Type": "application/json", ...(session?.data.session ? { Authorization: `Bearer ${session.data.session.access_token}` } : {}) };
}

async function request(method: "GET" | "POST"): Promise<Record<string, unknown>> {
  const response = await fetch("/api/integration-connections", { method, cache: "no-store", headers: await authHeaders() });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Falha na conexão (HTTP ${response.status})`);
  return result;
}

export async function fetchIntegrationConnections(): Promise<IntegrationConnections> {
  const result = await request("GET");
  return result.connections as unknown as IntegrationConnections;
}

export async function testMetaConnection(): Promise<{ ok: boolean; accountCount: number; detail: string }> {
  const result = await request("POST");
  return { ok: result.ok === true, accountCount: Number(result.accountCount ?? 0), detail: String(result.detail ?? "") };
}
