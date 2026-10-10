import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestDocument } from "./knowledge.ts";
import { kvGet, kvSet, type Db } from "./store.ts";
import { KNOWLEDGE_DOCS, RETIRED_KNOWLEDGE_SLUGS } from "./knowledgePolicy.ts";
import { RULE_CATALOG, renderRulesDocument, rulesChecksum } from "./ruleCatalog.ts";
import { listRules } from "./rules.ts";
export { KNOWLEDGE_DOCS } from "./knowledgePolicy.ts";

// Atualização automática da base de conhecimento. Lê os documentos aprovados e reindexa só o que mudou
// (a comparação é pelo conteúdo). Roda ao iniciar e depois a cada hora, no webhook local e no worker.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SYNC_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 50 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
const LAST_KEY = "knowledge:last_sync";

export interface SyncResult {
  novos: number;
  atualizados: number;
  semMudanca: number;
  erros: string[];
}

export async function syncKnowledge(db: Db, now = new Date()): Promise<SyncResult> {
  const result: SyncResult = { novos: 0, atualizados: 0, semMudanca: 0, erros: [] };
  if (rulesChecksum(await listRules(db)) !== rulesChecksum(RULE_CATALOG)) {
    result.erros.push("regras ativas divergem do catálogo; sincronização suspensa até revisão");
    return result;
  }
  for (const doc of KNOWLEDGE_DOCS) {
    const path = resolve(ROOT, doc.file);
    if (!existsSync(path)) {
      result.erros.push(`${doc.slug}: arquivo não encontrado`);
      continue;
    }
    try {
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      if (text !== renderRulesDocument()) throw new Error("documento diverge do catálogo; execute rules:generate");
      const outcome = await ingestDocument(db, { slug: doc.slug, titulo: doc.titulo, origem: doc.origem, text });
      if (outcome === "novo") result.novos += 1;
      else if (outcome === "atualizado") result.atualizados += 1;
      else result.semMudanca += 1;
    } catch (error) {
      result.erros.push(`${doc.slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (result.erros.length === 0) {
    // Retirar da lista não desativa o que já está indexado. Preservamos os trechos para reversão.
    const retired = await db.from("knowledge_sources").update({ ativo: false }).in("slug", [...RETIRED_KNOWLEDGE_SLUGS]).eq("ativo", true);
    if (retired.error) result.erros.push(`desativar fontes históricas: ${retired.error.message}`);
  }
  if (result.erros.length === 0) await kvSet(db, LAST_KEY, now.toISOString(), now);
  return result;
}

// Agenda a sincronização. Se outro processo sincronizou há pouco, pula (evita trabalho duplicado).
export function startKnowledgeSync(db: Db): void {
  const run = async () => {
    try {
      const last = await kvGet(db, LAST_KEY);
      if (last && Date.now() - Date.parse(last) < MIN_GAP_MS) return;
      const result = await syncKnowledge(db);
      const mudou = result.novos + result.atualizados;
      if (mudou > 0 || result.erros.length > 0) {
        console.log(`[base] novos ${result.novos}, atualizados ${result.atualizados}, sem mudança ${result.semMudanca}${result.erros.length ? `, erros: ${result.erros.join("; ")}` : ""}`);
      }
    } catch (error) {
      console.error("[base] falha na sincronização:", error instanceof Error ? error.message : error);
    }
  };
  setTimeout(() => void run(), FIRST_RUN_MS).unref();
  setInterval(() => void run(), SYNC_MS).unref();
}
