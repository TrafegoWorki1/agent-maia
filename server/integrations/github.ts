import { readSecret } from "../vault.ts";
import type { Db } from "../store.ts";

// Cliente mínimo da API REST do GitHub. Só o que as ferramentas `github_*` da Maia usam.
// Fora de propósito: apagar repositório, tornar público, merge e push forçado. O token tem escopo `repo`, que permitiria isso;
// quem limita é este módulo, que simplesmente não expõe essas chamadas.

const API = "https://api.github.com";
const TIMEOUT_MS = 20_000;

export class GithubError extends Error {}

export const REPO_REF = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_NAME = /^[A-Za-z0-9._/-]{1,100}$/;

// `.env` primeiro; depois o cofre (`cofre GITHUB_TOKEN | valor` vira INTEGRACAO_GITHUB_TOKEN).
export async function githubToken(db: Db): Promise<string> {
  const token = process.env.GITHUB_TOKEN?.trim() || (await readSecret(db, "INTEGRACAO_GITHUB_TOKEN"));
  if (!token) throw new GithubError("GitHub não configurado: falta GITHUB_TOKEN no .env do servidor ou INTEGRACAO_GITHUB_TOKEN no cofre.");
  return token;
}

async function call<T>(db: Db, method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  const token = await githubToken(db);
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "maia-agent",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data ? String((data as { message: unknown }).message) : response.statusText;
    throw new GithubError(`GitHub respondeu ${response.status}: ${message}`);
  }
  return data as T;
}

function assertRepo(repo: string): void {
  if (!REPO_REF.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) throw new GithubError("Repositório inválido: use o formato dono/nome.");
}

function assertBranch(branch: string): void {
  if (!BRANCH_NAME.test(branch) || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".lock")) throw new GithubError("Nome de branch inválido.");
}

function assertPath(path: string): void {
  if (path.length > 200 || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new GithubError("Caminho de arquivo inválido: use um caminho relativo dentro do repositório.");
  if (/^\.github\/workflows\//i.test(path)) throw new GithubError("Arquivos de workflow (.github/workflows) não são alterados pela Maia.");
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

interface RawRepo { full_name: string; private: boolean; html_url: string; updated_at?: string; description?: string | null; default_branch?: string }

export async function listRepos(db: Db, limit = 20) {
  const repos = await call<RawRepo[]>(db, "GET", `/user/repos?sort=updated&per_page=${limit}&affiliation=owner,collaborator,organization_member`);
  return repos.map((r) => ({ repo: r.full_name, privado: r.private, atualizado: r.updated_at?.slice(0, 10) ?? null, url: r.html_url }));
}

export async function listPullRequests(db: Db, repo: string, state: "open" | "closed" | "all" = "open") {
  assertRepo(repo);
  const prs = await call<Array<{ number: number; title: string; state: string; user?: { login?: string }; html_url: string; head?: { ref?: string }; base?: { ref?: string }; draft?: boolean }>>(db, "GET", `/repos/${repo}/pulls?state=${state}&per_page=15`);
  return prs.map((p) => ({ numero: p.number, titulo: p.title, estado: p.state, rascunho: !!p.draft, autor: p.user?.login ?? null, de: p.head?.ref ?? null, para: p.base?.ref ?? null, url: p.html_url }));
}

export async function listIssues(db: Db, repo: string, state: "open" | "closed" | "all" = "open") {
  assertRepo(repo);
  const issues = await call<Array<{ number: number; title: string; state: string; user?: { login?: string }; html_url: string; pull_request?: unknown }>>(db, "GET", `/repos/${repo}/issues?state=${state}&per_page=20`);
  // A API de issues também devolve PRs; aqui só issues.
  return issues.filter((i) => !i.pull_request).map((i) => ({ numero: i.number, titulo: i.title, estado: i.state, autor: i.user?.login ?? null, url: i.html_url }));
}

export async function ciStatus(db: Db, repo: string) {
  assertRepo(repo);
  const data = await call<{ workflow_runs?: Array<{ name?: string; status?: string; conclusion?: string | null; head_branch?: string; html_url: string; created_at?: string }> }>(db, "GET", `/repos/${repo}/actions/runs?per_page=5`);
  return (data.workflow_runs ?? []).map((r) => ({ workflow: r.name ?? null, estado: r.status ?? null, resultado: r.conclusion ?? null, branch: r.head_branch ?? null, criado: r.created_at ?? null, url: r.html_url }));
}

// Sempre privado. Tornar público não é uma operação da Maia.
export async function createRepo(db: Db, input: { name: string; description?: string; autoInit?: boolean }) {
  if (!REPO_NAME.test(input.name) || input.name === "." || input.name === "..") throw new GithubError("Nome de repositório inválido: use letras, números, ponto, hífen ou sublinhado.");
  const repo = await call<RawRepo>(db, "POST", "/user/repos", { name: input.name, description: input.description, private: true, auto_init: input.autoInit ?? true });
  if (repo.private !== true) throw new GithubError(`O repositório ${repo.full_name} foi criado, mas o GitHub não o devolveu como privado. Confira a visibilidade no GitHub.`);
  return { repo: repo.full_name, privado: true, url: repo.html_url, branch_padrao: repo.default_branch ?? "main" };
}

export async function createBranch(db: Db, input: { repo: string; branch: string; from?: string }) {
  assertRepo(input.repo);
  assertBranch(input.branch);
  const base = input.from ?? (await call<RawRepo>(db, "GET", `/repos/${input.repo}`)).default_branch ?? "main";
  assertBranch(base);
  const ref = await call<{ object: { sha: string } }>(db, "GET", `/repos/${input.repo}/git/ref/heads/${encodePath(base)}`);
  const created = await call<{ ref: string }>(db, "POST", `/repos/${input.repo}/git/refs`, { ref: `refs/heads/${input.branch}`, sha: ref.object.sha });
  return { repo: input.repo, branch: created.ref.replace(/^refs\/heads\//, ""), a_partir_de: base };
}

// Cria ou atualiza um arquivo (um commit). Exige OK do owner na política de aprovação.
export async function saveFile(db: Db, input: { repo: string; path: string; content: string; message: string; branch?: string }) {
  assertRepo(input.repo);
  assertPath(input.path);
  if (input.branch) assertBranch(input.branch);
  const query = input.branch ? `?ref=${encodeURIComponent(input.branch)}` : "";
  let sha: string | undefined;
  try {
    sha = (await call<{ sha?: string }>(db, "GET", `/repos/${input.repo}/contents/${encodePath(input.path)}${query}`)).sha;
  } catch (error) {
    if (!(error instanceof GithubError) || !error.message.includes("404")) throw error;
  }
  const saved = await call<{ content?: { html_url?: string }; commit?: { html_url?: string; sha?: string } }>(db, "PUT", `/repos/${input.repo}/contents/${encodePath(input.path)}`, {
    message: input.message,
    content: Buffer.from(input.content, "utf8").toString("base64"),
    ...(input.branch ? { branch: input.branch } : {}),
    ...(sha ? { sha } : {}),
  });
  return { repo: input.repo, caminho: input.path, acao: sha ? "atualizado" : "criado", commit: saved.commit?.sha?.slice(0, 7) ?? null, url: saved.commit?.html_url ?? saved.content?.html_url ?? null };
}

// Lê o conteúdo de um arquivo de texto do repositório (leitura, sem OK). Devolve null se o arquivo não existe.
export async function readFile(db: Db, input: { repo: string; path: string }): Promise<string | null> {
  assertRepo(input.repo);
  assertPath(input.path);
  try {
    const data = await call<{ content?: string; encoding?: string }>(db, "GET", `/repos/${input.repo}/contents/${encodePath(input.path)}`);
    if (!data.content) throw new GithubError("Arquivo grande demais para ler pela API do GitHub.");
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
  } catch (error) {
    if (error instanceof GithubError && error.message.includes("404")) return null;
    throw error;
  }
}

export async function createPullRequest(db: Db, input: { repo: string; title: string; head: string; base: string; body?: string }) {
  assertRepo(input.repo);
  assertBranch(input.head);
  assertBranch(input.base);
  const pr = await call<{ number: number; html_url: string }>(db, "POST", `/repos/${input.repo}/pulls`, { title: input.title, head: input.head, base: input.base, body: input.body });
  return { repo: input.repo, numero: pr.number, url: pr.html_url };
}

export async function commentOn(db: Db, input: { repo: string; number: number; text: string }) {
  assertRepo(input.repo);
  const comment = await call<{ html_url: string }>(db, "POST", `/repos/${input.repo}/issues/${input.number}/comments`, { body: input.text });
  return { repo: input.repo, numero: input.number, url: comment.html_url };
}
