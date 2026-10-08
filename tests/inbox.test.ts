import { describe, expect, it } from "vitest";
import { toInboxRow } from "../server/inbox.ts";

const OWNER = "5585998372658";
const APPROVER = "5585992494552";

function message(from: string, extra: Record<string, unknown>, fromMe = false, event = "messages.upsert") {
  return {
    event,
    instance: "wt_test",
    data: { key: { id: "KEY1", remoteJid: `${from}@s.whatsapp.net`, fromMe }, ...extra },
  };
}

describe("triagem do webhook para a fila", () => {
  it("texto do dono vira linha de texto com o conteúdo", () => {
    expect(toInboxRow(message(OWNER, { message: { conversation: "oi" } }), OWNER, APPROVER)).toEqual({
      kind: "text",
      sender: "owner",
      key_id: "KEY1",
      payload: "oi",
    });
  });

  it("SIM do aprovador vira texto do aprovador", () => {
    expect(toInboxRow(message(APPROVER, { message: { conversation: "SIM" } }), OWNER, APPROVER)).toMatchObject({ sender: "approver", payload: "SIM" });
  });

  it("texto de outro número não guarda o conteúdo", () => {
    expect(toInboxRow(message("5511999999999", { message: { conversation: "segredo" } }), OWNER, APPROVER)).toEqual({
      kind: "event",
      sender: "other",
      key_id: "KEY1",
      payload: null,
    });
  });

  it("áudio do dono guarda só a referência para baixar", () => {
    const row = toInboxRow(message(OWNER, { message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } }), OWNER, APPROVER);
    expect(row).toMatchObject({ kind: "audio", sender: "owner" });
    expect(JSON.parse(row!.payload!)).toMatchObject({ mimetype: "audio/ogg; codecs=opus", key: { id: "KEY1" } });
  });

  it("mensagem de grupo vira atividade, sem texto", () => {
    const group = { event: "messages.upsert", instance: "wt_test", data: { key: { id: "G1", remoteJid: "120363@g.us", fromMe: false }, message: { conversation: "oi" } } };
    expect(toInboxRow(group, OWNER, APPROVER)).toEqual({ kind: "event", sender: "group", key_id: "G1", payload: null });
  });

  it("mensagem enviada pela própria conta não entra como conversa", () => {
    expect(toInboxRow(message(OWNER, { message: { conversation: "resposta da Maia" } }, true), OWNER, APPROVER)).toMatchObject({ sender: "none", payload: null });
  });

  it("só mensagens novas usam a chave de dedupe", () => {
    const update = message(OWNER, { message: { conversation: "oi" } }, false, "messages.update");
    expect(toInboxRow(update, OWNER, APPROVER)?.key_id).toBeNull();
  });

  it("evento de conexão vira evento sem chave", () => {
    expect(toInboxRow({ event: "connection.update", instance: "wt_test", data: { state: "open" } }, OWNER, APPROVER)).toEqual({
      kind: "event",
      sender: "none",
      key_id: null,
      payload: null,
    });
  });

  it("rejeita corpo sem evento ou instância", () => {
    expect(toInboxRow({ data: {} }, OWNER, APPROVER)).toBeNull();
    expect(toInboxRow("texto solto", OWNER, APPROVER)).toBeNull();
  });
});
