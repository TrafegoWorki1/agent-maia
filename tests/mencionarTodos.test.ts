import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../server/outboundReceipts.ts", () => ({ recordAcceptedOutbound: vi.fn().mockResolvedValue(undefined) }));
import { everyMemberNumbers, sendGroupText, withMentionTags } from "../server/groupTools.ts";

// Menção a todos: marca cada participante com número válido do grupo (a Evolution não tem um "@todos" próprio).
describe("menção a todos do grupo", () => {
  const saved = { url: process.env.EVOLUTION_API_URL, instance: process.env.EVOLUTION_INSTANCE, key: process.env.EVOLUTION_API_KEY };
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo.com";
    process.env.EVOLUTION_INSTANCE = "inst1";
    process.env.EVOLUTION_API_KEY = "k";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.EVOLUTION_API_URL = saved.url; process.env.EVOLUTION_INSTANCE = saved.instance; process.env.EVOLUTION_API_KEY = saved.key;
  });

  const stubParticipants = (participants: unknown[]) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ participants }), { status: 200 })));

  it("marca todos os números válidos, sem repetir e sem os que já foram pedidos", async () => {
    stubParticipants([
      { id: "5511988886666@s.whatsapp.net", admin: "admin" },
      { id: "5511988887777@s.whatsapp.net" },
      { id: "5511988887777@s.whatsapp.net" },
      { id: "123@lid" },
      { jid: "5585911112222@s.whatsapp.net" },
    ]);
    const r = await everyMemberNumbers("grupo@g.us", ["5585911112222"]);
    expect(r).toEqual({ ok: true, numbers: ["5511988886666", "5511988887777"] });
  });

  it("recusa quando o grupo não tem nenhum número válido", async () => {
    stubParticipants([{ id: "abc@lid" }]);
    expect(await everyMemberNumbers("grupo@g.us")).toMatchObject({ ok: false });
  });

  it("recusa quando a Evolution não responde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await everyMemberNumbers("grupo@g.us")).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 500/) });
  });

  it("as menções visíveis entram no texto como @número", () => {
    expect(withMentionTags("Reunião hoje às 15h", ["5511988887777"])).toBe("Reunião hoje às 15h @5511988887777");
  });

  // Menção fantasma: todos recebem o aviso, mas o texto não mostra número nenhum.
  it("a menção fantasma notifica todos e deixa o texto limpo", async () => {
    let sent: { text?: string; mentioned?: string[] } = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ key: { id: "MSG1" } }), { status: 201 }); }));
    const id = await sendGroupText("grupo@g.us", "Reunião hoje às 15h", [], ["5511988887777", "5511988886666"]);
    expect(id).toBe("MSG1");
    expect(sent.text).toBe("Reunião hoje às 15h");
    expect(sent.mentioned).toEqual(["5511988887777", "5511988886666"]);
  });

  it("menção visível e fantasma juntas: só a visível aparece no texto, sem repetir ninguém", async () => {
    let sent: { text?: string; mentioned?: string[] } = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ key: { id: "MSG2" } }), { status: 201 }); }));
    await sendGroupText("grupo@g.us", "Oi", ["5511988887777"], ["5511988887777", "5511988886666"]);
    expect(sent.text).toBe("Oi @5511988887777");
    expect(sent.mentioned).toEqual(["5511988887777", "5511988886666"]);
  });

  it("sem menções, o campo mentioned nem é enviado", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ key: { id: "MSG3" } }), { status: 201 }); }));
    await sendGroupText("grupo@g.us", "Oi", []);
    expect("mentioned" in sent).toBe(false);
  });
});
