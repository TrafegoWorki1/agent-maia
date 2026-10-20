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
const SUBIR = "mcp__maia__site_subir_github";
const PUBLICAR = "mcp__maia__site_publicar_vercel";
const tool = (name: string) => siteTools.find((t) => t.name === name)!;

describe("política dos caminhos de site", () => {
  it("estão no inventário", () => {
    expect(isKnownMcpTool(SUBIR)).toBe(true);
    expect(isKnownMcpTool(PUBLICAR)).toBe(true);
  });
  it("subir no GitHub pede OK; publicar na Vercel não pede", () => {
    expect(requiresApproval(SUBIR)).toBe(true);
    expect(requiresApproval(PUBLICAR)).toBe(false);
  });
  it("owner: subir pede OK pendente; publicar é liberado", () => {
    expect(decideAccess(SUBIR, owner, {}, false).decision).toBe("approve");
    expect(decideAccess(PUBLICAR, owner, {}, false).decision).toBe("allow");
  });
  it("membro sem site.publicar é negado nos dois caminhos", () => {
    expect(decideAccess(SUBIR, member("escrita.pedir"), {}, false).decision).toBe("deny");
    expect(decideAccess(PUBLICAR, member("escrita.pedir"), {}, false).decision).toBe("deny");
  });
  it("membro com site.publicar: subir pede OK; publicar é liberado", () => {
    expect(decideAccess(SUBIR, member("site.publicar"), {}, false).decision).toBe("approve");
    expect(decideAccess(PUBLICAR, member("site.publicar"), {}, false).decision).toBe("allow");
  });
  it("em grupo, nega nos dois caminhos, mesmo para o owner", () => {
    const grupo = { ...owner, groupScope: { jid: "120@g.us", name: "Operacional", clientId: null, clientName: null, accessGroupId: null } } as Requester;
    expect(decideAccess(SUBIR, grupo, {}, false).decision).toBe("deny");
    expect(decideAccess(PUBLICAR, grupo, {}, false).decision).toBe("deny");
  });
  it("a aprovação de subir descreve slug e mensagem", () => {
    expect(describeAction(SUBIR, { slug: "landing-promo", mensagem: "primeira versão" })).toContain("landing-promo");
  });
});

describe("execução dos caminhos de site", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  let githubResponder: (method: string) => { status?: number; body: unknown };
  let vercelResponder: () => { status?: number; body: unknown };

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
        const { status = 200, body } = vercelResponder();
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

  const encoded = (text: string) => Buffer.from(text, "utf8").toString("base64");

  it("subir no GitHub grava sites/<slug>/index.html e não chama a Vercel", async () => {
    githubResponder = (method) => method === "GET" ? { status: 404, body: { message: "Not Found" } } : { body: { commit: { sha: "abc1234", html_url: "https://github.com/worki/sites/commit/abc1234" } } };
    const result = await tool("site_subir_github").run(db, { slug: "landing-promo", html: "<html></html>", mensagem: "primeira versão" }) as Record<string, unknown>;
    expect(result).toMatchObject({ commitUrl: "https://github.com/worki/sites/commit/abc1234", repo: "worki/sites", caminho: "sites/landing-promo/index.html", acao: "criado" });
    expect(calls.find((c) => c.method === "PUT")!.url).toContain("/repos/worki/sites/contents/sites/landing-promo/index.html");
    expect(calls.some((c) => c.url.includes("api.vercel.com"))).toBe(false);
  });

  it("publicar com HTML do pedido não lê o GitHub e manda o HTML para a Vercel", async () => {
    const result = await tool("site_publicar_vercel").run(db, { slug: "landing-promo", html: "<html>x</html>" }) as Record<string, unknown>;
    expect(result).toMatchObject({ deployUrl: "https://landing-promo.vercel.app", deployEstado: "READY", origem: "HTML do pedido" });
    expect(calls.some((c) => c.url.includes("api.github.com"))).toBe(false);
    const deploy = calls.find((c) => c.url.includes("api.vercel.com"))!;
    expect(deploy.body).toMatchObject({ name: "landing-promo", target: "production" });
    expect(JSON.stringify(deploy.body)).toContain(encoded("<html>x</html>"));
  });

  it("publicar sem HTML usa o arquivo já salvo no repositório", async () => {
    githubResponder = () => ({ body: { content: encoded("<html>do repo</html>"), encoding: "base64" } });
    const result = await tool("site_publicar_vercel").run(db, { slug: "landing-promo" }) as Record<string, unknown>;
    expect(result).toMatchObject({ origem: "repositório", deployUrl: "https://landing-promo.vercel.app" });
    expect(calls.find((c) => c.method === "GET")!.url).toContain("/repos/worki/sites/contents/sites/landing-promo/index.html");
    expect(JSON.stringify(calls.find((c) => c.url.includes("api.vercel.com"))!.body)).toContain(encoded("<html>do repo</html>"));
  });

  it("publicar sem arquivo no repositório recusa e não chama a Vercel", async () => {
    githubResponder = () => ({ status: 404, body: { message: "Not Found" } });
    await expect(tool("site_publicar_vercel").run(db, { slug: "landing-promo" })).rejects.toThrow(/Suba o site no GitHub/);
    expect(calls.some((c) => c.url.includes("api.vercel.com"))).toBe(false);
  });

  it("falha da Vercel é erro claro, sem token", async () => {
    vercelResponder = () => ({ status: 401, body: { error: { message: "Not authorized" } } });
    const error = await tool("site_publicar_vercel").run(db, { slug: "x", html: "<html></html>" }).catch((e: Error) => e);
    expect((error as Error).message).toContain("Not authorized");
    expect((error as Error).message).not.toContain("vercel_teste");
  });

  it("sem MAIA_SITES_REPO, recusa antes de chamar a rede", async () => {
    delete process.env.MAIA_SITES_REPO;
    githubResponder = () => ({ body: {} });
    await expect(tool("site_subir_github").run(db, { slug: "landing-promo", html: "<html></html>", mensagem: "x" })).rejects.toThrow(/MAIA_SITES_REPO/);
    await expect(tool("site_publicar_vercel").run(db, { slug: "landing-promo", html: "<html></html>" })).rejects.toThrow(/MAIA_SITES_REPO/);
    expect(calls).toEqual([]);
  });

  it("recusa slug inválido antes de chamar a rede", async () => {
    githubResponder = () => ({ body: {} });
    await expect(tool("site_subir_github").run(db, { slug: "Landing Promo!", html: "<html></html>", mensagem: "x" })).rejects.toThrow();
    await expect(tool("site_publicar_vercel").run(db, { slug: "Landing Promo!", html: "<html></html>" })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("VercelError", () => {
  it("é uma classe de erro distinta", () => {
    expect(new VercelError("x")).toBeInstanceOf(Error);
  });
});
