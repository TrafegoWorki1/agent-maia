import { describe, expect, it, vi } from "vitest";
import { classify, groupJoinFrom } from "../server/evolutionWebhook.ts";
import { toInboxRow } from "../server/inbox.ts";
import { notifyGroupJoin } from "../server/groupJoin.ts";
import type { Db } from "../server/store.ts";

// Decisão do owner (13/10/2026): quando alguém entra num grupo cadastrado, a Maia avisa o dono (ela não dá boas-vindas sozinha).
const JID = "120363000000000000@g.us";
const joinBody = (event: string, action = "add") => ({
  event,
  instance: "worki",
  data: { id: JID, action, participants: ["558591872784@s.whatsapp.net"] },
});

describe("entrada em grupo", () => {
  it("reconhece o evento com ponto e o em maiúsculas com _", () => {
    expect(classify(joinBody("group-participants.update") as never)).toBe("group_change");
    expect(classify(joinBody("GROUP_PARTICIPANTS_UPDATE") as never)).toBe("group_change");
  });

  it("extrai o grupo, a ação e o número de quem entrou", () => {
    expect(groupJoinFrom(joinBody("GROUP_PARTICIPANTS_UPDATE"))).toEqual({ jid: JID, action: "add", participants: ["558591872784"] });
  });

  it("aceita participante em formato de objeto e ignora evento de outro tipo ou grupo sem jid", () => {
    const obj = { event: "group-participants.update", data: { id: JID, action: "add", participants: [{ id: "558591872784@lid" }] } };
    expect(groupJoinFrom(obj)?.participants).toEqual(["558591872784"]);
    expect(groupJoinFrom({ event: "messages.upsert", data: {} })).toBeNull();
    expect(groupJoinFrom({ event: "group-participants.update", data: { id: "x", action: "add", participants: ["1"] } })).toBeNull();
  });

  it("na fila, uma entrada vira evento com o join, e uma saída continua só reset de cache", () => {
    const row = toInboxRow(joinBody("group-participants.update"), undefined, undefined, undefined, new Date());
    expect(row?.sender).toBe("group");
    expect(JSON.parse(String(row?.payload)).join.jid).toBe(JID);
    const leave = toInboxRow(joinBody("group-participants.update", "remove"), undefined, undefined, undefined, new Date());
    expect(leave?.payload).toBe("cache_reset");
  });

  it("documento num grupo cadastrado vira referência na fila, sem baixar nada", () => {
    const groups = new Map([[JID, {}]]);
    const body = {
      event: "messages.upsert",
      instance: "worki",
      data: { key: { remoteJid: JID, fromMe: false, id: "M1", participant: "558591872784@s.whatsapp.net" }, pushName: "Ítalo", message: { documentMessage: { mimetype: "application/pdf", fileName: "produto.pdf", fileLength: 120000 } } },
    };
    const row = toInboxRow(body, undefined, undefined, groups, new Date());
    expect(row?.kind).toBe("media");
    expect(row?.sender).toBe("group");
    const payload = JSON.parse(String(row?.payload));
    expect(payload).toMatchObject({ jid: JID, participant: "558591872784", mediaType: "document", fileName: "produto.pdf" });
    expect(toInboxRow(body, undefined, undefined, new Map(), new Date())?.kind).toBe("event");
  });

  it("avisa o dono só para grupo cadastrado, com o nome da agenda, e não avisa o próprio dono", async () => {
    const db = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: table === "maia_groups" ? { name: "Projeto Ítalo" } : null }), then: (r: (v: unknown) => void) => r({ data: table === "contacts" ? [{ number: "5585991872784", name: "Ítalo", aliases: [] }] : [], error: null }) };
        return Object.assign(chain, q);
      },
    } as unknown as Db;
    const notify = vi.fn(async (_text: string) => {});
    process.env.EVOLUTION_OWNER_NUMBER = "EVOLUTION_OWNER_NUMBER";
    const join = { jid: JID, action: "add", participants: ["5585991872784", "EVOLUTION_OWNER_NUMBER"] };
    expect(await notifyGroupJoin(db, join, notify)).toBe(1);
    expect(notify.mock.calls[0][0]).toBe('Ítalo (+5585991872784) entrou no grupo "Projeto Ítalo". Quer que eu dê as boas-vindas?');
  });

  it("não avisa nada quando o grupo não está cadastrado", async () => {
    const db = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) } as unknown as Db;
    const notify = vi.fn(async (_text: string) => {});
    expect(await notifyGroupJoin(db, { jid: JID, action: "add", participants: ["5585991872784"] }, notify)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});
