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

  it("grupo cadastrado: todo texto entra, marcando se chamou a Maia", () => {
    const OP = "120363412181825151@g.us";
    const msg = (text: string, fromMe = false) => ({ event: "messages.upsert", instance: "wt_test", data: { pushName: "Herickson", key: { id: "G2", remoteJid: OP, fromMe, participant: "5585992494552@s.whatsapp.net" }, message: { conversation: text } } });
    const row = toInboxRow(msg("Maia, a reunião foi ótima"), OWNER, APPROVER, new Map([[OP, {}]]));
    expect(row).toMatchObject({ kind: "text", sender: "group" });
    expect(JSON.parse(row!.payload!)).toEqual({ jid: OP, participant: "5585992494552", name: "Herickson", text: "Maia, a reunião foi ótima", addressed: true });
    expect(JSON.parse(toInboxRow(msg("Bom dia pessoal"), OWNER, APPROVER, new Map([[OP, {}]]))!.payload!)).toMatchObject({ text: "Bom dia pessoal", addressed: false });
    expect(JSON.parse(toInboxRow(msg("a Maiara chegou"), OWNER, APPROVER, new Map([[OP, {}]]))!.payload!)).toMatchObject({ addressed: false });
    expect(toInboxRow(msg("Maia, ok", true), OWNER, APPROVER, new Map([[OP, {}]]))).toMatchObject({ kind: "event" });
    expect(toInboxRow(msg("Maia, oi"), OWNER, APPROVER)).toMatchObject({ kind: "event", payload: OP });
  });

  it("grupo operacional: continuação, resposta e menção também valem", () => {
    const OP = "120363412181825151@g.us";
    const now = new Date("2026-10-09T17:13:00Z");
    const base = (text: string, extra: Record<string, unknown> = {}, participant = "5585992494552@s.whatsapp.net") => ({
      event: "messages.upsert", instance: "wt_test", sender: "5585900000000@s.whatsapp.net",
      data: { pushName: "Herickson", key: { id: "G4", remoteJid: OP, fromMe: false, participant }, message: extra.message ?? { conversation: text } },
    });
    const state = new Map([[OP, { lastReplyAt: "2026-10-09T17:08:00Z", lastReplyTo: "5585992494552" }]]);
    // continuação da conversa com a mesma pessoa, sem dizer "Maia"
    expect(toInboxRow(base("Cria uma planilha e depois me envia o link aqui!"), OWNER, APPROVER, state, now)).toMatchObject({ kind: "text" });
    // outra pessoa, sem chamar: guardada na memória do grupo, mas sem resposta
    expect(JSON.parse(toInboxRow(base("Cria uma planilha", {}, "5511999999999@s.whatsapp.net"), OWNER, APPROVER, state, now)!.payload!)).toMatchObject({ addressed: false });
    // fora da janela de 10 minutos
    expect(JSON.parse(toInboxRow(base("Cria uma planilha"), OWNER, APPROVER, state, new Date("2026-10-09T17:30:00Z"))!.payload!)).toMatchObject({ addressed: false });
    // resposta (citação) a uma mensagem da Maia
    const quoted = base("sim", { message: { extendedTextMessage: { text: "sim", contextInfo: { participant: "5585900000000@s.whatsapp.net" } } } });
    expect(toInboxRow(quoted, OWNER, APPROVER, new Map([[OP, {}]]), now)).toMatchObject({ kind: "text" });
  });

  it("membro autorizado (conversa.maia) fala com a Maia no privado; sem a permissão, nada entra", () => {
    const members = new Set(["5585911112222"]);
    const dm = (from: string) => message(from, { pushName: "Jéssica", message: { conversation: "Preciso de ajuda" } });
    const row = toInboxRow(dm("5585911112222"), OWNER, APPROVER, undefined, new Date(), undefined, members);
    expect(row).toMatchObject({ kind: "text", sender: "member" });
    expect(JSON.parse(row!.payload!)).toEqual({ from: "5585911112222", name: "Jéssica", text: "Preciso de ajuda" });
    // sem estar na lista de membros, a mensagem não guarda o texto
    expect(toInboxRow(dm("5585911112222"), OWNER, APPROVER, undefined, new Date(), undefined, new Set())).toMatchObject({ kind: "event", sender: "other", payload: null });
    // membro tem prioridade sobre "contatado": se for membro, nunca cai no fluxo de contato/outreach
    const contacted = new Set(["5585911112222"]);
    expect(toInboxRow(dm("5585911112222"), OWNER, APPROVER, undefined, new Date(), contacted, members)).toMatchObject({ sender: "member" });
  });

  it("áudio de membro autorizado guarda a referência, com quem mandou", () => {
    const members = new Set(["5585911112222"]);
    const audio = message("5585911112222", { pushName: "Jéssica", message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } });
    const row = toInboxRow(audio, OWNER, APPROVER, undefined, new Date(), undefined, members);
    expect(row).toMatchObject({ kind: "audio", sender: "member" });
    expect(JSON.parse(row!.payload!)).toMatchObject({ mimetype: "audio/ogg; codecs=opus", from: "5585911112222", name: "Jéssica" });
    expect(toInboxRow(audio, OWNER, APPROVER, undefined, new Date(), undefined, new Set())).toMatchObject({ kind: "event", sender: "other", payload: null });
  });

  it("resposta de quem a Maia contatou entra com texto; de outros não", () => {
    const dm = (from: string) => message(from, { pushName: "Jéssica", message: { conversation: "Já resolvi!" } });
    const contacted = new Set(["5585911112222"]);
    const row = toInboxRow(dm("5585911112222"), OWNER, APPROVER, undefined, new Date(), contacted);
    expect(row).toMatchObject({ kind: "text", sender: "other" });
    expect(JSON.parse(row!.payload!)).toMatchObject({ name: "Jéssica", text: "Já resolvi!" });
    expect(toInboxRow(dm("5511999999999"), OWNER, APPROVER, undefined, new Date(), contacted)).toMatchObject({ kind: "event", sender: "other", payload: null });
  });

  it("grupo novo: só o dono, chamando a Maia, cadastra o grupo", () => {
    const NEW = "120363999@g.us";
    const msg = (text: string, participant: string) => ({ event: "messages.upsert", instance: "wt_test", data: { key: { id: "G3", remoteJid: NEW, fromMe: false, participant: participant + "@s.whatsapp.net" }, message: { conversation: text } } });
    const row = toInboxRow(msg("Maia, cadastra este grupo", OWNER), OWNER, APPROVER, new Map());
    expect(row).toMatchObject({ kind: "text", sender: "group" });
    expect(JSON.parse(row!.payload!)).toMatchObject({ jid: NEW, register: true });
    expect(toInboxRow(msg("Maia, passa a atender aqui", OWNER), OWNER, APPROVER, new Map())).toMatchObject({ kind: "text" });
    expect(toInboxRow(msg("Maia, cadastra este grupo", "5511999999999"), OWNER, APPROVER, new Map())).toMatchObject({ kind: "event", payload: NEW });
    expect(toInboxRow(msg("Maia, bom dia", OWNER), OWNER, APPROVER, new Map())).toMatchObject({ kind: "event", payload: NEW });
  });

  it("mensagem de grupo vira atividade, sem texto", () => {
    const group = { event: "messages.upsert", instance: "wt_test", data: { key: { id: "G1", remoteJid: "120363@g.us", fromMe: false }, message: { conversation: "oi" } } };
    expect(toInboxRow(group, OWNER, APPROVER)).toEqual({ kind: "event", sender: "group", key_id: "G1", payload: "120363@g.us" });
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
