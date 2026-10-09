import { createHash } from "node:crypto";
import type { Db } from "./store.ts";

// Base de conhecimento da Maia (RAG). Documentos aprovados viram trechos com vetor (gte-small, dentro do Supabase).
// A busca combina vetor e palavra-chave em português, e aplica o filtro de "ativo" no banco.
// Só entram documentos escolhidos por você. Mensagens de conversa e de grupos não entram aqui.

export interface Chunk {
  secao: string;
  conteudo: string;
}

// Divide o Markdown por títulos e parágrafos. Cada trecho guarda a seção de onde veio.
export function chunkMarkdown(text: string, maxChars = 900): Chunk[] {
  const chunks: Chunk[] = [];
  let secao = "Início";
  let buffer = "";
  const flush = () => {
    const conteudo = buffer.trim();
    if (conteudo) chunks.push({ secao, conteudo });
    buffer = "";
  };
  for (const block of text.split(/\n\s*\n/)) {
    const heading = block.match(/^#{1,6}\s+(.+)$/m);
    if (heading && block.trimStart().startsWith("#")) {
      flush();
      secao = heading[1].trim();
      const rest = block.replace(/^#{1,6}\s+.+$/m, "").trim();
      if (rest) buffer = rest;
      continue;
    }
    for (const piece of splitLong(block.trim(), maxChars)) {
      if (!piece) continue;
      if (buffer && buffer.length + piece.length + 2 > maxChars) flush();
      buffer = buffer ? `${buffer}\n\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}

// Parágrafo maior que o limite é cortado nos espaços, para nenhum trecho passar do tamanho.
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current && current.length + word.length + 1 > maxChars) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Vetor de um texto (384 dimensões), gerado pela função embed do Supabase.
export async function embedText(text: string): Promise<number[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado no .env");
  const response = await fetch(`${url}/functions/v1/embed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`embed HTTP ${response.status}`);
  const body = (await response.json()) as { embedding?: number[] };
  if (!body.embedding || body.embedding.length !== 384) throw new Error("embed: vetor com tamanho inesperado");
  return body.embedding;
}

// Indexa um documento. Se o conteúdo não mudou (mesmo checksum), não faz nada.
export async function ingestDocument(db: Db, doc: { slug: string; titulo: string; origem: string; text: string }): Promise<"novo" | "atualizado" | "sem_mudanca"> {
  const checksum = createHash("sha256").update(doc.text).digest("hex");
  const existing = await db.from("knowledge_sources").select("id, checksum").eq("slug", doc.slug).maybeSingle();
  if (existing.error) throw new Error(`knowledge_sources: ${existing.error.message}`);
  if (existing.data && existing.data.checksum === checksum) return "sem_mudanca";

  const source = await db
    .from("knowledge_sources")
    .upsert({ slug: doc.slug, titulo: doc.titulo, origem: doc.origem, checksum, ativo: true, indexed_at: new Date().toISOString() }, { onConflict: "slug" })
    .select("id")
    .single();
  if (source.error) throw new Error(`knowledge_sources: ${source.error.message}`);
  const sourceId = (source.data as { id: number }).id;

  const chunks = chunkMarkdown(doc.text);
  const del = await db.from("knowledge_chunks").delete().eq("source_id", sourceId);
  if (del.error) throw new Error(`limpar trechos antigos: ${del.error.message}`);
  const rows = [];
  for (const [ordem, chunk] of chunks.entries()) {
    rows.push({ source_id: sourceId, ordem, secao: chunk.secao, conteudo: chunk.conteudo, embedding: JSON.stringify(await embedText(`${chunk.secao}\n${chunk.conteudo}`)) });
  }
  if (rows.length) {
    const inserted = await db.from("knowledge_chunks").insert(rows);
    if (inserted.error) throw new Error(`knowledge_chunks: ${inserted.error.message}`);
  }
  return existing.data ? "atualizado" : "novo";
}

// Busca híbrida: os trechos mais relevantes para a pergunta, com a origem de cada um.
export async function searchKnowledge(db: Db, query: string, limit = 5): Promise<{ titulo: string; secao: string; conteudo: string; origem: string; score: number }[]> {
  const embedding = await embedText(query);
  const { data, error } = await db.rpc("search_knowledge", { p_query: query, p_embedding: JSON.stringify(embedding), p_limit: limit });
  if (error) throw new Error(`search_knowledge: ${error.message}`);
  return ((data ?? []) as { titulo: string; secao: string; conteudo: string; origem: string; score: number }[]).map((r) => ({ ...r, score: Number(r.score) }));
}
