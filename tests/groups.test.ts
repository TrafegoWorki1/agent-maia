import { describe, expect, it } from "vitest";
import { groupExists, parseCreateGroup, parseOwnerTask } from "../server/groups.ts";

describe("comandos de grupo do dono", () => {
  it("lê o nome e os participantes de 'criar grupo'", () => {
    expect(parseCreateGroup("criar grupo Operação Julho | 5585998372658, 5585992494552")).toEqual({
      name: "Operação Julho",
      participants: ["5585998372658", "5585992494552"],
    });
  });

  it("ignora 'criar grupo' sem participantes válidos", () => {
    expect(parseCreateGroup("criar grupo Sem gente |")).toBeNull();
    expect(parseCreateGroup("criar grupo Nome | 123")).toBeNull();
  });

  it("lê tarefa com e sem grupo", () => {
    expect(parseOwnerTask("tarefa Revisar campanha grupo Tráfego pago")).toEqual({ title: "Revisar campanha", groupName: "Tráfego pago" });
    expect(parseOwnerTask("tarefa Ligar para fornecedor")).toEqual({ title: "Ligar para fornecedor", groupName: null });
  });

  it("não reconhece texto comum como comando", () => {
    expect(parseCreateGroup("oi, tudo bem?")).toBeNull();
    expect(parseOwnerTask("oi, tudo bem?")).toBeNull();
  });
});

describe("conferência do grupo criado", () => {
  it("acha o grupo ignorando acento, maiúsculas e espaços", () => {
    const groups = [{ subject: "Operacional Worki Digital" }, { subject: "Tráfego" }];
    expect(groupExists(groups, " operacional worki digital ")).toBe(true);
    expect(groupExists(groups, "Trafego")).toBe(true);
  });
  it("não confirma grupo que não está na lista", () => {
    expect(groupExists([{ subject: "Outro" }], "Operacional Worki Digital")).toBe(false);
    expect(groupExists([], "Qualquer")).toBe(false);
  });
});

import { afterEach, beforeEach, vi } from "vitest";
import { fetchGroupInfo, fetchGroupInviteCode, fetchGroupParticipants, fetchLiveGroups, resetGroupCache, resetGroupCooldown, sendGroupInvite, updateGroupParticipants, updateGroupPicture } from "../server/groups.ts";

describe("limite do WhatsApp na lista de grupos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetGroupCache();
    resetGroupCooldown();
  });

  it("rate-overlimit para as consultas por um tempo e não repete a chamada", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 500, response: { message: "rate-overlimit" } }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await fetchLiveGroups(1_000);
    expect(first.error).toContain("rate-overlimit");
    const second = await fetchLiveGroups(2_000);
    expect(second.error).toContain("rate-overlimit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("adicionar/remover/promover/rebaixar participante de grupo existente", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("chama o endpoint de atualizar participantes com a ação pedida", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateGroupParticipants("120363@g.us", "promote", ["5585986139044"]);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/group/updateParticipant/i");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ groupJid: "120363@g.us", action: "promote", participants: ["5585986139044"] });
  });

  // Regressão real (10/10/2026): a Evolution aceitou (HTTP 200) adicionar a Gessica, mas ela não entrou de
  // fato no grupo. A Evolution devolve um status por número; precisa ser conferido, não só o HTTP.
  it("lê o status por número e não confirma quem a Evolution recusou (ex.: 403 de privacidade)", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const body = { participants: [{ jid: "5585986139044@s.whatsapp.net", status: "403" }, { jid: "5585911112222@s.whatsapp.net", status: 200 }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const result = await updateGroupParticipants("120363@g.us", "add", ["5585986139044", "5585911112222"]);
    expect(result.ok).toBe(true);
    expect(result.outcomes).toEqual([
      { number: "5585986139044", accepted: false, statusCode: "403" },
      { number: "5585911112222", accepted: true, statusCode: "200" },
    ]);
  });

  it("sem status por participante no corpo, outcomes fica indefinido (resultado real desconhecido)", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const result = await updateGroupParticipants("120363@g.us", "add", ["5585986139044"]);
    expect(result.ok).toBe(true);
    expect(result.outcomes).toBeUndefined();
  });

  it("HTTP de erro vira detalhe claro, sem exceção", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));
    const result = await updateGroupParticipants("120363@g.us", "add", ["5585986139044"]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("400");
  });

  it("sem a Evolution configurada, avisa sem tentar a rede", async () => {
    delete process.env.EVOLUTION_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateGroupParticipants("120363@g.us", "remove", ["5585986139044"]);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trocar a foto do grupo", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("chama o endpoint com groupJid e a imagem (base64 ou URL)", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ update: "success" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateGroupPicture("120363@g.us", "aGVsbG8=");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/group/updateGroupPicture/i");
    expect(JSON.parse(init.body as string)).toEqual({ groupJid: "120363@g.us", image: "aGVsbG8=" });
  });

  it("HTTP de erro vira detalhe claro, sem exceção", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const result = await updateGroupPicture("120363@g.us", "aGVsbG8=");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("500");
  });
});

describe("consultas novas de grupo (info, participantes, convite)", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
  });

  it("findGroupInfos traz descrição, dono e tamanho", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ subject: "Operacional", desc: "Grupo da equipe", owner: "5585992494552@s.whatsapp.net", size: 3, creation: 1760000000 }), { status: 200 })));
    const result = await fetchGroupInfo("120363@g.us");
    expect(result).toMatchObject({ ok: true, info: { subject: "Operacional", description: "Grupo da equipe", owner: "5585992494552", size: 3 } });
  });

  it("participants lista número e quem é admin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ participants: [{ id: "5585992494552@s.whatsapp.net", admin: "superadmin" }, { id: "5585911112222@s.whatsapp.net", admin: null }] }), { status: 200 })));
    const result = await fetchGroupParticipants("120363@g.us");
    expect(result).toMatchObject({ ok: true, participants: [{ number: "5585992494552", isAdmin: true }, { number: "5585911112222", isAdmin: false }] });
  });

  it("inviteCode monta o link a partir do inviteCode devolvido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ inviteCode: "ABC123" }), { status: 200 })));
    const result = await fetchGroupInviteCode("120363@g.us");
    expect(result).toEqual({ ok: true, link: "https://chat.whatsapp.com/ABC123" });
  });

  it("sendInvite manda groupJid, números e descrição", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendGroupInvite("120363@g.us", "Operacional", ["5585911112222"], "Entra no grupo!");
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/group/sendInvite/i");
    expect(JSON.parse(init.body as string)).toEqual({ groupJid: "120363@g.us", groupName: "Operacional", numbers: ["5585911112222"], description: "Entra no grupo!" });
  });

  it("erro HTTP nas consultas novas não lança exceção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await fetchGroupInfo("x")).ok).toBe(false);
    expect((await fetchGroupParticipants("x")).ok).toBe(false);
    expect((await fetchGroupInviteCode("x")).ok).toBe(false);
  });
});
