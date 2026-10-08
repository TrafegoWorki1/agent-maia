import { describe, expect, it } from "vitest";
import { audioFrom, classify, incomingText, samePhone, tokenFromRequest, tokenMatches, normalizeEvent } from "../server/evolutionWebhook.ts";

describe("webhook da Evolution", () => {
  it("compara o segredo com segurança e rejeita ausente ou errado", () => {
    expect(tokenMatches("abc123", "abc123")).toBe(true);
    expect(tokenMatches("abc124", "abc123")).toBe(false);
    expect(tokenMatches("abc", "abc123")).toBe(false);
    expect(tokenMatches(null, "abc123")).toBe(false);
    expect(tokenMatches("abc123", undefined)).toBe(false);
  });

  it("aceita o segredo na query ou no header x-webhook-token", () => {
    expect(tokenFromRequest("q", "h")).toBe("q");
    expect(tokenFromRequest(null, "h")).toBe("h");
    expect(tokenFromRequest(null, ["h1", "h2"])).toBe("h1");
    expect(tokenFromRequest(null, undefined)).toBeNull();
  });

  it("triagem: conexão, voto de enquete, mensagem e desconhecido", () => {
    expect(classify({ event: "connection.update" })).toBe("connection");
    expect(classify({ event: "messages.upsert", data: { message: { pollUpdateMessage: {} } } })).toBe("poll_vote");
    expect(classify({ event: "messages.upsert", data: { message: { conversation: "oi" } } })).toBe("message");
    expect(classify({ event: "messages.upsert", data: { message: { audioMessage: {} } } })).toBe("message");
    expect(classify({ event: "qrcode.updated" })).toBe("unknown");
  });

  it("compara números brasileiros com e sem o nono dígito", () => {
    expect(samePhone("5585998372658", "558598372658")).toBe(true);
    expect(samePhone("558598372658", "5585998372658")).toBe(true);
    expect(samePhone("5585992494552", "558592494552")).toBe(true);
    expect(samePhone("5585992494552", "5585998372658")).toBe(false);
    expect(samePhone(undefined, "5585998372658")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });

  it("normaliza sem guardar o conteúdo da mensagem", () => {
    const e = normalizeEvent({ event: "messages.upsert", instance: "x", data: { message: { conversation: "segredo pessoal" } } });
    expect(e).not.toBeNull();
    expect(JSON.stringify(e)).not.toContain("segredo pessoal");
    expect(normalizeEvent({ event: 1 })).toBeNull();
  });
});

describe("áudio recebido", () => {
  const audioEvent = (fromMe: boolean) => ({
    event: "messages.upsert",
    data: {
      key: { id: "AUD1", remoteJid: "5585998372658@s.whatsapp.net", fromMe },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true } },
    },
  });

  it("reconhece nota de voz do remetente e guarda a referência para baixar", () => {
    expect(audioFrom(audioEvent(false))).toEqual({
      key: { id: "AUD1", remoteJid: "5585998372658@s.whatsapp.net", fromMe: false },
      mimetype: "audio/ogg; codecs=opus",
      from: "5585998372658",
    });
  });

  it("ignora áudio enviado pela própria conta e texto comum", () => {
    expect(audioFrom(audioEvent(true))).toBeNull();
    expect(audioFrom({ event: "messages.upsert", data: { key: { remoteJid: "5585998372658@s.whatsapp.net" }, message: { conversation: "oi" } } })).toBeNull();
    expect(incomingText(audioEvent(false))).toBeNull();
  });
});
