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

import { afterEach, vi } from "vitest";
import { addGroupParticipants, fetchLiveGroups, resetGroupCache, resetGroupCooldown } from "../server/groups.ts";

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

describe("adicionar participante a grupo existente", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("chama o endpoint de atualizar participantes com action add", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await addGroupParticipants("120363@g.us", ["5585986139044"]);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/group/updateParticipant/i");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ groupJid: "120363@g.us", action: "add", participants: ["5585986139044"] });
  });

  it("HTTP de erro vira detalhe claro, sem exceção", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 400 })));
    const result = await addGroupParticipants("120363@g.us", ["5585986139044"]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("400");
  });

  it("sem a Evolution configurada, avisa sem tentar a rede", async () => {
    delete process.env.EVOLUTION_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await addGroupParticipants("120363@g.us", ["5585986139044"]);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
