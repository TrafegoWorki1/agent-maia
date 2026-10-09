// Guarda de PR para migrações. Compara com a branch base (BASE_REF, padrão origin/main) e falha se:
//   - uma migração que já existia na base foi alterada, renomeada ou apagada (migrações aplicadas são imutáveis);
//   - uma migração nova tem comando destrutivo sem a marcação "-- destrutivo-aprovado: <quem e por quê>";
//   - há migração nova mas o CHANGELOG.md não foi atualizado.
//   pnpm db:guard
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BASELINE_LAST_VERSION, findDestructive, hasApprovalMark, MIGRATION_NAME } from "./rules.ts";

const base = process.env.BASE_REF ?? "origin/main";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

let diff: string;
try {
  diff = git("diff", "--name-status", "--no-renames", `${base}...HEAD`);
} catch {
  console.log(`Sem base de comparação (${base}); guarda ignorada.`);
  process.exit(0);
}

const problems: string[] = [];
const added: string[] = [];
let changelog = false;
for (const line of diff.split("\n").filter(Boolean)) {
  const [status, file] = line.split("\t");
  if (file === "CHANGELOG.md") changelog = true;
  if (!file?.startsWith("supabase/migrations/") || !file.endsWith(".sql")) continue;
  const base = file.split("/").pop() ?? "";
  // Arquivos antigos sem versão no nome (anteriores à baseline) podem ser trocados pela versão com prefixo, uma única vez.
  if (status === "D" && !MIGRATION_NAME.test(base)) continue;
  if (status === "A" && base.slice(0, 14) <= BASELINE_LAST_VERSION) continue; // baseline histórica
  if (status === "A") added.push(file);
  else problems.push(`${file}: migração já existente foi ${status === "D" ? "apagada" : "alterada"}. Migrações aplicadas são imutáveis; crie uma NOVA migração.`);
}

for (const file of added) {
  const sql = readFileSync(file, "utf8");
  const destructive = findDestructive(sql);
  if (destructive.length > 0 && !hasApprovalMark(sql)) {
    problems.push(`${file}: comando destrutivo (${destructive.join(", ")}) sem a marcação "-- destrutivo-aprovado: <quem aprovou e por quê>". Exige aprovação explícita do owner.`);
  }
}
if (added.length > 0 && !changelog) problems.push("há migração nova, mas o CHANGELOG.md não foi atualizado neste PR.");

if (problems.length > 0) {
  console.error("FALHOU:");
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
console.log(`OK: ${added.length} migração(ões) nova(s), nenhuma migração existente alterada.`);
