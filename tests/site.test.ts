import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { requiresApproval } from "../server/approvalPolicy.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";
import { describeAction } from "../server/actionDescriptions.ts";
import { siteTools } from "../server/siteTools.ts";
import { VercelError } from "../server/integrations/vercel.ts";
import type { Db } from "../server/store.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });
const db = {} as Db;

describe("política da ferramenta site_publicar", () => {
  it("está no inventário", () => {
    expect(isKnownMcpTool("mcp__maia__site_publicar")).toBe(true);
  });
  it("sempre exige OK (commit no GitHub)", () => {
    expect(requiresApproval("mcp__maia__site_publicar")).toBe(true);
  });
  it("owner pede e recebe OK pendente", () => {
    expect(decideAccess("mcp__maia__site_publicar", owner, {}, false).decision).toBe("approve");
  });
  it("membro sem a permissão site.publicar é negado, sem virar pedido de OK", () => {
    expect(decideAccess("mcp__maia__site_publicar", member("escrita.pedir", "mensagem.enviar"), {}, false).decision).toBe("deny");
  });
  it("membro com site.publicar recebe OK pendente, igual ao owner", () => {
    expect(decideAccess("mcp__maia__site_publicar", member("site.publicar"), {}, false).decision).toBe("approve");
  });
  it("em grupo, nega mesmo para o owner", () => {
    expect(decideAccess("mcp__maia__site_publicar", { ...owner, groupScope: { jid: "120@g.us" } } as Requester, {}, false).decision).toBe("deny");
  });
  it("a aprovação descreve a ação com o slug e a mensagem do commit", () => {
    expect(describeAction("mcp__maia__site_publicar", { slug: "landing-promo", mensagem: "primeira versão" })).toContain("landing-promo");
  });
});

describe("ferramenta site_publicar: execução", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  let githubResponder: (method: string) => { status?: number; body: unknown };
  let vercelResponder: (() => { status?: number; body: unknown }) | null;

  beforeEach(() => {
    calls.length = 0;
    process.env.GITHUB_TOKEN = "ghp_teste";
    process.env.VERCEL_TOKEN = "vercel_teste";
    process.env.MAIA_SITES_REPO = "worki/sites";
    vercelResponder = () => ({ body: { url: "landing-promo.vercel.app", readyState: "READY", id: "dpl_1" } });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const method = String(init.method);
      calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("api.vercel.com")) {
        const { status = 200, body } = vercelResponder!();
        return new Response(JSON.stringify(body), { status });
      }
      const { status = 200, body } = githubResponder(method);
      return new Response(JSON.stringify(body), { status });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_TOKEN;
    delete process.env.VERCEL_TOKEN;
    delete process.env.MAIA_SITES_REPO;
  });

  it("comita no repositório fixo e devolve a URL do deploy", async () => {
    githubResponder = (method) => method === "GET" ? { status: 404, body: { message: "Not Found" } } : { body: { commit: { sha: "abc1234", html_url: "https://github.com/worki/sites/commit/abc1234" } } };
    const tool = siteTools.find((t) => t.name === "site_publicar")!;
    const result = await tool.run(db, { slug: "landing-promo", html: "<html></html>", mensagem: "primeira versão" }) as Record<string, unknown>;
    expect(result).toMatchObject({ commitUrl: "https://github.com/worki/sites/commit/abc1234", repo: "worki/sites", deployUrl: "https://landing-promo.vercel.app", deployEstado: "READY" });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toContain("/repos/worki/sites/contents/sites/landing-promo/index.html");
    const deploy = calls.find((c) => c.url.includes("api.vercel.com"))!;
    expect(deploy.body).toMatchObject({ name: "landing-promo", target: "production" });
  });

  it("falha da Vercel não derruba a resposta: o commit ainda é informado", async () => {
    githubResponder = (method) => method === "GET" ? { status: 404, body: { message: "Not Found" } } : { body: { commit: { sha: "def5678", html_url: "https://github.com/worki/sites/commit/def5678" } } };
    vercelResponder = () => ({ status: 500, body: { error: { message: "internal error" } } });
    const tool = siteTools.find((t) => t.name === "site_publicar")!;
    const result = await tool.run(db, { slug: "landing-promo", html: "<html></html>", mensagem: "primeira versão" }) as Record<string, unknown>;
    expect(result.commitUrl).toBe("https://github.com/worki/sites/commit/def5678");
    expect(result.deployUrl).toBeNull();
    expect(String(result.aviso)).toContain("deploy na Vercel falhou");
  });

  it("sem MAIA_SITES_REPO configurado, recusa antes de chamar a rede", async () => {
    delete process.env.MAIA_SITES_REPO;
    githubResponder = () => ({ body: {} });
    const tool = siteTools.find((t) => t.name === "site_publicar")!;
    await expect(tool.run(db, { slug: "landing-promo", html: "<html></html>", mensagem: "x" })).rejects.toThrow(/MAIA_SITES_REPO/);
    expect(calls).toEqual([]);
  });

  it("recusa slug inválido antes de chamar a rede", async () => {
    githubResponder = () => ({ body: {} });
    const tool = siteTools.find((t) => t.name === "site_publicar")!;
    await expect(tool.run(db, { slug: "Landing Promo!", html: "<html></html>", mensagem: "x" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("erro da Vercel nunca contém o token", async () => {
    githubResponder = (method) => method === "GET" ? { status: 404, body: {} } : { body: { commit: { sha: "aaa0000", html_url: "u" } } };
    vercelResponder = () => ({ status: 401, body: { error: { message: "Not authorized" } } });
    const tool = siteTools.find((t) => t.name === "site_publicar")!;
    const result = await tool.run(db, { slug: "x", html: "<html></html>", mensagem: "m" }) as Record<string, unknown>;
    expect(String(result.aviso)).not.toContain("vercel_teste");
    expect(String(result.aviso)).toContain("Not authorized");
  });
});

describe("VercelError", () => {
  it("é uma classe de erro distinta", () => {
    expect(new VercelError("x")).toBeInstanceOf(Error);
  });
});
