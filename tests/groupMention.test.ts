import { afterEach, describe, expect, it } from "vitest";
import { mentionsMaiaByTag } from "../server/groupMention.ts";
import { toInboxRow } from "../server/inbox.ts";

// Incidente de 12/10/2026: a menção à Maia veio com o identificador interno (@lid, 15 dígitos) e foi ignorada porque o
// sistema só comparava com o telefone.
const LID = "123456789012345";
const PHONE = "558586661513";
const OWNER = "5585992494552";
const OP = "120363412181825151@g.us";
const GROUPS = new Map([[OP, {}]]);

function groupMessage(text: string, mentionedJid: string[] = [], participant = "5585911112222@s.whatsapp.net") {
  return {
    event: "messages.upsert",
    instance: "wt_test",
    sender: `${PHONE}@s.whatsapp.net`,
    data: {
      pushName: "Ana",
      key: { id: "K1", remoteJid: OP, fromMe: false, participant },
      message: { extendedTextMessage: { text, contextInfo: { mentionedJid } } },
    },
  };
}

describe("menção à Maia pelo texto", () => {
  it("reconhece @MAIA_LID e não confunde com outro número", () => {
    const env = { MAIA_LID: LID };
    expect(mentionsMaiaByTag(`@${LID} pode me ajudar?`, env)).toBe(true);
    expect(mentionsMaiaByTag(`oi @${LID}`, env)).toBe(true);
    expect(mentionsMaiaByTag(`@${LID}9 oi`, env)).toBe(false);
    expect(mentionsMaiaByTag("@999999999999999 oi", env)).toBe(false);
    expect(mentionsMaiaByTag(`@${LID} oi`, {})).toBe(false);
  });
});

describe("webhook: mensagem de grupo dirigida à Maia", () => {
  const original = process.env.MAIA_LID;
  afterEach(() => { if (original === undefined) delete process.env.MAIA_LID; else process.env.MAIA_LID = original; });

  const addressed = (row: unknown) => JSON.parse(String((row as { payload: string }).payload)).addressed as boolean;

  it("com MAIA_LID, a menção pelo identificador interno conta", () => {
    process.env.MAIA_LID = LID;
    const row = toInboxRow(groupMessage(`@${LID} pode ajudar?`, [`${LID}@lid`]), OWNER, undefined, GROUPS);
    expect(addressed(row)).toBe(true);
  });

  it("sem MAIA_LID, a menção pelo identificador interno não conta (comportamento anterior)", () => {
    delete process.env.MAIA_LID;
    const row = toInboxRow(groupMessage(`@${LID} pode ajudar?`, [`${LID}@lid`]), OWNER, undefined, GROUPS);
    expect(addressed(row)).toBe(false);
  });

  it("a menção pelo telefone continua valendo", () => {
    delete process.env.MAIA_LID;
    const row = toInboxRow(groupMessage(`@${PHONE} oi`, [`${PHONE}@s.whatsapp.net`]), OWNER, undefined, GROUPS);
    expect(addressed(row)).toBe(true);
  });

  it("mencionar outra pessoa não chama a Maia", () => {
    process.env.MAIA_LID = LID;
    const row = toInboxRow(groupMessage("@987654321098765 oi", ["987654321098765@lid"]), OWNER, undefined, GROUPS);
    expect(addressed(row)).toBe(false);
  });

  // Resposta por citação: a pessoa toca em uma mensagem da Maia. O texto não tem marca; só o contextInfo diz quem foi citado.
  const quoted = (participant: string) => ({
    event: "messages.upsert",
    instance: "wt_test",
    sender: `${PHONE}@s.whatsapp.net`,
    data: {
      pushName: "Ana",
      key: { id: "K2", remoteJid: OP, fromMe: false, participant: "5585911112222@s.whatsapp.net" },
      message: { extendedTextMessage: { text: "sim, pode fazer", contextInfo: { participant } } },
    },
  });

  it("resposta por citação a uma mensagem da Maia, citada pelo identificador interno, chama a Maia", () => {
    process.env.MAIA_LID = LID;
    expect(addressed(toInboxRow(quoted(`${LID}@lid`), OWNER, undefined, GROUPS))).toBe(true);
    delete process.env.MAIA_LID;
    expect(addressed(toInboxRow(quoted(`${LID}@lid`), OWNER, undefined, GROUPS))).toBe(false);
  });

  it("citar uma mensagem de outra pessoa não chama a Maia", () => {
    process.env.MAIA_LID = LID;
    expect(addressed(toInboxRow(quoted("987654321098765@lid"), OWNER, undefined, GROUPS))).toBe(false);
  });

  // Áudio em grupo: o webhook decide pela menção ou citação (contextInfo no nível de data); o nome só se sabe ao transcrever.
  const audio = (contextInfo: Record<string, unknown>) => ({
    event: "messages.upsert",
    instance: "wt_test",
    sender: `${PHONE}@s.whatsapp.net`,
    data: {
      pushName: "Ana",
      key: { id: "K3", remoteJid: OP, fromMe: false, participant: "5585911112222@s.whatsapp.net" },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
      contextInfo,
    },
  });

  it("áudio que cita a Maia ou a menciona pelo identificador interno chama a Maia", () => {
    process.env.MAIA_LID = LID;
    expect(toInboxRow(audio({ participant: `${LID}@lid` }), OWNER, undefined, GROUPS)).toMatchObject({ kind: "audio", sender: "group" });
    expect(addressed(toInboxRow(audio({ participant: `${LID}@lid` }), OWNER, undefined, GROUPS))).toBe(true);
    expect(addressed(toInboxRow(audio({ mentionedJid: [`${LID}@lid`] }), OWNER, undefined, GROUPS))).toBe(true);
    expect(addressed(toInboxRow(audio({ participant: "987654321098765@lid" }), OWNER, undefined, GROUPS))).toBe(false);
  });
});
