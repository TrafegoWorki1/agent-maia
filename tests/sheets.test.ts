import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { requiresApproval, isReadTool } from "../server/approvalPolicy.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";
import { describeAction } from "../server/actionDescriptions.ts";
import { decideDriveToolAccess } from "../server/resourceAccess.ts";
import { sheetsTools } from "../server/sheetsTools.ts";
import { a1, colIndex, deleteColumns, parseSpreadsheetId, readValues, SheetsError } from "../server/integrations/googleSheets.ts";
import type { Db } from "../server/store.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", personId: "p1", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });
const db = { from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }) } as unknown as Db;
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const TOKEN = "ya29.token-de-teste-1234567890";
const TOOLS = sheetsTools.map((t) => t.name);

describe("política das ferramentas de planilha", () => {
  it("todas estão no inventário", () => {
    for (const name of TOOLS) expect(isKnownMcpTool(`mcp__maia__${name}`), name).toBe(true);
  });
  it("leitura é consulta; escrita e apagar não são", () => {
    expect(isReadTool("mcp__maia__sheets_ler")).toBe(true);
    expect(isReadTool("mcp__maia__sheets_info")).toBe(true);
    expect(isReadTool("mcp__maia__sheets_escrever")).toBe(false);
  });
  it("apagar coluna e apagar aba pedem OK, inclusive do owner", () => {
    for (const name of ["sheets_apagar_coluna", "sheets_apagar_aba"]) {
      expect(requiresApproval(`mcp__maia__${name}`), name).toBe(true);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, false).decision, name).toBe("approve");
    }
  });
  it("escrita e criação ficam livres para o owner", () => {
    for (const name of ["sheets_escrever", "sheets_criar", "sheets_adicionar_aba", "sheets_inserir_coluna"]) {
      expect(requiresApproval(`mcp__maia__${name}`), name).toBe(false);
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, false).decision, name).toBe("allow");
    }
  });
  it("membro lê com sheets.ler e escreve com sheets.editar", () => {
    expect(decideAccess("mcp__maia__sheets_ler", member("sheets.ler"), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__sheets_escrever", member("sheets.ler"), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__sheets_escrever", member("sheets.editar"), {}, false).decision).toBe("allow");
  });
  it("membro bloqueado não lê nem escreve, mesmo com a permissão", () => {
    const blocked = { ...member("sheets.ler", "sheets.editar"), blockedPermissions: new Set(["sheets.ler", "sheets.editar"]) };
    expect(decideAccess("mcp__maia__sheets_ler", blocked, {}, true).decision).toBe("deny");
    expect(decideAccess("mcp__maia__sheets_escrever", blocked, {}, false).decision).toBe("deny");
  });
  it("grupo de cliente nega, mesmo para o owner", () => {
    const clientGroup = { ...owner, groupScope: { jid: "120@g.us", name: "Cliente X", clientId: "c1", clientName: "Cliente X", accessGroupId: null } } as Requester;
    for (const name of TOOLS) expect(decideAccess(`mcp__maia__${name}`, clientGroup, {}, false).decision, name).toBe("deny");
  });
  it("grupo interno Operacional vale como o privado: owner escreve, apagar pede OK", () => {
    const operacional = { jid: "999@g.us", name: "Operacional", clientId: null, clientName: null, accessGroupId: null };
    const inGroup = { ...owner, groupScope: operacional } as Requester;
    expect(decideAccess("mcp__maia__sheets_escrever", inGroup, {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__sheets_ler", inGroup, {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__sheets_apagar_coluna", inGroup, {}, false).decision).toBe("approve");
  });
  it("membro no grupo Operacional segue a permissão dele, como no privado", () => {
    const operacional = { jid: "999@g.us", name: "Operacional", clientId: null, clientName: null, accessGroupId: null };
    const withGroup = (who: Requester) => ({ ...who, groupScope: operacional }) as Requester;
    expect(decideAccess("mcp__maia__sheets_ler", withGroup(member("sheets.ler")), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__sheets_escrever", withGroup(member("sheets.ler")), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__sheets_escrever", withGroup(member("sheets.editar")), {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__sheets_ler", withGroup(member()), {}, true).decision).toBe("approve");
  });
  it("membro sem autorização na planilha é negado na checagem por recurso", async () => {
    const verdict = await decideDriveToolAccess(db, member("sheets.ler", "sheets.editar"), "mcp__maia__sheets_escrever", { planilha: SHEET_ID, valores: [["a"]] }, "whatsapp");
    expect(verdict?.decision).toBe("deny");
  });
  it("owner passa pela checagem por recurso", async () => {
    expect((await decideDriveToolAccess(db, owner, "mcp__maia__sheets_escrever", { planilha: SHEET_ID }, "whatsapp"))?.decision).toBe("allow");
  });
  it("criar planilha não exige planilha existente na checagem por recurso", async () => {
    expect((await decideDriveToolAccess(db, member("sheets.editar"), "mcp__maia__sheets_criar", { titulo: "Nova" }, "whatsapp"))?.decision).toBe("allow");
  });
  it("a aprovação descreve o que será apagado", () => {
    expect(describeAction("mcp__maia__sheets_apagar_coluna", { planilha: SHEET_ID, aba: "Vendas", coluna: "C", quantidade: 2 })).toContain("dados");
    expect(describeAction("mcp__maia__sheets_apagar_aba", { planilha: SHEET_ID, aba: "Vendas" })).toContain("Vendas");
  });
});

describe("entrada e endereços", () => {
  it("aceita ID ou link e recusa lixo", () => {
    expect(parseSpreadsheetId(SHEET_ID)).toBe(SHEET_ID);
    expect(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`)).toBe(SHEET_ID);
    expect(() => parseSpreadsheetId("nao é um id")).toThrow(SheetsError);
  });
  it("converte letra de coluna em índice", () => {
    expect(colIndex("A")).toBe(0);
    expect(colIndex("C")).toBe(2);
    expect(colIndex("aa")).toBe(26);
    expect(() => colIndex("1A")).toThrow(SheetsError);
  });
  it("aba com aspas no nome é escapada no endereço", () => {
    expect(a1("Vendas 'Q1'", "A1:B2")).toBe("'Vendas ''Q1'''!A1:B2");
  });
  it("ferramenta recusa escrita grande demais antes de chamar o Google", async () => {
    const tool = sheetsTools.find((t) => t.name === "sheets_escrever")!;
    const linha = Array.from({ length: 26 }, () => "x");
    const valores = Array.from({ length: 1000 }, () => linha);
    await expect(tool.run(db, { planilha: SHEET_ID, valores })).rejects.toThrow(/Muitas células/);
  });
});

describe("cliente do Google Sheets", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  let responder: (url: string, method: string) => { status?: number; body: unknown };

  beforeEach(() => {
    calls.length = 0;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "rtoken";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3600 }), { status: 200 });
      calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
      const { status = 200, body } = responder(url, String(init.method));
      return new Response(JSON.stringify(body), { status });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  });

  const meta = { spreadsheetId: SHEET_ID, properties: { title: "Vendas" }, sheets: [{ properties: { sheetId: 7, title: "Dados", gridProperties: { rowCount: 100, columnCount: 10 } } }] };

  it("lê uma aba pelo nome e devolve os valores", async () => {
    responder = (url) => url.includes("/values/") ? { body: { values: [["Nome", "Valor"], ["Ana", "10"]] } } : { body: meta };
    const data = await readValues(SHEET_ID, "Dados");
    expect(data).toMatchObject({ planilha: "Vendas", aba: "Dados", valores: [["Nome", "Valor"], ["Ana", "10"]] });
    expect(calls.find((c) => c.url.includes("/values/"))!.url).toContain(encodeURIComponent("'Dados'"));
  });

  it("apagar coluna envia deleteDimension com o índice certo", async () => {
    responder = (_url, method) => method === "GET" ? { body: meta } : { body: {} };
    await deleteColumns(SHEET_ID, "Dados", "C", 2);
    const batch = calls.find((c) => c.url.endsWith(":batchUpdate"))!;
    expect(batch.body).toEqual({ requests: [{ deleteDimension: { range: { sheetId: 7, dimension: "COLUMNS", startIndex: 2, endIndex: 4 } } }] });
  });

  it("erro 404 vira mensagem clara e nunca carrega o token", async () => {
    responder = () => ({ status: 404, body: { error: { message: "Requested entity was not found." } } });
    const error = await readValues(SHEET_ID).catch((e: Error) => e);
    expect((error as Error).message).toContain("planilha não encontrada");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("aba inexistente é recusada com a lista de abas disponíveis", async () => {
    responder = () => ({ body: meta });
    await expect(readValues(SHEET_ID, "Inexistente")).rejects.toThrow(/Dados/);
  });
});
