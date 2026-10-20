import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { supabaseFromEnv } from "./supabaseClient.ts";

// Referências de arte guardadas no Supabase Storage (bucket arte-referencias).
// O worker baixa para um temp local antes de passar ao Codex e apaga depois.

const BUCKET = "arte-referencias";
const TEMP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "arte", "temp-refs");
const NAME_RE = /^[A-Za-z0-9._-]{1,120}$/;

export function isValidRefName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function uploadReference(name: string, data: Buffer, mimetype: string): Promise<void> {
  if (!isValidRefName(name)) throw new Error(`Nome de referência inválido: ${name}`);
  const client = supabaseFromEnv();
  const { error } = await client.storage.from(BUCKET).upload(name, data, { contentType: mimetype, upsert: true });
  if (error) throw new Error(`Upload de referência falhou: ${error.message}`);
}

export async function listReferences(): Promise<string[]> {
  const client = supabaseFromEnv();
  const { data, error } = await client.storage.from(BUCKET).list();
  if (error) throw new Error(`Não foi possível listar referências: ${error.message}`);
  return (data ?? []).map((f) => f.name).filter((n) => isValidRefName(n));
}

export async function deleteReference(name: string): Promise<void> {
  if (!isValidRefName(name)) throw new Error(`Nome de referência inválido: ${name}`);
  const client = supabaseFromEnv();
  const { error } = await client.storage.from(BUCKET).remove([name]);
  if (error) throw new Error(`Não foi possível apagar a referência: ${error.message}`);
}

// Baixa uma referência do Storage para um arquivo temporário e retorna o caminho local.
// O chamador é responsável por chamar cleanupTempRefs() com o caminho retornado.
export async function downloadReferenceToTemp(name: string, jobKey: string): Promise<string> {
  if (!isValidRefName(name)) throw new Error(`Nome de referência inválido: ${name}`);
  const client = supabaseFromEnv();
  const { data, error } = await client.storage.from(BUCKET).download(name);
  if (error) throw new Error(`Não foi possível baixar a referência "${name}": ${error.message}`);
  mkdirSync(TEMP_DIR, { recursive: true });
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  const tempPath = join(TEMP_DIR, `${jobKey}-${randomBytes(4).toString("hex")}${ext}`);
  writeFileSync(tempPath, Buffer.from(await data.arrayBuffer()));
  return tempPath;
}

export function cleanupTempRefs(paths: string[]): void {
  for (const p of paths) {
    try { if (existsSync(p)) unlinkSync(p); } catch { /* ignora falhas de limpeza */ }
  }
}
