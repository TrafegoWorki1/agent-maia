import { describe, expect, it } from "vitest";
import { activateIntegration, callIntegration, fillBody, listIntegrations, proposeIntegration, resolveUrl, validSecretRef } from "../server/integrationCatalog.ts";
import { decideAccess, type Requester } from "../server/access.ts";
import { isReadTool, requiresApproval } from "../server/approvalPolicy.ts";
import type { Db } from "../server/store.ts";

// Banco de mentira: uma tabela em memória com o mínimo de encadeamento que o módulo usa.
function fakeDb(initial: Array<Record<string, unknown>>) {
  const rows: Array<Record<string, unknown>> = initial.map((r, i) => ({ id: i + 1, ...r }));
  const db = {
    from(_table: string) {
      let filter: [string, unknown] | null = null;
      const pick = () => rows.filter((r) => !filter || r[filter[0]] === filter[1]);
      const api: Record<string, unknown> = {
        select: () => api,
        order: () => Promise.resolve({ data: pick(), error: null }),
        eq: (k: string, v: unknown) => { filter = [k, v]; return api; },
        maybeSingle: () => Promise.resolve({ data: pick()[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => { rows.push({ id: rows.length + 1, ...row }); return Promise.resolve({ error: null }); },
        update: (patch: Record<string, unknown>) => ({ eq: (k: string, v: unknown) => { rows.filter((r) => r[k] === v).forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }); } }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: pick(), error: null }),
      };
      return api;
    },
  };
  return { db: db as unknown as Db, rows };
}

const ENV = { EVOLUTION_API_URL: "https://evo.exemplo.com", EVOLUTION_INSTANCE: "inst1", EVOLUTION_API_KEY: "chave-super-secreta", INTEGRACAO_X_TOKEN: "tok123" };
const REACT = {
  slug: "whatsapp_reagir", title: "Reagir", description: "d", method: "POST", url_template: "{EVOLUTION_API_URL}/message/sendReaction/{EVOLUTION_INSTANCE}",
  body_template: { key: { remoteJid: "{{remoteJid}}", fromMe: "{{fromMe}}", id: "{{id}}" }, reaction: "{{reaction}}" },
  auth_style: "apikey_header", auth_header: "apikey", secret_ref: "EVOLUTION_API_KEY", risk: "interna", status: "active", required_permission: "integracao.usar",
};

describe("segredos e URL", () => {
  it("só aceita INTEGRACAO_* ou a chave da Evolution como referência de segredo", () => {
    expect(validSecretRef("INTEGRACAO_SERVICOX_TOKEN")).toBe(true);
    expect(validSecretRef("EVOLUTION_API_KEY")).toBe(true);
    for (const bad of ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "integracao_x", "INTEGRACAO_", "PATH"]) expect(validSecretRef(bad)).toBe(false);
  });

  it("monta a URL só com variáveis permitidas e exige https público", () => {
    expect(resolveUrl("{EVOLUTION_API_URL}/a/{EVOLUTION_INSTANCE}", ENV)).toMatchObject({ ok: true });
    expect(resolveUrl("{SUPABASE_URL}/x", ENV)).toMatchObject({ ok: false });
    expect(resolveUrl("http://api.exemplo.com/x", ENV)).toMatchObject({ ok: false });
    expect(resolveUrl("https://127.0.0.1/x", ENV)).toMatchObject({ ok: false });
    expect(resolveUrl("https://192.168.0.5/x", ENV)).toMatchObject({ ok: false });
    expect(resolveUrl("https://user:senha@api.exemplo.com/x", ENV)).toMatchObject({ ok: false });
  });
});

describe("corpo da chamada", () => {
  it("preserva booleano e rejeita parâmetro faltando ou não previsto", () => {
    const tpl = { key: { fromMe: "{{fromMe}}" }, texto: "oi {{nome}}" };
    expect(fillBody(tpl, { fromMe: "false", nome: "Ana" })).toEqual({ ok: true, body: { key: { fromMe: false }, texto: "oi Ana" } });
    expect(fillBody(tpl, { fromMe: true })).toMatchObject({ ok: false });
    expect(fillBody(tpl, { fromMe: true, nome: "A", extra: "x" })).toMatchObject({ ok: false });
  });
});

describe("chamada de integração", () => {
  const params = { remoteJid: "1@g.us", id: "ABC", fromMe: "false", reaction: "👍" };

  it("chama o endpoint ativo com a chave no cabeçalho e nunca devolve o segredo", async () => {
    const { db } = fakeDb([REACT]);
    let seen: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (url: URL, init: RequestInit) => { seen = { url: String(url), init }; return new Response('{"eco":"chave-super-secreta"}', { status: 201 }); }) as unknown as typeof fetch;
    const r = await callIntegration(db, "whatsapp_reagir", params, { env: ENV, fetchImpl });
    expect(r).toMatchObject({ ok: true, status: 201 });
    expect(r.ok && r.body).not.toContain("chave-super-secreta");
    expect(seen.url).toBe("https://evo.exemplo.com/message/sendReaction/inst1");
    expect((seen.init?.headers as Record<string, string>).apikey).toBe("chave-super-secreta");
    expect(JSON.parse(String(seen.init?.body))).toEqual({ key: { remoteJid: "1@g.us", fromMe: false, id: "ABC" }, reaction: "👍" });
    expect(seen.init?.redirect).toBe("manual");
  });

  it("recusa integração pendente, inexistente, sem segredo e redirecionamento", async () => {
    const never = (async () => { throw new Error("não devia chamar"); }) as unknown as typeof fetch;
    expect(await callIntegration(fakeDb([{ ...REACT, status: "pending" }]).db, "whatsapp_reagir", params, { env: ENV, fetchImpl: never })).toMatchObject({ ok: false });
    expect(await callIntegration(fakeDb([]).db, "nada_aqui", {}, { env: ENV, fetchImpl: never })).toMatchObject({ ok: false });
    expect(await callIntegration(fakeDb([REACT]).db, "whatsapp_reagir", params, { env: { ...ENV, EVOLUTION_API_KEY: undefined }, fetchImpl: never })).toMatchObject({ ok: false });
    const redirect = (async () => new Response("", { status: 302, headers: { location: "https://mal.com" } })) as unknown as typeof fetch;
    expect(await callIntegration(fakeDb([REACT]).db, "whatsapp_reagir", params, { env: ENV, fetchImpl: redirect })).toMatchObject({ ok: false });
  });

  it("a chave da Evolution não sai para outro endereço", async () => {
    const other = { ...REACT, url_template: "https://api.outro.com/reagir" };
    const never = (async () => { throw new Error("não devia chamar"); }) as unknown as typeof fetch;
    const r = await callIntegration(fakeDb([other]).db, "whatsapp_reagir", params, { env: ENV, fetchImpl: never });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/só pode ser usada/) });
  });
});

describe("proposta e ativação", () => {
  const base = { slug: "servicox_enviar", titulo: "ServicoX", descricao: "Envia", metodo: "POST" as const, url: "https://api.servicox.com/v1/enviar", auth: "bearer" as const, segredo: "INTEGRACAO_SERVICOX_TOKEN", risco: "interna" as const };

  it("nasce pendente e não aceita segredo fora do prefixo nem endereço interno", async () => {
    const { db, rows } = fakeDb([]);
    expect(await proposeIntegration(db, base)).toMatchObject({ ok: true });
    expect(rows[0]).toMatchObject({ status: "pending", secret_ref: "INTEGRACAO_SERVICOX_TOKEN", required_permission: "integracao.usar" });
    expect(await proposeIntegration(db, { ...base, slug: "outra_coisa", segredo: "SUPABASE_SERVICE_ROLE_KEY" })).toMatchObject({ ok: false });
    expect(await proposeIntegration(db, { ...base, slug: "outra_coisa", segredo: "EVOLUTION_API_KEY" })).toMatchObject({ ok: false });
    expect(await proposeIntegration(db, { ...base, slug: "outra_coisa", url: "https://localhost/x" })).toMatchObject({ ok: false });
    expect(await proposeIntegration(db, base)).toMatchObject({ ok: false });
  });

  it("só ativa quando o segredo existe no servidor", async () => {
    const { db, rows } = fakeDb([{ ...REACT, slug: "servicox_enviar", status: "pending", url_template: "https://api.servicox.com/v1/enviar", secret_ref: "INTEGRACAO_SERVICOX_TOKEN" }]);
    expect(await activateIntegration(db, "servicox_enviar", ENV)).toMatchObject({ ok: false });
    expect(rows[0].status).toBe("pending");
    expect(await activateIntegration(db, "servicox_enviar", { ...ENV, INTEGRACAO_SERVICOX_TOKEN: "x" })).toMatchObject({ ok: true });
    expect(rows[0].status).toBe("active");
  });

  it("a listagem mostra se o segredo está configurado, sem revelar valor", async () => {
    const list = await listIntegrations(fakeDb([REACT]).db, ENV);
    expect(list[0]).toMatchObject({ slug: "whatsapp_reagir", destino: "evo.exemplo.com", segredo_configurado: true });
    expect(JSON.stringify(list)).not.toContain("chave-super-secreta");
  });
});

describe("acesso às ferramentas do catálogo", () => {
  const owner: Requester = { role: "owner", name: "H", number: "1", permissions: new Set() };
  const member = (perms: string[]): Requester => ({ role: "member", name: "M", number: "2", permissions: new Set(perms) });

  it("ativar sempre pede aprovação; propor é só do dono; listar é leitura", () => {
    expect(requiresApproval("mcp__maia__integracao_ativar")).toBe(true);
    expect(decideAccess("mcp__maia__integracao_ativar", owner, {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__integracao_propor", owner, {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__integracao_propor", member(["escrita.pedir"]), {}, false).decision).toBe("approve");
    expect(isReadTool("mcp__maia__integracao_listar")).toBe(true);
  });

  it("membro só chama com integracao.usar; o dono chama direto", () => {
    expect(decideAccess("mcp__maia__integracao_chamar", owner, {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__integracao_chamar", member([]), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__integracao_chamar", member(["escrita.pedir"]), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__integracao_chamar", member(["integracao.usar"]), {}, false).decision).toBe("allow");
  });

  it("integração externa pede OK a cada uso, até para o dono", () => {
    expect(requiresApproval("mcp__maia__integracao_chamar_externa")).toBe(true);
    expect(decideAccess("mcp__maia__integracao_chamar_externa", owner, {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__integracao_chamar_externa", member(["integracao.usar"]), {}, false).decision).toBe("approve");
  });
});

describe("parâmetros na URL e nível externa", () => {
  const GROUP = { ...REACT, slug: "whatsapp_grupo_renomear", method: "POST", risk: "externa", url_template: "{EVOLUTION_API_URL}/group/updateGroupSubject/{EVOLUTION_INSTANCE}?groupJid={{grupo_jid}}", body_template: { subject: "{{nome}}" } };

  it("parâmetro só entra na consulta e sempre codificado", () => {
    const ok = resolveUrl("{EVOLUTION_API_URL}/g/{EVOLUTION_INSTANCE}?groupJid={{grupo_jid}}", ENV, { grupo_jid: "1@g.us&x=1" });
    expect(ok.ok && ok.url.search).toBe("?groupJid=1%40g.us%26x%3D1");
    expect(resolveUrl("{EVOLUTION_API_URL}/g/{{caminho}}", ENV, { caminho: "../x" })).toMatchObject({ ok: false });
    expect(resolveUrl("https://{{host}}/x", ENV, { host: "mal.com" })).toMatchObject({ ok: false });
    expect(resolveUrl("{EVOLUTION_API_URL}/g?groupJid={{grupo_jid}}", ENV, {})).toMatchObject({ ok: false, error: expect.stringMatching(/falta o parâmetro/) });
  });

  it("externa só roda pela ferramenta externa, e a interna não roda pela externa", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const p = { grupo_jid: "1@g.us", nome: "Novo" };
    expect(await callIntegration(fakeDb([GROUP]).db, "whatsapp_grupo_renomear", p, { env: ENV, fetchImpl })).toMatchObject({ ok: false, error: expect.stringMatching(/integracao_chamar_externa/) });
    expect(await callIntegration(fakeDb([GROUP]).db, "whatsapp_grupo_renomear", p, { env: ENV, fetchImpl, risks: ["externa"] })).toMatchObject({ ok: true });
    expect(await callIntegration(fakeDb([REACT]).db, "whatsapp_reagir", { remoteJid: "a", id: "b", fromMe: "false", reaction: "👍" }, { env: ENV, fetchImpl, risks: ["externa"] })).toMatchObject({ ok: false, error: expect.stringMatching(/integracao_chamar/) });
  });

  it("parâmetro usado só na URL conta como usado; o que sobra é recusado", async () => {
    const getOnly = { ...REACT, slug: "whatsapp_convite_info", method: "GET", body_template: null, url_template: "{EVOLUTION_API_URL}/group/inviteInfo/{EVOLUTION_INSTANCE}?inviteCode={{codigo}}", risk: "leitura" };
    let called = "";
    const fetchImpl = (async (url: URL) => { called = String(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await callIntegration(fakeDb([getOnly]).db, "whatsapp_convite_info", { codigo: "ABC" }, { env: ENV, fetchImpl })).toMatchObject({ ok: true });
    expect(called).toBe("https://evo.exemplo.com/group/inviteInfo/inst1?inviteCode=ABC");
    expect(await callIntegration(fakeDb([getOnly]).db, "whatsapp_convite_info", { codigo: "ABC", sobra: "x" }, { env: ENV, fetchImpl })).toMatchObject({ ok: false, error: expect.stringMatching(/não previsto/) });
  });
});
