import { createHash } from "node:crypto";
import catalog from "../config/maia-rules.json" with { type: "json" };

export interface MaiaRule {
  codigo: string;
  categoria: string;
  titulo: string;
  texto: string;
  ordem: number;
  ativa: boolean;
}

export function validateRules(input: unknown): MaiaRule[] {
  if (!Array.isArray(input)) throw new Error("regras: lista inválida");
  const codes = new Set<string>();
  const rules = input.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("regras: item inválido");
    const r = value as Record<string, unknown>;
    for (const key of ["codigo", "categoria", "titulo", "texto"]) {
      if (typeof r[key] !== "string" || !r[key].trim()) throw new Error(`regras: campo ${key} inválido`);
    }
    if (!Number.isInteger(r.ordem) || typeof r.ativa !== "boolean" || !/^[a-z][a-z0-9_]*$/.test(r.codigo as string)) throw new Error("regras: ordem, estado ou código inválido");
    if (codes.has(r.codigo as string)) throw new Error("regras: código duplicado");
    codes.add(r.codigo as string);
    return { codigo: r.codigo, categoria: r.categoria, titulo: r.titulo, texto: r.texto, ordem: r.ordem, ativa: r.ativa } as MaiaRule;
  });
  return rules.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
}

export const RULE_CATALOG_VERSION = catalog.version;
export const RULE_CATALOG: readonly MaiaRule[] = Object.freeze(validateRules(catalog.rules).map((r) => Object.freeze(r)));

export function rulesChecksum(rules: readonly MaiaRule[]): string {
  return createHash("sha256").update(JSON.stringify(validateRules(rules))).digest("hex");
}

export function formatRules(rules: readonly MaiaRule[]): string {
  return validateRules(rules).filter((r) => r.ativa).map((r) => `## ${r.categoria} — ${r.titulo} [${r.codigo}]\n\n${r.texto}`).join("\n\n");
}

export function renderRulesDocument(): string {
  return [
    "# Regras vigentes da Maia",
    `Versão aprovada: ${RULE_CATALOG_VERSION}. Impressão digital: ${rulesChecksum(RULE_CATALOG)}.`,
    "Documento gerado de config/maia-rules.json. Atualize o catálogo e regenere com pnpm rules:generate; não edite esta cópia manualmente. A ativação é explícita na tabela maia_rules e deve ser conferida com pnpm rules:verify. O documento descreve a versão aprovada; divergência no banco é uma pendência, não uma atualização automática.",
    "As ferramentas aplicam as permissões em server/access.ts, server/approvalPolicy.ts e nos fluxos específicos. Documento, prompt, proposta ou histórico não concedem acesso. Conectores dependem do executor, do canal e da conexão disponível. O chat do painel mantém o seu bloqueio de escrita.",
    "A base documental ativa contém este documento. Histórico de mudanças e planos ficam fora da busca operacional. Conversas, mídias recebidas e dados de clientes não entram nessa base.",
    formatRules(RULE_CATALOG),
    "",
  ].join("\n\n").trimEnd() + "\n";
}
