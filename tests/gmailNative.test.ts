import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { describeAction } from "../server/actionDescriptions.ts";
import { isReadTool, requiresApproval } from "../server/approvalPolicy.ts";
import { gmailTools } from "../server/gmailTools.ts";
import { buildMimeMessage, GmailError, parseMessageSummary, replyEmail, searchMessages, sendEmail, unreadCount } from "../server/integrations/gmailNative.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...permissions: string[]): Requester => ({ role: "member", personId: "p1", name: "Jéssica", number: "5585911112222", permissions: new Set(permissions) });
const TOKEN = "ya29.token-gmail-secreto";

describe("política das ferramentas nativas do Gmail", () => {
  it("registra todas no inventário", () => {
    for (const tool of gmailTools) expect(isKnownMcpTool(`mcp__maia__${tool.name}`), tool.name).toBe(true);
  });
  it("reconhece consultas e exige aprovação em envio e resposta", () => {
    expect(isReadTool("mcp__maia__email_nao_lidos")).toBe(true);
    expect(isReadTool("mcp__maia__email_buscar")).toBe(true);
    for (const name of ["email_enviar", "email_responder"]) {
      expect(isReadTool(`mcp__maia__${name}`)).toBe(false);
      expect(requiresApproval(`mcp__maia__${name}`)).toBe(true);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, false).decision).toBe("approve");
    }
  });
  it("membro precisa de gmail.ler para consultar", () => {
    expect(decideAccess("mcp__maia__email_buscar", member("gmail.ler"), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__email_buscar", member(), {}, true).decision).toBe("approve");
  });
  it("descreve o e-mail sem expor corpo nem nome técnico", () => {
    const text = describeAction("mcp__maia__email_enviar", { para: ["ana@exemplo.com"], assunto: "Proposta", texto: "segredo" });
    expect(text).toContain("Proposta");
    expect(text).toContain("ana@exemplo.com");
    expect(text).not.toContain("segredo");
  });
});

describe("montagem e validação pura do Gmail", () => {
  it("monta MIME UTF-8 em base64url", () => {
    const built = buildMimeMessage({ to: ["ana@exemplo.com"], subject: "Olá", text: "Linha 1\nLinha 2", cc: ["time@exemplo.com"] });
    expect(built.ok).toBe(true);
    const mime = built.ok ? Buffer.from(built.raw, "base64url").toString("utf8") : "";
    expect(mime).toContain("To: ana@exemplo.com");
    expect(mime).toContain("Cc: time@exemplo.com");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Linha 1\r\nLinha 2");
  });
  it("recusa destinatário, assunto e corpo inválidos e neutraliza quebra em cabeçalho", () => {
    expect(buildMimeMessage({ to: ["x"], subject: "a", text: "b" }).ok).toBe(false);
    expect(buildMimeMessage({ to: ["a@b.com"], subject: " ", text: "b" }).ok).toBe(false);
    expect(buildMimeMessage({ to: ["a@b.com"], subject: "a", text: " " }).ok).toBe(false);
    const built = buildMimeMessage({ to: ["a@b.com"], subject: "Oi\r\nBcc: invasor@x.com", text: "ok" });
    const mime = built.ok ? Buffer.from(built.raw, "base64url").toString("utf8") : "";
    expect(mime.match(/^Bcc:/gm)).toBeNull();
  });
  it("mensagem sem evidência bruta é recusada", () => {
    expect(() => parseMessageSummary({ snippet: "texto" })).toThrow(GmailError);
  });
});

describe("cliente da Gmail API (rede mockada)", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  let responder: (url: string, method: string) => { status?: number; body: unknown };

  beforeEach(() => {
    calls.length = 0;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "refresh";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3600 }), { status: 200 });
      calls.push({ url, method: String(init.method ?? "GET"), body: init.body ? JSON.parse(String(init.body)) : null });
      const answer = responder(url, String(init.method ?? "GET"));
      return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  });

  it("conta não lidos pela label UNREAD", async () => {
    responder = () => ({ body: { messagesUnread: 17 } });
    await expect(unreadCount()).resolves.toBe(17);
    expect(calls[0].url).toContain("/labels/UNREAD");
  });
  it("busca IDs e carrega metadados das mensagens", async () => {
    responder = (url) => url.includes("/messages?")
      ? { body: { messages: [{ id: "m1", threadId: "t1" }] } }
      : { body: { id: "m1", threadId: "t1", snippet: "Trecho", payload: { headers: [{ name: "From", value: "Ana <ana@exemplo.com>" }, { name: "Subject", value: "Proposta" }, { name: "Date", value: "Thu" }] } } };
    await expect(searchMessages("from:ana", 5)).resolves.toEqual([{ id: "m1", threadId: "t1", from: "Ana <ana@exemplo.com>", subject: "Proposta", date: "Thu", snippet: "Trecho" }]);
  });
  it("envio só confirma com ID e threadId", async () => {
    responder = () => ({ body: { id: "sent1", threadId: "thread1" } });
    await expect(sendEmail({ to: ["ana@exemplo.com"], subject: "Oi", text: "Tudo bem?" })).resolves.toEqual({ id: "sent1", threadId: "thread1" });
    expect(calls[0].body?.raw).toBeTypeOf("string");
    responder = () => ({ body: {} });
    await expect(sendEmail({ to: ["ana@exemplo.com"], subject: "Oi", text: "Tudo bem?" })).rejects.toThrow(/não devolveu ID/);
  });
  it("responde na thread e usa Reply-To/Message-ID da mensagem original", async () => {
    responder = (url, method) => method === "GET"
      ? { body: { id: "m1", threadId: "t1", payload: { headers: [{ name: "Reply-To", value: "resposta@exemplo.com" }, { name: "Subject", value: "Assunto" }, { name: "Message-ID", value: "<orig@example>" }] } } }
      : { body: { id: "m2", threadId: "t1" } };
    await expect(replyEmail("m1", "Minha resposta")).resolves.toEqual({ id: "m2", threadId: "t1" });
    expect(calls[1].body?.threadId).toBe("t1");
    const mime = Buffer.from(String(calls[1].body?.raw), "base64url").toString("utf8");
    expect(mime).toContain("To: resposta@exemplo.com");
    expect(mime).toContain("In-Reply-To: <orig@example>");
  });
  it("erro de autenticação não expõe o token", async () => {
    responder = () => ({ status: 403, body: { error: { message: TOKEN } } });
    const error = await unreadCount().catch((e) => e) as GmailError;
    expect(error).toBeInstanceOf(GmailError);
    expect(error.message).toContain("recusou a autenticação");
    expect(error.message).not.toContain(TOKEN);
  });
});
