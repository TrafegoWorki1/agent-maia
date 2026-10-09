// Consulta SOMENTE LEITURA ao Postgres do Supabase pela Management API. Usada para detectar divergência de esquema.
// Nunca grava: recusa qualquer SQL que não seja SELECT/WITH e usa a opção read_only da API.
// O token vem do ambiente (SUPABASE_ACCESS_TOKEN) e nunca é impresso.
import { loadLocalEnv } from "../../server/loadEnv.ts";

export function projectRef(): string {
  loadLocalEnv();
  const ref = process.env.SUPABASE_PROJECT_REF ?? /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL ?? "")?.[1];
  if (!ref) throw new Error("Defina SUPABASE_PROJECT_REF (ou SUPABASE_URL).");
  return ref;
}

export function assertReadOnly(sql: string): void {
  // Tira comentários e textos entre aspas antes de procurar palavras de escrita.
  const text = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").trim();
  if (!/^(select|with)\b/i.test(text)) throw new Error("Somente SELECT/WITH é permitido neste script.");
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i.test(text)) throw new Error("O SQL contém comando de escrita.");
  if (text.replace(/;\s*$/, "").includes(";")) throw new Error("Apenas uma instrução por consulta.");
}

export async function remoteQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  assertReadOnly(sql);
  loadLocalEnv();
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKKEN;
  if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Management API respondeu HTTP ${response.status}`);
  return (await response.json()) as T[];
}
