import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyMemberNumbers, withMentionTags } from "../server/groupTools.ts";

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
      { id: "EVOLUTION_OWNER_NUMBER@s.whatsapp.net", admin: "admin" },
      { id: "EVOLUTION_APPROVER_NUMBER@s.whatsapp.net" },
      { id: "EVOLUTION_APPROVER_NUMBER@s.whatsapp.net" },
      { id: "123@lid" },
      { jid: "5585911112222@s.whatsapp.net" },
    ]);
    const r = await everyMemberNumbers("grupo@g.us", ["5585911112222"]);
    expect(r).toEqual({ ok: true, numbers: ["EVOLUTION_OWNER_NUMBER", "EVOLUTION_APPROVER_NUMBER"] });
  });

  it("recusa quando o grupo não tem nenhum número válido", async () => {
    stubParticipants([{ id: "abc@lid" }]);
    expect(await everyMemberNumbers("grupo@g.us")).toMatchObject({ ok: false });
  });

  it("recusa quando a Evolution não responde", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await everyMemberNumbers("grupo@g.us")).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 500/) });
  });

  it("as menções entram no texto como @número", () => {
    expect(withMentionTags("Reunião hoje às 15h", ["EVOLUTION_APPROVER_NUMBER"])).toBe("Reunião hoje às 15h @EVOLUTION_APPROVER_NUMBER");
  });
});
