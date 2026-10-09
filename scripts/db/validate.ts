// Valida o banco do projeto SEM tocar em nenhum banco remoto:
//   1. nomes e ordem das migrações;
//   2. aplica TODAS as migrações em um Postgres temporário (PGlite) e acusa erro de SQL ou dependência ausente;
//   3. confere estruturas essenciais (tabelas, funções RPC, constraints, RLS, políticas);
//   4. confere que toda tabela e função usada pelo código existe nas migrações (barra a "migração ausente").
//   pnpm db:validate
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLocalDb, listMigrations, MIGRATIONS_DIR } from "./local.ts";
import { checkEssentials, checkNames } from "./rules.ts";
import { missingStructures, scanUsage } from "./usage.ts";

const problems: string[] = [];
const files = listMigrations();
problems.push(...checkNames(files));
if (files.length === 0) problems.push("nenhuma migração encontrada em supabase/migrations");

let applied = 0;
try {
  const local = await buildLocalDb();
  applied = local.applied.length;
  const rows = await local.snapshot();
  await local.close();
  problems.push(...checkEssentials(rows));
  const tables = new Set(rows.filter((r) => r.kind === "tabela").map((r) => r.name));
  const functions = new Set(rows.filter((r) => r.kind === "funcao").map((r) => r.name.split("(")[0]));
  problems.push(...missingStructures(scanUsage(), tables, functions));
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
}

// Segredos nunca entram em migração.
for (const f of files) {
  const text = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  if (/eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|mcp_[a-f0-9]{32,}|service_role_key\s*=/i.test(text)) problems.push(`${f}: parece conter segredo`);
}

console.log(`Migrações: ${files.length} | aplicadas no banco temporário: ${applied}`);
if (problems.length > 0) {
  console.error("\nFALHOU:");
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log("OK: migrações aplicam do zero, estruturas essenciais presentes e o código só usa o que as migrações criam.");
