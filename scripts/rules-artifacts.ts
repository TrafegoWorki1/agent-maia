import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderRulesDocument } from "../server/ruleCatalog.ts";

const target = fileURLToPath(new URL("../docs/regras-da-maia.md", import.meta.url));
const expected = renderRulesDocument();
if (process.argv.includes("--write")) {
  writeFileSync(target, expected, "utf8");
  console.log("Documento de regras gerado a partir do catálogo aprovado.");
} else if (readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== expected) {
  console.error("Documento diverge do catálogo. Execute pnpm rules:generate e revise a diferença.");
  process.exitCode = 1;
} else console.log("OK: documento e catálogo correspondem.");
