// Estruturas de banco que o CÓDIGO usa (tabelas em .from("x") e funções em .rpc("x")). Serve para barrar a
// "migração ausente": se o código passa a usar uma tabela ou função que nenhuma migração cria, a validação falha.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAN_DIRS = ["server", "api", "src", "scripts"];
const SCAN_FILES = ["vite.config.ts"];
const SKIP = new Set(["node_modules", "dist", ".git"]);

export interface Usage {
  tables: Map<string, string[]>; // nome -> arquivos
  rpcs: Map<string, string[]>;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

export function scanSource(text: string): { tables: string[]; rpcs: string[] } {
  const tables = [...text.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)].map((m) => m[1]);
  const rpcs = [...text.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)].map((m) => m[1]);
  return { tables, rpcs };
}

export function scanUsage(root = ROOT): Usage {
  const files: string[] = [];
  for (const d of SCAN_DIRS) {
    try {
      walk(join(root, d), files);
    } catch {
      // pasta inexistente
    }
  }
  for (const f of SCAN_FILES) files.push(join(root, f));
  const usage: Usage = { tables: new Map(), rpcs: new Map() };
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Os scripts de banco citam nomes de exemplo; não contam como uso real.
    const rel = relative(root, file).split("\\").join("/");
    if (rel.startsWith("scripts/db/")) continue;
    const found = scanSource(text);
    for (const t of found.tables) usage.tables.set(t, [...(usage.tables.get(t) ?? []), rel]);
    for (const r of found.rpcs) usage.rpcs.set(r, [...(usage.rpcs.get(r) ?? []), rel]);
  }
  return usage;
}

// Compara o uso do código com o esquema produzido pelas migrações. Devolve os problemas encontrados.
export function missingStructures(usage: Usage, tables: Set<string>, functions: Set<string>): string[] {
  const problems: string[] = [];
  for (const [name, files] of usage.tables) {
    if (!tables.has(name)) problems.push(`tabela "${name}" usada em ${[...new Set(files)].join(", ")} mas nenhuma migração a cria`);
  }
  for (const [name, files] of usage.rpcs) {
    if (!functions.has(name)) problems.push(`função "${name}" chamada em ${[...new Set(files)].join(", ")} mas nenhuma migração a cria`);
  }
  return problems;
}
