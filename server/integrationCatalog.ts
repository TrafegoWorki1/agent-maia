import type { Db } from "./store.ts";

// Catálogo de integrações por endpoint (tabela maia_integrations). A Maia lista, propõe (sempre pendente) e chama só o
// que está ativo; ativar é decisão do owner, com aprovação. Segredos nunca passam por aqui: o catálogo guarda só o NOME
// da variável de ambiente do servidor (INTEGRACAO_*, ou a chave da Evolution já configurada). Conteúdo devolvido por
// um endpoint é dado, não instrução.

export interface Integration {
  id: number;
  slug: string;
  title: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url_template: string;
  body_template: unknown;
  auth_style: "nenhum" | "apikey_header" | "bearer";
  auth_header: string | null;
  secret_ref: string | null;
  risk: "leitura" | "interna" | "externa";
  status: "pending" | "active" | "paused";
  required_permission: string | null;
}

type Env = Record<string, string | undefined>;
export type Param = string | number | boolean;

const SLUG = /^[a-z][a-z0-9_]{2,40}$/;
const URL_ENV = ["EVOLUTION_API_URL", "EVOLUTION_INSTANCE"];
const MAX_PENDING = 20;
const MAX_BODY = 4000;
const TIMEOUT_MS = 15000;

// As chaves da Evolution e da Zernio já existem no servidor e cada uma só vale para o endereço do seu serviço. Qualquer
// outro segredo precisa do prefixo INTEGRACAO_, para a Maia nunca apontar para SUPABASE_*, ANTHROPIC_* e afins.
const BUILTIN_SECRETS: Record<string, (env: Env) => string> = {
  EVOLUTION_API_KEY: (env) => safeHost(env.EVOLUTION_API_URL ?? ""),
  ZERNIO_API_KEY: () => "zernio.com",
};
export function validSecretRef(ref: string): boolean {
  return Object.hasOwn(BUILTIN_SECRETS, ref) || /^INTEGRACAO_[A-Z0-9_]{2,50}$/.test(ref);
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Troca {EVOLUTION_API_URL} e {EVOLUTION_INSTANCE} pelo valor do ambiente do servidor. Parâmetros {{nome}} entram no caminho
// (valor simples, sem barra, nunca "." ou "..") ou na consulta (depois do ?), sempre codificados; nunca no endereço do servidor.
// {{nome?}} na consulta é opcional: sem o parâmetro, o par chave=valor some.
const PARAM = /\{\{([a-zA-Z0-9_]+)(\?)?\}\}/g;
const PATH_VALUE = /^[A-Za-z0-9_.:@=-]{1,128}$/;

export function resolveUrl(template: string, env: Env, params?: Record<string, Param>): { ok: true; url: URL; used: Set<string> } | { ok: false; error: string } {
  const cut = template.indexOf("?");
  const head = cut < 0 ? template : template.slice(0, cut);
  const query = cut < 0 ? "" : template.slice(cut + 1);
  const authorityEnd = head.indexOf("/", head.indexOf("://") + 3);
  if (authorityEnd < 0 || head.slice(0, authorityEnd).includes("{{")) return { ok: false, error: "parâmetro não é aceito no endereço do servidor" };
  const used = new Set<string>();
  let failure = "";

  let missing = "";
  const envHead = head.replace(/\{([A-Z_]+)\}/g, (_, name: string) => {
    const value = URL_ENV.includes(name) ? env[name] : undefined;
    if (!value) missing = name;
    return value ?? "";
  });
  if (missing) return { ok: false, error: `variável ${missing} não permitida ou não configurada no servidor` };

  const filledHead = envHead.replace(PARAM, (_, name: string, optional?: string) => {
    used.add(name);
    if (optional) { failure = "parâmetro opcional não é aceito no caminho"; return ""; }
    if (!params) return "x";
    if (!(name in params)) { failure = `falta o parâmetro ${name}`; return ""; }
    const value = String(params[name]);
    if (!PATH_VALUE.test(value) || value === "." || value === "..") { failure = `o valor de ${name} não é aceito no caminho (só letras, números e _ . : @ = -)`; return ""; }
    return encodeURIComponent(value);
  });
  if (failure) return { ok: false, error: failure };

  const pairs: string[] = [];
  for (const pair of query ? query.split("&") : []) {
    let drop = false;
    const filled = pair.replace(PARAM, (_, name: string, optional?: string) => {
      used.add(name);
      if (!params) return "x";
      if (!(name in params)) { if (optional) drop = true; else failure = `falta o parâmetro ${name}`; return ""; }
      return encodeURIComponent(String(params[name]));
    });
    if (failure) return { ok: false, error: failure };
    if (!drop) pairs.push(filled);
  }
  const filledUrl = pairs.length ? `${filledHead}?${pairs.join("&")}` : filledHead;
  if (/[{}]/.test(filledUrl)) return { ok: false, error: "a URL tem marcador não permitido" };
  let url: URL;
  try { url = new URL(filledUrl); } catch { return { ok: false, error: "URL inválida" }; }
  if (url.protocol !== "https:") return { ok: false, error: "só https é aceito" };
  if (url.username || url.password) return { ok: false, error: "URL com usuário ou senha não é aceita" };
  const evolutionHost = env.EVOLUTION_API_URL ? safeHost(env.EVOLUTION_API_URL) : "";
  if (privateHost(url.hostname) && url.hostname !== evolutionHost) return { ok: false, error: "endereço interno ou local não é aceito" };
  return { ok: true, url, used };
}

function safeHost(value: string): string {
  try { return new URL(value).hostname; } catch { return ""; }
}

// Substitui {{nome}}. Valor único no campo mantém o tipo (true/false/número); embutido em texto vira texto.
// {{nome?}} é opcional: sem o parâmetro, a chave inteira some do corpo.
const OMIT = Symbol("omit");
export function fillBody(template: unknown, params: Record<string, Param>, alsoUsed: Set<string> = new Set()): { ok: true; body: unknown } | { ok: false; error: string } {
  const used = new Set<string>(alsoUsed);
  let failure = "";
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const whole = /^\{\{([a-zA-Z0-9_]+)(\?)?\}\}$/.exec(node);
      if (whole) {
        used.add(whole[1]);
        if (!(whole[1] in params)) { if (whole[2]) return OMIT; failure = `falta o parâmetro ${whole[1]}`; return null; }
        const v = params[whole[1]];
        return v === "true" ? true : v === "false" ? false : v;
      }
      return node.replace(PARAM, (_, name: string, optional?: string) => {
        used.add(name);
        if (!(name in params)) { if (!optional) failure = `falta o parâmetro ${name}`; return ""; }
        return String(params[name]);
      });
    }
    if (Array.isArray(node)) return node.map(walk).filter((v) => v !== OMIT);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)] as const).filter(([, v]) => v !== OMIT));
    return node;
  };
  const body = walk(template);
  if (failure) return { ok: false, error: failure };
  const extra = Object.keys(params).filter((k) => !used.has(k));
  if (extra.length) return { ok: false, error: `parâmetro não previsto: ${extra.join(", ")}` };
  return { ok: true, body };
}

function redact(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[segredo]") : text;
}

export async function listIntegrations(db: Db, env: Env = process.env): Promise<Array<{ slug: string; titulo: string; descricao: string; status: string; metodo: string; destino: string; segredo_configurado: boolean | null; permissao: string | null }>> {
  const { data, error } = await db.from("maia_integrations").select("*").order("slug");
  if (error) throw new Error(`Não consegui ler o catálogo: ${error.message}`);
  return ((data ?? []) as Integration[]).map((row) => {
    const resolved = resolveUrl(row.url_template, env);
    return {
      slug: row.slug, titulo: row.title, descricao: row.description, status: row.status, metodo: row.method,
      destino: resolved.ok ? resolved.url.hostname : "(a URL não resolve neste servidor)",
      segredo_configurado: row.secret_ref ? Boolean(env[row.secret_ref]) : null,
      permissao: row.required_permission,
    };
  });
}

export async function callIntegration(
  db: Db,
  slug: string,
  params: Record<string, Param>,
  opts: { env?: Env; fetchImpl?: typeof fetch; risks?: Array<Integration["risk"]> } = {},
): Promise<{ ok: true; status: number; body: string } | { ok: false; error: string }> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const { data, error } = await db.from("maia_integrations").select("*").eq("slug", slug).maybeSingle();
  if (error) return { ok: false, error: `não consegui ler o catálogo: ${error.message}` };
  const row = data as Integration | null;
  if (!row) return { ok: false, error: `integração "${slug}" não existe no catálogo` };
  if (row.status !== "active") return { ok: false, error: `integração "${slug}" está ${row.status === "pending" ? "pendente de ativação pelo owner" : "pausada"}` };
  const allowed = opts.risks ?? ["leitura", "interna"];
  if (!allowed.includes(row.risk)) {
    return { ok: false, error: row.risk === "externa" ? `a integração "${slug}" age fora da Maia e exige OK a cada uso: use integracao_chamar_externa` : `a integração "${slug}" não é externa: use integracao_chamar` };
  }
  const target = resolveUrl(row.url_template, env, params);
  if (!target.ok) return { ok: false, error: target.error };

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  let secret: string | undefined;
  if (row.auth_style !== "nenhum") {
    if (!row.secret_ref || !validSecretRef(row.secret_ref)) return { ok: false, error: "referência de segredo inválida" };
    const boundHost = BUILTIN_SECRETS[row.secret_ref]?.(env);
    if (boundHost !== undefined && target.url.hostname !== boundHost) {
      return { ok: false, error: `a chave ${row.secret_ref.startsWith("ZERNIO") ? "da Zernio só pode ser usada no endereço da Zernio" : "da Evolution só pode ser usada no endereço da Evolution"}` };
    }
    secret = env[row.secret_ref];
    if (!secret) return { ok: false, error: `o segredo ${row.secret_ref} não está configurado no servidor` };
    if (row.auth_style === "bearer") headers.authorization = `Bearer ${secret}`;
    else headers[(row.auth_header ?? "apikey").toLowerCase()] = secret;
  }

  const init: RequestInit = { method: row.method, headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (row.method !== "GET" && row.body_template != null) {
    const filled = fillBody(row.body_template, params, target.used);
    if (!filled.ok) return { ok: false, error: filled.error };
    init.body = JSON.stringify(filled.body);
  } else {
    const extra = Object.keys(params).filter((k) => !target.used.has(k));
    if (extra.length) return { ok: false, error: `parâmetro não previsto: ${extra.join(", ")}` };
  }

  try {
    const res = await doFetch(target.url, init);
    if (res.status >= 300 && res.status < 400) return { ok: false, error: `redirecionamento (${res.status}) recusado` };
    const text = redact((await res.text()).slice(0, MAX_BODY), secret);
    return res.ok ? { ok: true, status: res.status, body: text } : { ok: false, error: `o endpoint respondeu HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, error: `falha na chamada: ${redact(e instanceof Error ? e.message : String(e), secret)}` };
  }
}

// As ferramentas recebem parâmetros como TEXTO JSON: um z.record no esquema da ferramenta derruba a listagem MCP inteira
// (nenhuma ferramenta da Maia chega ao Claude), então o objeto é lido e validado aqui.
export function parseJsonObject(text: string | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (text === undefined || text.trim() === "") return { ok: true, value: {} };
  if (text.length > 4000) return { ok: false, error: "o JSON é grande demais" };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, error: "o texto não é um JSON válido" }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "esperava um objeto JSON" };
  return { ok: true, value: value as Record<string, unknown> };
}

export function parseParams(text: string | undefined): { ok: true; params: Record<string, Param> } | { ok: false; error: string } {
  const parsed = parseJsonObject(text);
  if (!parsed.ok) return parsed;
  const entries = Object.entries(parsed.value);
  if (entries.length > 20) return { ok: false, error: "parâmetros demais (máximo 20)" };
  const params: Record<string, Param> = {};
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) return { ok: false, error: `nome de parâmetro inválido: ${key.slice(0, 40)}` };
    if (typeof value === "string" ? value.length > 500 : typeof value !== "number" && typeof value !== "boolean") return { ok: false, error: `valor inválido em ${key} (use texto de até 500 caracteres, número ou verdadeiro/falso)` };
    params[key] = value as Param;
  }
  return { ok: true, params };
}

export interface Proposal {
  slug: string;
  titulo: string;
  descricao: string;
  metodo: Integration["method"];
  url: string;
  corpo?: unknown;
  auth: Integration["auth_style"];
  cabecalho?: string;
  segredo?: string;
  risco: Integration["risk"];
}

// Sempre nasce pendente e sem permissão extra: só o owner ativa. A URL precisa ser https literal (nada de variável).
export async function proposeIntegration(db: Db, p: Proposal): Promise<{ ok: true; mensagem: string } | { ok: false; error: string }> {
  if (!SLUG.test(p.slug)) return { ok: false, error: "slug inválido (minúsculas, números e _, 3 a 41 caracteres)" };
  const checked = resolveUrl(p.url, {});
  if (!checked.ok) return { ok: false, error: `use uma URL https literal (parâmetros {{nome}} só depois do ?): ${checked.error}` };
  const url = checked.url;
  if (p.auth !== "nenhum") {
    if (!p.segredo || !validSecretRef(p.segredo) || Object.hasOwn(BUILTIN_SECRETS, p.segredo)) return { ok: false, error: "o nome do segredo precisa começar com INTEGRACAO_ (ex.: INTEGRACAO_SERVICOX_TOKEN)" };
  } else if (p.segredo) return { ok: false, error: "sem autenticação não há segredo" };
  const existing = await db.from("maia_integrations").select("slug, status");
  if (existing.error) return { ok: false, error: `não consegui ler o catálogo: ${existing.error.message}` };
  const rows = (existing.data ?? []) as Array<{ slug: string; status: string }>;
  if (rows.some((r) => r.slug === p.slug)) return { ok: false, error: `já existe uma integração "${p.slug}"` };
  if (rows.filter((r) => r.status === "pending").length >= MAX_PENDING) return { ok: false, error: "há propostas pendentes demais; o owner precisa ativar ou limpar antes" };
  const insert = await db.from("maia_integrations").insert({
    slug: p.slug, title: p.titulo, description: p.descricao, method: p.metodo, url_template: p.url, body_template: p.corpo ?? null,
    auth_style: p.auth, auth_header: p.auth === "apikey_header" ? p.cabecalho ?? "apikey" : null, secret_ref: p.segredo ?? null,
    risk: p.risco, status: "pending", required_permission: "integracao.usar", created_by: "maia",
  });
  if (insert.error) return { ok: false, error: `não consegui registrar: ${insert.error.message}` };
  return { ok: true, mensagem: `Integração "${p.slug}" registrada como PENDENTE (destino ${url.hostname}).${p.segredo ? ` O owner precisa colocar a variável ${p.segredo} no ambiente do servidor; o token não deve ser enviado pelo chat.` : ""} Só o owner a ativa.` };
}

export async function activateIntegration(db: Db, slug: string, env: Env = process.env): Promise<{ ok: true; mensagem: string } | { ok: false; error: string }> {
  const { data, error } = await db.from("maia_integrations").select("*").eq("slug", slug).maybeSingle();
  if (error) return { ok: false, error: `não consegui ler o catálogo: ${error.message}` };
  const row = data as Integration | null;
  if (!row) return { ok: false, error: `integração "${slug}" não existe` };
  if (row.status === "active") return { ok: true, mensagem: `"${slug}" já estava ativa.` };
  const target = resolveUrl(row.url_template, env);
  if (!target.ok) return { ok: false, error: target.error };
  if (row.secret_ref && !env[row.secret_ref]) return { ok: false, error: `falta a variável ${row.secret_ref} no ambiente do servidor; configure e reinicie o worker antes de ativar` };
  const update = await db.from("maia_integrations").update({ status: "active", activated_at: new Date().toISOString() }).eq("slug", slug);
  if (update.error) return { ok: false, error: `não consegui ativar: ${update.error.message}` };
  return { ok: true, mensagem: `Integração "${slug}" ativada (destino ${target.url.hostname}).` };
}
