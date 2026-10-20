import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { isReadTool, requiresApproval } from "../server/approvalPolicy.ts";
import { describeAction } from "../server/actionDescriptions.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";
import { githubTools } from "../server/githubTools.ts";
import { ciStatus, commentOn, createBranch, createPullRequest, createRepo, GithubError, listIssues, saveFile } from "../server/integrations/github.ts";
import type { Db } from "../server/store.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });
const db = {} as Db;
const TOKEN = "ghp_tokenDeTeste1234567890";

const READS = ["github_repos_listar", "github_prs_listar", "github_issues_listar", "github_ci_status"];
const FREE_WRITES = ["github_repo_criar", "github_branch_criar"];
const APPROVED_WRITES = ["github_arquivo_salvar", "github_pr_criar", "github_comentar"];

describe("política das ferramentas do GitHub", () => {
  it("todas estão no inventário", () => {
    for (const name of [...READS, ...FREE_WRITES, ...APPROVED_WRITES]) expect(isKnownMcpTool(`mcp__maia__${name}`), name).toBe(true);
  });
  it("leitura é livre para o owner no privado", () => {
    for (const name of READS) {
      expect(isReadTool(`mcp__maia__${name}`), name).toBe(true);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, true).decision, name).toBe("allow");
    }
  });
  it("criar repositório e branch não pedem OK", () => {
    for (const name of FREE_WRITES) {
      expect(requiresApproval(`mcp__maia__${name}`), name).toBe(false);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, false).decision, name).toBe("allow");
    }
  });
  it("commit, pull request e comentário pedem OK, inclusive do owner", () => {
    for (const name of APPROVED_WRITES) {
      expect(requiresApproval(`mcp__maia__${name}`), name).toBe(true);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, false).decision, name).toBe("approve");
    }
  });
  it("membro e grupo são negados, mesmo com permissões de escrita", () => {
    for (const name of [...READS, ...FREE_WRITES, ...APPROVED_WRITES]) {
      expect(decideAccess(`mcp__maia__${name}`, member("escrita.pedir", "mensagem.enviar"), {}, false).decision, name).toBe("deny");
      expect(decideAccess(`mcp__maia__${name}`, { ...owner, groupScope: { jid: "120@g.us" } } as Requester, {}, false).decision, name).toBe("deny");
    }
  });
  it("não existe ferramenta de apagar, merge, tornar público ou push forçado", () => {
    expect(githubTools.map((t) => t.name).filter((n) => /(apagar|excluir|delete|merge|publico|visibilidade|force)/i.test(n))).toEqual([]);
    expect(githubTools.map((t) => t.name).sort()).toEqual([...READS, ...FREE_WRITES, ...APPROVED_WRITES].sort());
  });
  it("a aprovação descreve a ação, não o nome técnico", () => {
    expect(describeAction("mcp__maia__github_arquivo_salvar", { repo: "a/b", caminho: "index.html", mensagem: "primeira versão" })).toContain("index.html");
    expect(describeAction("mcp__maia__github_pr_criar", { repo: "a/b", titulo: "Novo site", de: "feat", para: "main" })).toContain("Novo site");
    expect(describeAction("mcp__maia__github_comentar", { repo: "a/b", numero: 7, texto: "ok" })).toContain("#7");
  });
});

describe("cliente do GitHub", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null; auth: string | null }> = [];
  let responder: (url: string, method: string) => { status?: number; body: unknown };

  beforeEach(() => {
    calls.length = 0;
    process.env.GITHUB_TOKEN = TOKEN;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization ?? null });
      const { status = 200, body } = responder(url, String(init.method));
      return new Response(JSON.stringify(body), { status });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
  });

  it("repositório novo é sempre criado privado, e usa o token do ambiente", async () => {
    responder = () => ({ body: { full_name: "dono/site", private: true, html_url: "https://github.com/dono/site", default_branch: "main" } });
    const created = await createRepo(db, { name: "site" });
    expect(created).toMatchObject({ repo: "dono/site", privado: true, url: "https://github.com/dono/site" });
    expect(calls[0].body).toMatchObject({ name: "site", private: true });
    expect(calls[0].auth).toBe(`Bearer ${TOKEN}`);
  });

  it("avisa se o GitHub não devolver o repositório como privado", async () => {
    responder = () => ({ body: { full_name: "dono/site", private: false, html_url: "x" } });
    await expect(createRepo(db, { name: "site" })).rejects.toThrow(/privado/);
  });

  it("recusa nomes e caminhos inválidos antes de chamar a rede", async () => {
    responder = () => ({ body: {} });
    await expect(createRepo(db, { name: "../x" })).rejects.toThrow(GithubError);
    await expect(createRepo(db, { name: ".." })).rejects.toThrow(GithubError);
    await expect(ciStatus(db, "sem-barra")).rejects.toThrow(/dono\/nome/);
    await expect(ciStatus(db, "a/..")).rejects.toThrow(GithubError);
    await expect(saveFile(db, { repo: "a/b", path: "../segredo", content: "x", message: "m" })).rejects.toThrow(/Caminho/);
    await expect(saveFile(db, { repo: "a/b", path: "/abs", content: "x", message: "m" })).rejects.toThrow(/Caminho/);
    await expect(saveFile(db, { repo: "a/b", path: ".github/workflows/ci.yml", content: "x", message: "m" })).rejects.toThrow(/workflow/);
    await expect(createBranch(db, { repo: "a/b", branch: "a..b" })).rejects.toThrow(/branch/i);
    expect(calls).toEqual([]);
  });

  it("arquivo novo: grava em base64 sem sha; arquivo existente: envia o sha", async () => {
    responder = (_url, method) => method === "GET" ? { status: 404, body: { message: "Not Found" } } : { body: { commit: { sha: "abcdef123456", html_url: "https://github.com/a/b/commit/abcdef1" } } };
    const created = await saveFile(db, { repo: "a/b", path: "src/index.html", content: "olá", message: "primeira versão", branch: "feat" });
    expect(created).toMatchObject({ acao: "criado", commit: "abcdef1" });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/repos/a/b/contents/src/index.html");
    expect(put.body).toMatchObject({ message: "primeira versão", content: Buffer.from("olá").toString("base64"), branch: "feat" });
    expect(put.body).not.toHaveProperty("sha");

    calls.length = 0;
    responder = (_url, method) => method === "GET" ? { body: { sha: "sha-antigo" } } : { body: { commit: { sha: "1234567890" } } };
    expect(await saveFile(db, { repo: "a/b", path: "index.html", content: "v2", message: "atualiza" })).toMatchObject({ acao: "atualizado" });
    expect(calls.find((c) => c.method === "PUT")!.body).toMatchObject({ sha: "sha-antigo" });
  });

  it("branch nova parte da principal quando não se diz de onde", async () => {
    responder = (url) => url.endsWith("/repos/a/b") ? { body: { default_branch: "main" } } : url.includes("/git/ref/heads/main") ? { body: { object: { sha: "SHA1" } } } : { body: { ref: "refs/heads/feat" } };
    expect(await createBranch(db, { repo: "a/b", branch: "feat" })).toEqual({ repo: "a/b", branch: "feat", a_partir_de: "main" });
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ ref: "refs/heads/feat", sha: "SHA1" });
  });

  it("pull request e comentário devolvem a URL como evidência", async () => {
    responder = () => ({ body: { number: 5, html_url: "https://github.com/a/b/pull/5" } });
    expect(await createPullRequest(db, { repo: "a/b", title: "T", head: "feat", base: "main" })).toMatchObject({ numero: 5, url: "https://github.com/a/b/pull/5" });
    responder = () => ({ body: { html_url: "https://github.com/a/b/issues/5#c1" } });
    expect(await commentOn(db, { repo: "a/b", number: 5, text: "oi" })).toMatchObject({ url: expect.stringContaining("#c1") });
  });

  it("lista de issues não inclui pull requests", async () => {
    responder = () => ({ body: [{ number: 1, title: "bug", state: "open", html_url: "u1" }, { number: 2, title: "PR", state: "open", html_url: "u2", pull_request: {} }] });
    expect((await listIssues(db, "a/b")).map((i) => i.numero)).toEqual([1]);
  });

  it("erro da API vira mensagem clara e nunca contém o token", async () => {
    responder = () => ({ status: 401, body: { message: "Bad credentials" } });
    const error = await ciStatus(db, "a/b").catch((e: Error) => e);
    expect((error as Error).message).toBe("GitHub respondeu 401: Bad credentials");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("sem token configurado, explica onde configurar", async () => {
    delete process.env.GITHUB_TOKEN;
    responder = () => ({ body: [] });
    await expect(ciStatus(db, "a/b")).rejects.toThrow(/GITHUB_TOKEN/);
    expect(calls).toEqual([]);
  });

  it("a ferramenta valida a entrada antes de chamar o cliente", async () => {
    const tool = githubTools.find((t) => t.name === "github_repo_criar")!;
    await expect(tool.run(db, {})).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
