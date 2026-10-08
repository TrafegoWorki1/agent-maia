import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Carrega .env para process.env sem sobrescrever variáveis já definidas no ambiente.
export function loadLocalEnv(file = resolve(process.cwd(), ".env")): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined && value) process.env[key] = value;
  }
}
