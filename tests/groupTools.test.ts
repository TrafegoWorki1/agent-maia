import { describe, expect, it } from "vitest";
import { parsePoll, pickGroup, validatePoll, validateRunAt, validateText, withMentionTags } from "../server/groupTools.ts";

const groups = [
  { jid: "1@g.us", subject: "Operacional Worki Digital", size: 2 },
  { jid: "2@g.us", subject: "Tráfego", size: 5 },
  { jid: "3@g.us", subject: "Duplicado", size: 1 },
  { jid: "4@g.us", subject: "duplicado", size: 1 },
];

describe("grupo pelo nome", () => {
  it("acha sem acento e maiúsculas", () => {
    expect(pickGroup(groups, "trafego")).toMatchObject({ ok: true, group: { jid: "2@g.us" } });
  });
  it("recusa nome inexistente ou repetido", () => {
    expect(pickGroup(groups, "Outro").ok).toBe(false);
    expect(pickGroup(groups, "Duplicado").ok).toBe(false);
  });
});

describe("menções e validações", () => {
  it("coloca @número no texto quando falta", () => {
    expect(withMentionTags("Bom dia", ["5585992494552"])).toBe("Bom dia @5585992494552");
    expect(withMentionTags("Oi @5585992494552", ["5585992494552"])).toBe("Oi @5585992494552");
  });
  it("valida texto, enquete e horário", () => {
    expect(validateText("  ")).not.toBeNull();
    expect(validateText("ok")).toBeNull();
    expect(validatePoll("Qual dia?", ["Seg", "Ter"], 1)).toBeNull();
    expect(validatePoll("Qual dia?", ["Seg"], 1)).not.toBeNull();
    expect(validatePoll("Qual dia?", ["Seg", "seg"], 1)).not.toBeNull();
    expect(validatePoll("Qual dia?", ["Seg", "Ter"], 3)).not.toBeNull();
    const now = new Date("2026-10-09T12:00:00Z");
    expect(validateRunAt("2026-10-09T12:00:30Z", now).ok).toBe(false);
    expect(validateRunAt("2026-10-10T12:00:00Z", now).ok).toBe(true);
    expect(validateRunAt("2027-10-10T12:00:00Z", now).ok).toBe(false);
    expect(validateRunAt("amanhã", now).ok).toBe(false);
  });
});

describe("leitura de enquete", () => {
  it("conta o último voto de cada pessoa", () => {
    const poll = parsePoll({
      messageTimestamp: 1760000000,
      message: { pollCreationMessage: { name: "Dia da call?", options: [{ optionName: "Seg" }, { optionName: "Ter" }] } },
      pollUpdates: [
        { sender: "a", vote: { selectedOptions: ["Seg"] } },
        { sender: "b", vote: { selectedOptions: ["Seg"] } },
        { sender: "a", vote: { selectedOptions: ["Ter"] } },
      ],
    });
    expect(poll?.options).toEqual([{ name: "Seg", votes: 1 }, { name: "Ter", votes: 1 }]);
    expect(poll?.voters).toBe(2);
  });
  it("sem dados de voto, a contagem fica nula", () => {
    const poll = parsePoll({ message: { pollCreationMessage: { name: "X?", options: [{ optionName: "A" }, { optionName: "B" }] } } });
    expect(poll?.options[0].votes).toBeNull();
    expect(poll?.voters).toBeNull();
  });
  it("ignora mensagem que não é enquete", () => {
    expect(parsePoll({ message: { conversation: "oi" } })).toBeNull();
  });
});

