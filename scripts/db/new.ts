// Cria uma migração nova com a versão (data e hora UTC) no padrão do Supabase CLI.
//   pnpm db:new nome_em_snake_case
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "./local.ts";

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error("Uso: pnpm db:new nome_em_snake_case");
  process.exit(1);
}
const version = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const file = join(MIGRATIONS_DIR, `${version}_${name}.sql`);
if (existsSync(file)) {
  console.error("A migração já existe.");
  process.exit(1);
}
writeFileSync(
  file,
  `-- ${name}
-- O que muda e por quê:
-- Código que depende desta migração:
-- Rollback (nova migração que desfaz, nunca edição desta):
-- Se houver comando destrutivo, inclua a linha: -- destrutivo-aprovado: <quem aprovou e por quê>

`,
);
console.log(`Criada: supabase/migrations/${version}_${name}.sql`);
console.log("Depois: pnpm db:validate && pnpm test. Atualize o CHANGELOG.md no mesmo PR.");
