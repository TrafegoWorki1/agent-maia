// Executa os testes de banco (node --test). Se o processo cair ao iniciar por falta de memória (o PGlite carrega o
// Postgres em WebAssembly e, com pouca RAM livre, o Windows às vezes o derruba), tenta uma segunda vez.
// Falha de verdade (asserção) falha de novo na segunda tentativa, então nada é escondido.
import { spawnSync } from "node:child_process";

const args = ["--test", "tests/db/migrations.nodetest.ts"];
for (let attempt = 1; attempt <= 2; attempt += 1) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status === 0) process.exit(0);
  if (attempt === 1) console.error("\nOs testes de banco falharam; tentando mais uma vez (pode ter sido falta de memória ao iniciar o PGlite)...\n");
}
process.exit(1);
