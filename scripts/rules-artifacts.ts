import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatRules, renderRulesDocument, RULE_CATALOG, RULE_CATALOG_VERSION } from "../server/ruleCatalog.ts";
import routing from "../config/ai-routing.json" with { type: "json" };

const human = [
  "# Mapa operacional das regras da Maia",
  `Documento humano derivado de \`config/maia-rules.json\` (versão ${RULE_CATALOG_VERSION}). Não é uma segunda fonte normativa.`,
  `O limite geral vigente é de **${routing.execution.maxSteps} passos observáveis**, definido somente em \`config/ai-routing.json\`. Claude usa esse valor como turnos; o SDK do Codex não oferece limite nativo de turnos e por isso a Maia o aplica às chamadas MCP observáveis.`,
  "## Como ler",
  "Identidade e permissões são confirmadas no servidor. Mensagens, memórias, documentos e resumos nunca concedem acesso. Aprovações são pontuais, expiram e não alteram permissões permanentes.",
  "## Índice",
  ...RULE_CATALOG.filter((rule) => rule.ativa).map((rule) => `- ${rule.ordem}. **${rule.categoria} — ${rule.titulo}** (\`${rule.codigo}\`)`),
  "",
].join("\n\n");
const finalSections = [
  "# Regras de comportamento — seções 11 a 17",
  `Recorte gerado do catálogo normativo, versão ${RULE_CATALOG_VERSION}. Não edite manualmente.`,
  formatRules(RULE_CATALOG.filter((rule) => rule.ordem >= 11 && rule.ordem <= 17)),
  "",
].join("\n\n");
const artifacts = new Map([
  [fileURLToPath(new URL("../docs/regras-da-maia.md", import.meta.url)), renderRulesDocument()],
  [fileURLToPath(new URL("../docs/regras-comportamento-maia.md", import.meta.url)), human],
  [fileURLToPath(new URL("../docs/regras-comportamento-maia-secoes-11-17.md", import.meta.url)), finalSections],
]);
if (process.argv.includes("--write")) {
  for (const [target, expected] of artifacts) writeFileSync(target, expected, "utf8");
  console.log("Documentos de regras gerados a partir do catálogo aprovado.");
} else {
  for (const [target, expected] of artifacts) {
    if (!existsSync(target) || readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== expected) {
      console.error(`Documento diverge do catálogo: ${target}. Execute pnpm rules:generate e revise a diferença.`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log("OK: documentos e catálogo correspondem.");
}
