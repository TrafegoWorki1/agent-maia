// Detecta divergência de esquema (drift): compara o Supabase real com o que as migrações do repositório produzem.
// SOMENTE LEITURA. Nunca altera o banco real. Não imprime segredos nem dados: só nomes e definições de estrutura.
//   pnpm db:drift            -> imprime o relatório e grava db-drift-report.md; sai com código 1 se houver divergência
import { writeFileSync } from "node:fs";
import { buildLocalDb } from "./local.ts";
import { remoteQuery } from "./remote.ts";
import { diffSnapshots, formatDiff, hasDrift, SNAPSHOT_SQL, type SnapshotRow } from "./snapshot.ts";

const local = await buildLocalDb();
try {
  const expected = await local.snapshot();
  const actual = await remoteQuery<SnapshotRow>(SNAPSHOT_SQL);
  const diff = diffSnapshots(expected, actual);
  const report = formatDiff(diff);
  writeFileSync("db-drift-report.md", report);
  console.log(`Migrações aplicadas no banco temporário: ${local.applied.length}`);
  console.log(`Objetos comparados: ${expected.length} (migrações) x ${actual.length} (banco real)`);
  console.log(report);
  process.exitCode = hasDrift(diff) ? 1 : 0;
} finally {
  await local.close();
}
