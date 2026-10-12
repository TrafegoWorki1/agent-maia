import { readFileSync } from "node:fs";

// Gera o SQL de carga do catálogo de integrações a partir de config/integrations-catalog.json.
// Uso: node scripts/db/catalog-sql.ts [evolution|zernio] > trecho.sql. Migração aplicada é imutável: mudou o JSON, gere uma NOVA migração.
interface Entry { slug: string; title: string; risk: string; status?: "active" | "paused"; method: string; body?: unknown; description: string }
interface EvolutionEntry extends Entry { path: string; query?: string }
interface ZernioEntry extends Entry { url: string }

const catalog = JSON.parse(readFileSync(new URL("../../config/integrations-catalog.json", import.meta.url), "utf8")) as { evolution: EvolutionEntry[]; zernio: ZernioEntry[] };
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const COLUMNS = "(slug, title, description, method, url_template, body_template, auth_style, auth_header, secret_ref, risk, status, required_permission, created_by, activated_at)";

export function evolutionUrl(entry: Pick<EvolutionEntry, "path" | "query">): string {
  return `{EVOLUTION_API_URL}${entry.path}/{EVOLUTION_INSTANCE}${entry.query ? `?${entry.query}` : ""}`;
}

function row(e: Entry, url: string, auth: string, header: string, secret: string): string {
  return `  (${q(e.slug)}, ${q(e.title)}, ${q(e.description)}, ${q(e.method)}, ${q(url)}, ${e.body ? `${q(JSON.stringify(e.body))}::jsonb` : "null"}, ${auth}, ${header}, ${q(secret)}, ${q(e.risk)}, ${q(e.status ?? "active")}, 'integracao.usar', 'owner', ${e.status === "paused" ? "null" : "now()"})`;
}

export function evolutionRows(entries: EvolutionEntry[]): string {
  return entries.map((e) => row(e, evolutionUrl(e), "'apikey_header'", "'apikey'", "EVOLUTION_API_KEY")).join(",\n");
}

// Zernio: chave ZERNIO_API_KEY em Authorization: Bearer; só vale para o endereço zernio.com.
export function zernioRows(entries: ZernioEntry[]): string {
  return entries.map((e) => row(e, e.url, "'bearer'", "null", "ZERNIO_API_KEY")).join(",\n");
}

if (process.argv[1]?.endsWith("catalog-sql.ts")) {
  const section = process.argv[2] === "zernio" ? "zernio" : "evolution";
  const rows = section === "zernio" ? zernioRows(catalog.zernio) : evolutionRows(catalog.evolution);
  console.log(`insert into public.maia_integrations ${COLUMNS} values\n${rows}\non conflict (slug) do nothing;`);
}
