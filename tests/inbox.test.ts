import { describe, expect, it } from "vitest";
import { toInboxRow } from "../server/inbox.ts";

const OWNER = "5511988887777";
const APPROVER = "5511988886666";

function message(from: string, extra: Record<string, unknown>, fromMe = false, event = "messages.upsert") {
  return {
    event,
    instance: "wt_test",
    data: { key: { id: "KEY1", remoteJid: `${from}@s.whatsapp.net`, fromMe }, ...extra },
  };
}

describe("contatos compartilhados", () => {
  const card = { displayName: "João Silva", vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:João Silva\nTEL;type=CELL:+5511999999999\nTEL;TYPE=WORK:+5521999999999\nEND:VCARD" };
  it("encaminha nome e telefones ao dono sem cadastrar automaticamente", () => {
    const row = toInboxRow(message(OWNER, { message: { contactMessage: card } }), OWNER, APPROVER);
    expect(row).toMatchObject({kind:"text", sender:"owner", key_id:"KEY1"});
    expect(row!.payload).toContain('"nome":"João Silva"');
    expect(row!.payload).toContain("+5511999999999");
    expect(row!.payload).toContain("+5521999999999");
  });
  it("preserva restrições para remetente desconhecido e a própria conta", () => {
    expect(toInboxRow(message("5511999999999", {message:{contactMessage:card}}), OWNER, APPROVER)).toMatchObject({sender:"other", payload:null});
    expect(toInboxRow(message(OWNER, {message:{contactMessage:card}}, true), OWNER, APPROVER)).toMatchObject({sender:"none", payload:null});
  });
  it("trata contatos de membro autorizado e múltiplos cartões", () => {
    const row = toInboxRow(message("5585911112222", {message:{contactsArrayMessage:{contacts:[card,{displayName:"Ana",vcard:"BEGIN:VCARD\nFN:Ana\nTEL:+5511888888888\nEND:VCARD"}]}}}), OWNER, APPROVER, undefined, new Date(), undefined, new Set(["5585911112222"]));
    expect(row).toMatchObject({sender:"member",kind:"text"});
    expect(JSON.parse(row!.payload!).text).toContain("+5511888888888");
  });
  it("não responde em grupo apenas porque o nome do contato contém Maia", () => {
    const jid="120363412181825151@g.us";
    const body={event:"messages.upsert",instance:"wt_test",data:{key:{id:"G",remoteJid:jid,fromMe:false,participant:"5511999999999@s.whatsapp.net"},message:{contactMessage:{...card,displayName:"Maia"}}}};
    const row=toInboxRow(body,OWNER,APPROVER,new Map([[jid,{}]]));
    expect(JSON.parse(row!.payload!)).toMatchObject({addressed:false});
  });
  it("ignora cartão inválido ou sem remetente", () => {
    expect(toInboxRow(message(OWNER,{message:{contactMessage:{vcard:42}}}),OWNER,APPROVER)).toMatchObject({kind:"event",payload:null});
    expect(toInboxRow({event:"messages.upsert",instance:"wt_test",data:{message:{contactMessage:card}}},OWNER,APPROVER)).toMatchObject({kind:"event",payload:null});
  });
});
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
    const msg = (text: string, fromMe = false) => ({ event: "messages.upsert", instance: "wt_test", data: { pushName: "Herickson", key: { id: "G2", remoteJid: OP, fromMe, participant: "5511988886666@s.whatsapp.net" }, message: { conversation: text } } });
    const row = toInboxRow(msg("Maia, a reunião foi ótima"), OWNER, APPROVER, new Map([[OP, {}]]));
    expect(row).toMatchObject({ kind: "text", sender: "group" });
    expect(JSON.parse(row!.payload!)).toEqual({ jid: OP, participant: "5511988886666", name: "Herickson", text: "Maia, a reunião foi ótima", addressed: true });
    expect(JSON.parse(toInboxRow(msg("Bom dia pessoal"), OWNER, APPROVER, new Map([[OP, {}]]))!.payload!)).toMatchObject({ text: "Bom dia pessoal", addressed: false });
    expect(JSON.parse(toInboxRow(msg("a Maiara chegou"), OWNER, APPROVER, new Map([[OP, {}]]))!.payload!)).toMatchObject({ addressed: false });
    expect(toInboxRow(msg("Maia, ok", true), OWNER, APPROVER, new Map([[OP, {}]]))).toMatchObject({ kind: "event" });
    expect(toInboxRow(msg("Maia, oi"), OWNER, APPROVER)).toMatchObject({ kind: "event", payload: OP });
  });

  it("grupo operacional: continuação, resposta e menção também valem", () => {
    const OP = "120363412181825151@g.us";
    const now = new Date("2026-10-09T17:13:00Z");
    const base = (text: string, extra: Record<string, unknown> = {}, participant = "5511988886666@s.whatsapp.net") => ({
      event: "messages.upsert", instance: "wt_test", sender: "5585900000000@s.whatsapp.net",
      data: { pushName: "Herickson", key: { id: "G4", remoteJid: OP, fromMe: false, participant }, message: extra.message ?? { conversation: text } },
    });
    const state = new Map([[OP, { lastReplyAt: "2026-10-09T17:08:00Z", lastReplyTo: "5511988886666" }]]);
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

  it("áudio em grupo cadastrado: guarda a referência; addressed vem de menção/resposta/conversa em andamento (nunca do nome, que só se sabe após transcrever)", () => {
    const OP = "120363412181825151@g.us";
    const now = new Date("2026-10-09T17:13:00Z");
    const audioMsg = (participant: string, extra: Record<string, unknown> = {}) => ({
      event: "messages.upsert", instance: "wt_test",
      data: { pushName: "Herickson", key: { id: "G5", remoteJid: OP, fromMe: false, participant: `${participant}@s.whatsapp.net` }, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" }, ...extra } },
    });
    // sem janela de conversa nem menção: addressed false (só a transcrição poderá dizer se chamou pelo nome)
    const plain = toInboxRow(audioMsg("5511999999999"), OWNER, APPROVER, new Map([[OP, {}]]), now);
    expect(plain).toMatchObject({ kind: "audio", sender: "group" });
    expect(JSON.parse(plain!.payload!)).toMatchObject({ jid: OP, participant: "5511999999999", name: "Herickson", addressed: false, key: { id: "G5" }, mimetype: "audio/ogg; codecs=opus" });
    // dentro da janela de 10 min de uma conversa com a mesma pessoa: addressed true
    const state = new Map([[OP, { lastReplyAt: "2026-10-09T17:08:00Z", lastReplyTo: "5511988886666" }]]);
    expect(JSON.parse(toInboxRow(audioMsg("5511988886666"), OWNER, APPROVER, state, now)!.payload!)).toMatchObject({ addressed: true });
    // grupo não cadastrado: não entra como áudio
    expect(toInboxRow(audioMsg("5511999999999"), OWNER, APPROVER, new Map())).toMatchObject({ kind: "event", payload: OP });
    // mensagem da própria conta (fromMe): ignorada
    expect(toInboxRow({ ...audioMsg("5511999999999"), data: { ...audioMsg("5511999999999").data, key: { ...audioMsg("5511999999999").data.key, fromMe: true } } }, OWNER, APPROVER, new Map([[OP, {}]]))).toMatchObject({ kind: "event" });
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

  it("grupo mudou por fora (foto, nome, participante): vira pedido de invalidar o cache, sem precisar de key_id", () => {
    const changed = (event: string) => ({ event, instance: "wt_test", data: { id: "120363@g.us" } });
    expect(toInboxRow(changed("groups.update"), OWNER, APPROVER)).toEqual({ kind: "event", sender: "group", key_id: null, payload: "cache_reset" });
    expect(toInboxRow(changed("groups.upsert"), OWNER, APPROVER)).toMatchObject({ payload: "cache_reset" });
    expect(toInboxRow(changed("group-participants.update"), OWNER, APPROVER)).toMatchObject({ payload: "cache_reset" });
  });

  it("mensagem enviada pela própria conta não entra como conversa", () => {
    expect(toInboxRow(message(OWNER, { message: { conversation: "resposta da Maia" } }, true), OWNER, APPROVER)).toMatchObject({ sender: "none", payload: null });
  });

  it("só mensagens novas usam a chave de dedupe", () => {
    const update = message(OWNER, { message: { conversation: "oi" } }, false, "messages.update");
    expect(toInboxRow(update, OWNER, APPROVER)?.key_id).toBeNull();
  });

  it("MESSAGES_UPDATE guarda somente ID, destino e estado de leitura conhecido", () => {
    const update = { event: "messages.update", instance: "wt_test", data: { key: { id: "OUT-1", remoteJid: "5511999999999@s.whatsapp.net" }, update: { status: "READ" }, message: { conversation: "texto privado" } } };
    const row = toInboxRow(update, OWNER, APPROVER)!;
    expect(row).toMatchObject({ kind: "event", sender: "none" });
    expect(row.key_id).toMatch(/^receipt:[a-f0-9]{64}$/);
    expect(JSON.parse(row.payload!)).toEqual({ type: "delivery_status", updates: [{ messageId: "OUT-1", recipient: "5511999999999@s.whatsapp.net", status: "read" }] });
    expect(row.payload).not.toContain("texto privado");
    expect(toInboxRow(update, OWNER, APPROVER)?.key_id).toBe(row.key_id);
  });

  it("status em formato numérico desconhecido não é inferido como entregue/lido", () => {
    const update = { event: "MESSAGES_UPDATE", instance: "wt_test", data: { key: { id: "OUT-2" }, update: { status: 1 } } };
    expect(toInboxRow(update, OWNER, APPROVER)).toMatchObject({ kind: "event", sender: "none", payload: null });
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
