import { describe, expect, it, vi } from "vitest";
import { classify, groupJoinFrom } from "../server/evolutionWebhook.ts";
import { toInboxRow } from "../server/inbox.ts";
import { notifyGroupJoin, resolveJoinNumbers } from "../server/groupJoin.ts";
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
    process.env.EVOLUTION_OWNER_NUMBER = "5511988886666";
    const join = { jid: JID, action: "add", participants: ["5585991872784", "5511988886666"] };
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

describe("quem entrou vem pelo identificador interno (@lid)", () => {
  const LID = "159554305835854";
  const participants = [{ number: "5511988887777", lid: LID, isAdmin: false }, { number: "5511988886666", lid: "999", isAdmin: false }];
  const lookup = async () => ({ ok: true as const, participants });

  it("lê o telefone (phoneNumber) quando o participante vem como objeto", () => {
    const body = { event: "GROUP_PARTICIPANTS_UPDATE", data: { id: JID, action: "add", participants: [{ id: `${LID}@lid`, phoneNumber: "5511988887777@s.whatsapp.net" }] } };
    expect(groupJoinFrom(body)?.participants).toEqual(["5511988887777"]);
  });

  it("troca o identificador interno pelo telefone da lista de participantes do grupo", async () => {
    expect(await resolveJoinNumbers({ jid: JID, action: "add", participants: [LID] }, lookup, 0)).toEqual(["5511988887777"]);
    expect(await resolveJoinNumbers({ jid: JID, action: "add", participants: ["5585991872784"] }, lookup, 0)).toEqual(["5585991872784"]);
  });

  it("se não achar o telefone nem na segunda tentativa, devolve o identificador como veio", async () => {
    const empty = async () => ({ ok: true as const, participants: [] });
    expect(await resolveJoinNumbers({ jid: JID, action: "add", participants: [LID] }, empty, 0)).toEqual([LID]);
  });

  it("o plano que esperava o número retoma mesmo com a entrada vindo pelo identificador interno", async () => {
    const rows: Record<string, any>[] = [{ id: 2, created_at: new Date().toISOString(), title: "Projeto", request: "", steps: [{ text: "a", done: false }], status: "active", waiting: { type: "member_joined", jid: JID, number: "5511988887777" }, context: {} }];
    const db = {
      from(table: string) {
        const filters: ((r: any) => boolean)[] = [];
        let patch: any = null;
        const q: any = {
          select: () => q,
          update: (p: any) => { patch = p; return q; },
          eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
          not: (c: string, _i: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
          order: () => q,
          maybeSingle: async () => ({ data: table === "maia_groups" ? { name: "Projeto Italo Teste" } : null }),
          then: (res: (v: unknown) => void) => {
            if (table === "maia_plans") { const hit = rows.filter((r) => filters.every((f) => f(r))); if (patch) hit.forEach((r) => Object.assign(r, patch)); res({ data: hit, error: null }); }
            else res({ data: table === "contacts" ? [{ number: "5511988887777", name: "Herickson pessoal", aliases: [] }] : [], error: null });
          },
        };
        return q;
      },
    } as unknown as Db;
    const notify = vi.fn(async (_t: string) => {});
    const resume = vi.fn(async (_p: string) => {});
    process.env.EVOLUTION_OWNER_NUMBER = "5511988886666";
    const result = await notifyGroupJoin(db, { jid: JID, action: "add", participants: [LID] }, notify, resume, lookup);
    expect(result).toBe(0);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
