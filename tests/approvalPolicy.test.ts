import { describe, expect, it } from "vitest";
import { requiresApproval } from "../server/approvalPolicy.ts";
import { canConverse, decideAccess, type Requester } from "../server/access.ts";
import { matchContacts } from "../server/contacts.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5585992494552", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });
const guest: Requester = { role: "guest", name: "Alguém", number: "", permissions: new Set() };

describe("ação pública ou de risco: sempre OK do dono", () => {
  it("lista estática", () => {
    for (const t of ["mcp__maia__instagram_publicar", "mcp__claude_ai_Meta_ADS__ads_create_campaign", "mcp__claude_ai_Meta_ADS__ads_activate_entity", "mcp__claude_ai_Meta_ADS__ads_delete_custom_audience", "mcp__claude_ai_Google_Drive__share_file", "mcp__claude_ai_instamany__send_message"]) expect(requiresApproval(t), t).toBe(true);
    for (const t of ["mcp__claude_ai_Gmail__send_message", "mcp__claude_ai_Gmail__trash_message", "mcp__claude_ai_Google_Calendar__create_event", "mcp__maia__contato_enviar_mensagem", "mcp__maia__grupo_enviar_texto"]) expect(requiresApproval(t), t).toBe(false);
  });
  it("vale para o dono também", () => {
    expect(decideAccess("mcp__maia__instagram_publicar", owner, {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__instagram_publicar", member("escrita.pedir", "mensagem.enviar"), {}, false).decision).toBe("approve");
  });
});

describe("dono tem autonomia no que é interno e privado", () => {
  it("manda mensagem, cria arquivo, apaga e convida sem pedir OK", () => {
    for (const t of ["mcp__maia__contato_enviar_mensagem", "mcp__claude_ai_Gmail__send_message", "mcp__claude_ai_Google_Drive__create_file", "mcp__claude_ai_Gmail__trash_message", "mcp__claude_ai_Google_Calendar__create_event"]) expect(decideAccess(t, owner, {}, false).decision, t).toBe("allow");
  });
  it("grupo cadastrado: livre; não cadastrado: OK", () => {
    expect(decideAccess("mcp__maia__grupo_enviar_texto", owner, { groupRegistered: true }, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__grupo_enviar_texto", owner, { groupRegistered: false }, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__grupo_agendar", owner, {}, false).decision).toBe("approve");
  });
  it("mais de 3 contatos no mesmo pedido pede OK", () => {
    expect(decideAccess("mcp__maia__contato_enviar_mensagem", owner, { dmInTask: 2 }, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__contato_enviar_mensagem", owner, { dmInTask: 3 }, false).decision).toBe("approve");
  });
});

describe("membro só faz o que a permissão cobre", () => {
  it("leitura por conector", () => {
    expect(decideAccess("mcp__claude_ai_Gmail__search_threads", member("gmail.ler"), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__claude_ai_Gmail__search_threads", member("meta.ler"), {}, true).decision).toBe("approve");
    expect(decideAccess("mcp__claude_ai_Google_Drive__search_files", member("sheets.ler"), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__buscar_conhecimento", member(), {}, true).decision).toBe("allow");
  });
  it("mensagem e escrita", () => {
    expect(decideAccess("mcp__maia__contato_enviar_mensagem", member("mensagem.enviar"), {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__contato_enviar_mensagem", member("escrita.pedir"), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__claude_ai_Google_Drive__create_file", member("escrita.pedir"), {}, false).decision).toBe("allow");
    expect(decideAccess("mcp__claude_ai_Google_Drive__create_file", member(), {}, false).decision).toBe("approve");
  });
  it("cadastro é só do dono", () => {
    expect(decideAccess("mcp__maia__membro_cadastrar", member("escrita.pedir", "mensagem.enviar"), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__membro_cadastrar", owner, {}, false).decision).toBe("allow");
  });
  it("resumo operacional completo é interno do dono; membro precisa de aprovação", () => {
    expect(decideAccess("mcp__maia__operacao_resumo", owner, {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__operacao_resumo", member("sheets.ler"), {}, true).decision).toBe("approve");
    expect(decideAccess("mcp__maia__operacao_resumo", guest, {}, true).decision).toBe("approve");
  });
  it("visitante nunca age sozinho", () => {
    expect(decideAccess("mcp__claude_ai_Gmail__search_threads", guest, {}, true).decision).toBe("approve");
    expect(decideAccess("mcp__claude_ai_Google_Drive__create_file", guest, {}, false).decision).toBe("approve");
  });
  it("reenviar arquivo recebido é só do dono", () => {
    expect(decideAccess("mcp__maia__arquivo_reenviar", member("mensagem.enviar"), {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__arquivo_reenviar", owner, {}, false).decision).toBe("allow");
  });
});

describe("quem pode conversar com a Maia no privado (canConverse)", () => {
  it("dono sempre pode; membro só com a permissão conversa.maia; visitante nunca", () => {
    expect(canConverse(owner)).toBe(true);
    expect(canConverse(member("conversa.maia"))).toBe(true);
    expect(canConverse(member("gmail.ler"))).toBe(false);
    expect(canConverse(member())).toBe(false);
    expect(canConverse(guest)).toBe(false);
  });
});

describe("agenda de contatos", () => {
  const all = [
    { number: "5585911112222", name: "Jéssica Lima", aliases: ["Jess"] },
    { number: "5585933334444", name: "Jéssica Souza", aliases: [] },
    { number: "5585955556666", name: "Jefferson", aliases: [] },
  ];
  it("acha por nome sem acento, apelido e número", () => {
    expect(matchContacts(all, "jefferson")).toHaveLength(1);
    expect(matchContacts(all, "Jess")).toHaveLength(1);
    expect(matchContacts(all, "+55 85 95555-6666")).toHaveLength(1);
  });
  it("nome ambíguo devolve mais de um, para a Maia perguntar", () => {
    expect(matchContacts(all, "jessica")).toHaveLength(2);
    expect(matchContacts(all, "ninguém")).toHaveLength(0);
  });
});
