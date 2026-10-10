import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findChats, findInstanceContacts, markMessagesRead } from "../server/chats.ts";

describe("conversas e contatos da instância (só leitura)", () => {
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("findChats distingue grupo de privado e limita a quantidade", async () => {
    const rows = [
      { id: "120363@g.us", name: "Operacional", updatedAt: "2026-10-10T10:00:00Z" },
      { id: "5585911112222@s.whatsapp.net", pushName: "Jéssica" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const result = await findChats(1);
    expect(result).toMatchObject({ ok: true, chats: [{ jid: "120363@g.us", name: "Operacional", isGroup: true }] });
  });

  it("findInstanceContacts acha por nome ou número, nunca grupos", async () => {
    const rows = [
      { id: "5585911112222@s.whatsapp.net", pushName: "Jéssica" },
      { id: "120363@g.us", name: "Grupo" },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    const byName = await findInstanceContacts("jessica");
    expect(byName).toMatchObject({ ok: true, contacts: [{ number: "5585911112222", name: "Jéssica" }] });
    const byNumber = await findInstanceContacts("5585911112222");
    expect(byNumber).toMatchObject({ ok: true, contacts: [{ number: "5585911112222" }] });
  });

  it("HTTP de erro não lança exceção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect((await findChats()).ok).toBe(false);
    expect((await findInstanceContacts("x")).ok).toBe(false);
  });

  it("sem a Evolution configurada, avisa sem tentar a rede", async () => {
    delete process.env.EVOLUTION_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await findChats()).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("marcar mensagem como lida (markMessagesRead)", () => {
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("manda remoteJid, fromMe e o id de cada mensagem", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await markMessagesRead("5585911112222@s.whatsapp.net", ["MSG1", "MSG2"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/markMessageAsRead/i");
    expect(JSON.parse(init.body as string)).toEqual({
      readMessages: [
        { remoteJid: "5585911112222@s.whatsapp.net", fromMe: false, id: "MSG1" },
        { remoteJid: "5585911112222@s.whatsapp.net", fromMe: false, id: "MSG2" },
      ],
    });
  });

  it("sem ids, não chama a rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await markMessagesRead("x@s.whatsapp.net", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP de erro lança (quem chama decide ignorar; é cosmético)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(markMessagesRead("x@s.whatsapp.net", ["MSG1"])).rejects.toThrow("500");
  });

  it("sem a Evolution configurada, lança sem tentar a rede", async () => {
    delete process.env.EVOLUTION_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(markMessagesRead("x@s.whatsapp.net", ["MSG1"])).rejects.toThrow("não configurada");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
