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

async function request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, timeoutMs = 30_000, extraHeaders?: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const key = process.env.ZERNIO_API_KEY;
  if (!key) throw new ZernioError("Zernio não configurada (ZERNIO_API_KEY ausente)", 0);
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
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
  profileId: string;
}

export async function listInstagramAccounts(): Promise<InstagramAccount[]> {
  const { status, json } = await request("GET", "/accounts");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { accounts?: unknown[] })?.accounts ?? []) as Record<string, unknown>[];
  return list
    .filter((a) => a.platform === "instagram")
    .map((a) => {
      const profile = a.profileId as { _id?: unknown } | string | undefined;
      const profileId = typeof profile === "string" ? profile : String(profile?._id ?? "");
      return { id: String(a._id ?? a.id ?? ""), username: String(a.username ?? a.displayName ?? ""), active: a.isActive !== false, profileId };
    })
    .filter((a) => a.id);
}

export interface LinkedInAccount {
  id: string;
  name: string;
  active: boolean;
  accountType: string | null;
}

export interface LinkedInOrganization {
  id: string;
  name: string;
  url: string | null;
}

export async function listLinkedInAccounts(): Promise<LinkedInAccount[]> {
  const { status, json } = await request("GET", "/accounts");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { accounts?: unknown[] })?.accounts ?? []) as Record<string, unknown>[];
  return list.filter((a) => a.platform === "linkedin").map((a) => ({
    id: String(a._id ?? a.id ?? ""),
    name: String(a.displayName ?? a.name ?? a.username ?? "LinkedIn"),
    active: a.isActive !== false,
    accountType: typeof a.accountType === "string" ? a.accountType : null,
  })).filter((a) => a.id);
}

export async function listLinkedInOrganizations(accountId: string): Promise<LinkedInOrganization[]> {
  if (!accountId) throw new ZernioError("conta do LinkedIn não informada", 0);
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/linkedin-organizations`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { organizations?: unknown[] })?.organizations ?? (Array.isArray(json) ? json : [])) as Record<string, unknown>[];
  return list.map((organization) => ({
    id: String(organization._id ?? organization.id ?? ""),
    name: String(organization.name ?? organization.displayName ?? "LinkedIn organization"),
    url: typeof organization.url === "string" ? organization.url : typeof organization.linkedinUrl === "string" ? organization.linkedinUrl : null,
  })).filter((organization) => organization.id);
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

export interface LinkedInPostInput {
  accountId: string;
  content: string;
  imageUrl?: string | null;
  scheduledFor?: string | null;
  organizationId?: string | null;
}

export function buildLinkedInPost(input: LinkedInPostInput, now = new Date()): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const content = input.content.trim();
  if (!content) return { ok: false, error: "o conteúdo do LinkedIn está vazio" };
  if (content.length > MAX_CAPTION) return { ok: false, error: `o conteúdo passa de ${MAX_CAPTION} caracteres` };
  if (!input.accountId) return { ok: false, error: "conta do LinkedIn não informada" };
  if (input.imageUrl && !/^https:\/\//i.test(input.imageUrl)) return { ok: false, error: "a imagem precisa de um endereço público https" };
  const body: Record<string, unknown> = {
    content,
    platforms: [{ platform: "linkedin", accountId: input.accountId, ...(input.organizationId ? { platformSpecificData: { organizationId: input.organizationId } } : {}) }],
  };
  if (input.imageUrl) body.mediaItems = [{ type: "image", url: input.imageUrl }];
  if (input.scheduledFor) {
    const when = Date.parse(input.scheduledFor);
    if (Number.isNaN(when)) return { ok: false, error: "horário de agendamento inválido (use data e hora ISO)" };
    if (when <= now.getTime() + 60_000) return { ok: false, error: "o horário de agendamento precisa ser no futuro" };
    body.scheduledFor = new Date(when).toISOString();
  } else body.publishNow = true;
  return { ok: true, body };
}

export async function publishLinkedInPost(input: LinkedInPostInput): Promise<PublishResult> {
  const built = buildLinkedInPost(input);
  if (!built.ok) throw new ZernioError(built.error, 0);
  const { status, json } = await request("POST", "/posts", built.body, 60_000);
  const post = ((json as { post?: Record<string, unknown> })?.post ?? {}) as Record<string, unknown>;
  const postStatus = String(post.status ?? "");
  if (status === 207 || postStatus === "failed") throw new ZernioError("o LinkedIn recusou a publicação (status: failed)", status);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const platforms = (post.platforms ?? []) as Record<string, unknown>[];
  const platform = platforms.find((item) => item.platform === "linkedin") ?? platforms[0];
  return { postId: typeof post._id === "string" ? post._id : null, status: postStatus || "criado", url: typeof platform?.platformPostUrl === "string" ? platform.platformPostUrl : null, scheduled: Boolean(input.scheduledFor) };
}

export async function linkedinPerformance(limit = 10): Promise<{ posts: PostPerformance[]; totalPosts: number | null }> {
  const { status, json } = await request("GET", "/analytics?platform=linkedin");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const data = json as { overview?: { totalPosts?: number }; posts?: Record<string, unknown>[] };
  const posts = (data.posts ?? []).filter((post) => post.platform === "linkedin").sort((a, b) => Date.parse(String(b.publishedAt ?? 0)) - Date.parse(String(a.publishedAt ?? 0))).slice(0, Math.max(1, Math.min(limit, 20))).map((post) => {
    const metrics = (post.analytics ?? {}) as Record<string, unknown>;
    return { publishedAt: typeof post.publishedAt === "string" ? post.publishedAt : null, mediaType: typeof post.mediaType === "string" ? post.mediaType : null, caption: String(post.content ?? "").slice(0, 80), url: typeof post.platformPostUrl === "string" ? post.platformPostUrl : null, alcance: num(metrics.reach), visualizacoes: num(metrics.views), curtidas: num(metrics.likes), comentarios: num(metrics.comments), compartilhamentos: num(metrics.shares), salvamentos: num(metrics.saves) };
  });
  return { posts, totalPosts: num(data.overview?.totalPosts) };
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

// Lê o post na Zernio depois de criado. É a conferência da publicação: confirma o status real, não o do pedido.
export async function getPostStatus(postId: string): Promise<{ status: string; url: string | null }> {
  const { status, json } = await request("GET", `/posts/${encodeURIComponent(postId)}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const post = ((json as { post?: Record<string, unknown> })?.post ?? json ?? {}) as Record<string, unknown>;
  const platforms = (post.platforms ?? []) as Record<string, unknown>[];
  const url = typeof platforms[0]?.platformPostUrl === "string" ? (platforms[0].platformPostUrl as string) : null;
  return { status: String(post.status ?? ""), url };
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

// --- Stories, áudio e status de seguidor (confirmado em 10/10/2026 contra a conta real da Worki) ---
// Endpoints testados ao vivo (leitura, sem efeito) antes de implementar: GET /accounts/{id}/instagram/stories,
// GET /accounts/{id}/follow-status/{userId}, GET /accounts/{id}/instagram/audio (exige audioType=music|original_sound
// e, nesta conta, falha com "instagram_audio_requires_facebook_login" até reconectar — reconexão fica fora do
// escopo das ferramentas da Maia, porque o teste ao vivo de GET /connect/instagram devolveu 402: a conta já usa as
// 2 contas sociais grátis da Zernio e precisa de forma de pagamento para reconectar/adicionar outra).

export interface InstagramStory {
  id: string;
  mediaType: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
}

export async function listInstagramStories(accountId: string): Promise<InstagramStory[]> {
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/instagram/stories`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
  return list.map((s) => ({
    id: String(s.id ?? s._id ?? ""),
    mediaType: typeof s.mediaType === "string" ? s.mediaType : null,
    mediaUrl: typeof s.mediaUrl === "string" ? s.mediaUrl : null,
    permalink: typeof s.permalink === "string" ? s.permalink : null,
    timestamp: typeof s.timestamp === "string" ? s.timestamp : null,
  })).filter((s) => s.id);
}

export async function getStoryInsights(accountId: string, storyId: string): Promise<Record<string, unknown>> {
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/instagram/stories/${encodeURIComponent(storyId)}/insights`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  return (json as { data?: Record<string, unknown> })?.data ?? (json as Record<string, unknown>) ?? {};
}

export type AudioType = "music" | "original_sound";

export interface InstagramAudio {
  id: string;
  title: string | null;
  artist: string | null;
}

// Exige a conta conectada por Facebook Login na Zernio; sem isso, a Zernio recusa com um erro claro
// (instagram_audio_requires_facebook_login), que a ferramenta repassa tal como vier.
export async function searchInstagramAudio(accountId: string, audioType: AudioType, q?: string): Promise<InstagramAudio[]> {
  const query = new URLSearchParams({ audioType, ...(q ? { q } : {}) });
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/instagram/audio?${query}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
  return list.map((a) => ({
    id: String(a.id ?? a._id ?? ""),
    title: typeof a.title === "string" ? a.title : null,
    artist: typeof a.artist === "string" ? a.artist : null,
  })).filter((a) => a.id);
}

export async function getInstagramAudioDetail(accountId: string, audioId: string): Promise<Record<string, unknown>> {
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/instagram/audio/${encodeURIComponent(audioId)}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  return (json as { data?: Record<string, unknown> })?.data ?? (json as Record<string, unknown>) ?? {};
}

export interface FollowStatus {
  userId: string;
  isFollower: boolean | null;
  isFollowedByAccount: boolean | null;
  followerCount: number | null;
  username: string | null;
  name: string | null;
}

// Só leitura informativa (ex.: "ele já me segue?" sobre alguém que já apareceu numa conversa). Nunca usar isso
// para disparar mensagem: curtida/seguida não autoriza DM fria (regra da Meta e decisão do blueprint de 10/10/2026).
export async function getFollowStatus(accountId: string, userId: string): Promise<FollowStatus> {
  const { status, json } = await request("GET", `/accounts/${encodeURIComponent(accountId)}/follow-status/${encodeURIComponent(userId)}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const data = json as Record<string, unknown>;
  return {
    userId: String(data.userId ?? userId),
    isFollower: typeof data.isFollower === "boolean" ? data.isFollower : null,
    isFollowedByAccount: typeof data.isFollowedByAccount === "boolean" ? data.isFollowedByAccount : null,
    followerCount: typeof data.followerCount === "number" ? data.followerCount : null,
    username: typeof data.username === "string" ? data.username : null,
    name: typeof data.name === "string" ? data.name : null,
  };
}

// --- Inbox (Direct): leitura de conversas/mensagens e resposta dentro da janela de 24h ---

export interface InboxConversation {
  id: string;
  accountId: string;
  participantId: string;
  participantName: string | null;
}

export async function listInboxConversations(accountId?: string): Promise<InboxConversation[]> {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const { status, json } = await request("GET", `/inbox/conversations${query}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
  return list.map((c) => ({
    id: String(c.id ?? ""),
    accountId: String(c.accountId ?? ""),
    participantId: String(c.participantId ?? ""),
    participantName: typeof c.participantName === "string" ? c.participantName : null,
  })).filter((c) => c.id);
}

export interface InboxMessage {
  message: string;
  senderName: string | null;
  direction: "incoming" | "outgoing" | string;
  createdAt: string;
}

export async function getConversationMessages(conversationId: string, accountId: string, opts: { limit?: number; sortOrder?: "asc" | "desc" } = {}): Promise<InboxMessage[]> {
  const query = new URLSearchParams({ accountId, limit: String(opts.limit ?? 20), sortOrder: opts.sortOrder ?? "desc" });
  const { status, json } = await request("GET", `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${query}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { messages?: unknown[] })?.messages ?? []) as Record<string, unknown>[];
  return list.map((m) => ({
    message: typeof m.message === "string" ? m.message : "",
    senderName: typeof m.senderName === "string" ? m.senderName : null,
    direction: typeof m.direction === "string" ? m.direction : "desconhecida",
    createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
  }));
}

const DM_WINDOW_MS = 24 * 60 * 60 * 1000;

// Regra da Meta: só dá para responder DM até 24h depois da última mensagem recebida da pessoa. Confere na
// hora do envio (não no momento em que o pedido foi feito), com as mensagens reais da conversa.
export function dmWindowOpen(messages: InboxMessage[], now = new Date()): boolean {
  const lastIncoming = messages.find((m) => m.direction === "incoming");
  if (!lastIncoming) return false;
  const at = Date.parse(lastIncoming.createdAt);
  return !Number.isNaN(at) && now.getTime() - at <= DM_WINDOW_MS;
}

// Manda a mensagem no Direct. Quem chama deve ter conferido dmWindowOpen com as mensagens atuais antes de
// chamar esta função: ela não refaz essa checagem, para não buscar as mensagens duas vezes.
export async function sendInboxMessage(conversationId: string, accountId: string, message: string, idempotencyKey: string): Promise<{ messageId: string | null }> {
  const { status, json } = await request("POST", `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { accountId, message }, 30_000, { "Idempotency-Key": idempotencyKey });
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const data = (json as { data?: Record<string, unknown> })?.data ?? {};
  return { messageId: typeof data.messageId === "string" ? data.messageId : null };
}

// --- Automações de comentário → DM: sempre criadas/alteradas inativas por padrão; quem ativa é uma
// ferramenta separada (instagram_automacao_ativar), e as duas passam por aprovação do owner. ---

export interface CommentAutomation {
  id: string;
  name: string;
  isActive: boolean;
  trigger: string | null;
  keywords: string[];
  dmMessage: string | null;
  commentReply: string | null;
}

function toAutomation(a: Record<string, unknown>): CommentAutomation {
  return {
    id: String(a.id ?? a._id ?? ""),
    name: typeof a.name === "string" ? a.name : "",
    isActive: a.isActive === true,
    trigger: typeof a.trigger === "string" ? a.trigger : null,
    keywords: Array.isArray(a.keywords) ? a.keywords.map(String) : [],
    dmMessage: typeof a.dmMessage === "string" ? a.dmMessage : null,
    commentReply: typeof a.commentReply === "string" ? a.commentReply : null,
  };
}

export async function listCommentAutomations(): Promise<CommentAutomation[]> {
  const { status, json } = await request("GET", "/comment-automations");
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const list = ((json as { automations?: unknown[] })?.automations ?? []) as Record<string, unknown>[];
  return list.map(toAutomation);
}

export async function getCommentAutomation(automationId: string): Promise<CommentAutomation> {
  const { status, json } = await request("GET", `/comment-automations/${encodeURIComponent(automationId)}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const automation = (json as { automation?: Record<string, unknown> })?.automation ?? (json as Record<string, unknown>);
  return toAutomation(automation);
}

export interface CreateCommentAutomationInput {
  profileId: string;
  accountId: string;
  name: string;
  dmMessage: string;
  commentReply?: string;
  keywords?: string[];
  matchMode?: "contains" | "word" | "exact";
  trigger?: "comment" | "story_reply" | "story_mention";
  platformPostId?: string;
}

// Decisão de segurança (10/10/2026): toda automação nasce com isActive: false, mesmo que o pedido não diga nada
// sobre isso. Só liga quem usar instagram_automacao_ativar, com aprovação própria.
export async function createCommentAutomation(input: CreateCommentAutomationInput): Promise<CommentAutomation> {
  const { status, json } = await request("POST", "/comment-automations", { ...input, isActive: false });
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const automation = (json as { automation?: Record<string, unknown> })?.automation ?? (json as Record<string, unknown>);
  return toAutomation(automation);
}

export async function setCommentAutomationActive(automationId: string, isActive: boolean): Promise<CommentAutomation> {
  const { status, json } = await request("PATCH", `/comment-automations/${encodeURIComponent(automationId)}`, { isActive });
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  const automation = (json as { automation?: Record<string, unknown> })?.automation ?? (json as Record<string, unknown>);
  return toAutomation(automation);
}

export async function deleteCommentAutomation(automationId: string): Promise<void> {
  const { status, json } = await request("DELETE", `/comment-automations/${encodeURIComponent(automationId)}`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
}

export async function getCommentAutomationLogs(automationId: string): Promise<Record<string, unknown>[]> {
  const { status, json } = await request("GET", `/comment-automations/${encodeURIComponent(automationId)}/logs`);
  if (!ok(status)) throw new ZernioError(describeFailure(status, json), status);
  return ((json as { logs?: unknown[] })?.logs ?? []) as Record<string, unknown>[];
}
