import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Cliente da Zernio (API de redes sociais) para o Instagram da Worki.
// Leitura: contas, desempenho dos posts e artes recentes. Escrita: publicar ou agendar UM post com imagem,
// sempre depois da aprovação (o fluxo de aprovação fica no agente, não aqui).
// Fora de escopo, de propósito: mensagens diretas, comentários, seguir ou prospectar. Isso exige decisão do owner.

const BASE = "https://zernio.com/api/v1";
export const ARTE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "arte");
const MAX_CAPTION = 2200;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class ZernioError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Mensagens em português, sem nunca incluir a chave nem o corpo bruto da resposta.
function describeFailure(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "a Zernio recusou a autenticação (chave inválida ou sem permissão)";
  if (status === 404) return "a Zernio não encontrou o recurso";
  if (status === 429) return "a Zernio limitou as chamadas (muitas requisições)";
  if (status >= 500) return "a Zernio está indisponível no momento";
  const detail = body && typeof body === "object" ? String((body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error ?? "") : "";
  return `a Zernio recusou o pedido (HTTP ${status})${detail ? `: ${detail.slice(0, 160)}` : ""}`;
}

async function request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; json: unknown }> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new ZernioError("Zernio não configurada (ZERNIO_API_KEY ausente)", 0);
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

export interface InstagramAccount {
  id: string;
  username: string;
  active: boolean;
}

export async function listInstagramAccounts(): Promise<InstagramAccount[]> {
  const { status, json } = await request("GET", "/accounts");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { accounts?: unknown[] })?.accounts ?? []) as Record<string, unknown>[];
  return list
    .filter((a) => a.platform === "instagram")
    .map((a) => ({ id: String(a._id ?? a.id ?? ""), username: String(a.username ?? a.displayName ?? ""), active: a.isActive !== false }))
    .filter((a) => a.id);
}

export interface PostPerformance {
  publishedAt: string | null;
  mediaType: string | null;
  caption: string;
  url: string | null;
  alcance: number | null;
  visualizacoes: number | null;
  curtidas: number | null;
  comentarios: number | null;
  compartilhamentos: number | null;
  salvamentos: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

// Desempenho dos posts mais recentes do Instagram. O que a API não informa fica nulo.
export async function instagramPerformance(limit = 10): Promise<{ posts: PostPerformance[]; totalPosts: number | null }> {
  const { status, json } = await request("GET", "/analytics");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const data = json as { overview?: { totalPosts?: number }; posts?: Record<string, unknown>[] };
  const posts = (data.posts ?? [])
    .filter((p) => p.platform === "instagram")
    .sort((a, b) => Date.parse(String(b.publishedAt ?? 0)) - Date.parse(String(a.publishedAt ?? 0)))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map((p) => {
      const m = (p.analytics ?? {}) as Record<string, unknown>;
      return {
        publishedAt: typeof p.publishedAt === "string" ? p.publishedAt : null,
        mediaType: typeof p.mediaType === "string" ? p.mediaType : null,
        caption: String(p.content ?? "").slice(0, 80),
        url: typeof p.platformPostUrl === "string" ? p.platformPostUrl : null,
        alcance: num(m.reach),
        visualizacoes: num(m.views),
        curtidas: num(m.likes),
        comentarios: num(m.comments),
        compartilhamentos: num(m.shares),
        salvamentos: num(m.saves),
      };
    });
  return { posts, totalPosts: num(data.overview?.totalPosts) };
}

// Só arquivos dentro de data/arte, PNG ou JPEG, até 8 MB. Nada de caminho fora da pasta de artes.
export function resolveArtPath(relativePath: string): { ok: true; path: string } | { ok: false; error: string } {
  const full = resolve(ARTE_ROOT, relativePath);
  const rel = relative(ARTE_ROOT, full);
  if (rel.startsWith("..") || rel === "" || resolve(ARTE_ROOT, rel) !== full) return { ok: false, error: "a imagem precisa estar na pasta de artes da Maia" };
  if (!/\.(png|jpe?g)$/i.test(full)) return { ok: false, error: "só PNG ou JPEG" };
  if (!existsSync(full)) return { ok: false, error: "arquivo não encontrado" };
  if (statSync(full).size > MAX_IMAGE_BYTES) return { ok: false, error: "a imagem passa de 8 MB" };
  return { ok: true, path: full };
}

// Últimas artes geradas, para o agente escolher qual publicar. Só caminhos relativos e datas.
export function recentArts(limit = 5): { path: string; modifiedAt: string }[] {
  const root = join(ARTE_ROOT, "pedidos");
  if (!existsSync(root)) return [];
  const found: { path: string; mtime: number }[] = [];
  for (const folder of readdirSync(root)) {
    const dir = join(root, folder);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (!/\.(png|jpe?g)$/i.test(file)) continue;
      found.push({ path: `pedidos/${folder}/${file}`, mtime: statSync(join(dir, file)).mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((f) => ({ path: f.path, modifiedAt: new Date(f.mtime).toISOString() }));
}

// Envia a imagem ao armazenamento da Zernio e devolve o endereço público. Não publica nada.
export async function uploadImage(path: string): Promise<string> {
  const contentType = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
  const presign = await request("POST", "/media/presign", { filename: basename(path), contentType });
  if (!ok(presign.status)) throw new ZernioError(describeFailure(presign.status, presign.json), presign.status);
  const { uploadUrl, publicUrl } = presign.json as { uploadUrl?: string; publicUrl?: string };
  if (!uploadUrl || !publicUrl) throw new ZernioError("a Zernio não devolveu o endereço de envio", presign.status);
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: readFileSync(path), signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw new ZernioError(`falha ao enviar a imagem (HTTP ${put.status})`, put.status);
  return publicUrl;
}

export interface InstagramPostInput {
  accountId: string;
  caption: string;
  imageUrl: string;
  scheduledFor?: string | null;
}

// Monta o corpo do pedido. Função pura e testável: valida legenda, imagem e horário.
export function buildInstagramPost(input: InstagramPostInput, now = new Date()): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const caption = input.caption.trim();
  if (!caption) return { ok: false, error: "a legenda está vazia" };
  if (caption.length > MAX_CAPTION) return { ok: false, error: `a legenda passa de ${MAX_CAPTION} caracteres` };
  if (!/^https:\/\//i.test(input.imageUrl)) return { ok: false, error: "a imagem precisa de um endereço público https" };
  if (!input.accountId) return { ok: false, error: "conta do Instagram não informada" };
  const body: Record<string, unknown> = {
    content: caption,
    mediaItems: [{ type: "image", url: input.imageUrl }],
    platforms: [{ platform: "instagram", accountId: input.accountId }],
  };
  if (input.scheduledFor) {
    const when = Date.parse(input.scheduledFor);
    if (Number.isNaN(when)) return { ok: false, error: "horário de agendamento inválido (use data e hora ISO)" };
    if (when <= now.getTime() + 60_000) return { ok: false, error: "o horário de agendamento precisa ser no futuro" };
    body.scheduledFor = new Date(when).toISOString();
  } else {
    body.publishNow = true;
  }
  return { ok: true, body };
}

export interface PublishResult {
  postId: string | null;
  status: string;
  url: string | null;
  scheduled: boolean;
}

// Cria o post. 201 = criado; 207 com status "failed" = o Instagram recusou (não conta como publicado).
export async function publishInstagramPost(input: InstagramPostInput): Promise<PublishResult> {
  const built = buildInstagramPost(input);
  if (!built.ok) throw new ZernioError(built.error, 0);
  const { status, json } = await request("POST", "/posts", built.body, 60_000);
  const post = ((json as { post?: Record<string, unknown> })?.post ?? {}) as Record<string, unknown>;
  const postStatus = String(post.status ?? "");
  if (status === 207 || postStatus === "failed") throw new ZernioError("o Instagram recusou a publicação (status: failed)", status);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const platforms = (post.platforms ?? []) as Record<string, unknown>[];
  const url = typeof platforms[0]?.platformPostUrl === "string" ? (platforms[0].platformPostUrl as string) : null;
  return { postId: typeof post._id === "string" ? post._id : null, status: postStatus || "criado", url, scheduled: Boolean(input.scheduledFor) };
}
