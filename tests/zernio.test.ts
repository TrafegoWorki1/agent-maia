import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInstagramPost, buildLinkedInPost, dmWindowOpen, getPostStatus, listInstagramAccounts, publishInstagramPost, recentArts, resolveArtPath, sendInboxMessage, ZernioError, type InboxMessage } from "../server/integrations/zernio.ts";

const NOW = new Date("2026-10-09T12:00:00Z");
const base = { accountId: "acc123", caption: "Legenda do post", imageUrl: "https://cdn.exemplo.com/arte.png" };

describe("montagem da publicação no Instagram", () => {
  it("publica agora quando não há horário", () => {
    const built = buildInstagramPost(base, NOW);
    expect(built.ok && built.body).toMatchObject({
      content: "Legenda do post",
      mediaItems: [{ type: "image", url: base.imageUrl }],
      platforms: [{ platform: "instagram", accountId: "acc123" }],
      publishNow: true,
    });
  });

  it("agenda para um horário futuro, sem publicar agora", () => {
    const built = buildInstagramPost({ ...base, scheduledFor: "2026-10-10T15:00:00-03:00" }, NOW);
    expect(built.ok && built.body.scheduledFor).toBe("2026-10-10T18:00:00.000Z");
    expect(built.ok && "publishNow" in built.body).toBe(false);
  });

  it("recusa horário no passado ou inválido", () => {
    expect(buildInstagramPost({ ...base, scheduledFor: "2026-10-09T11:00:00Z" }, NOW).ok).toBe(false);
    expect(buildInstagramPost({ ...base, scheduledFor: "amanhã" }, NOW).ok).toBe(false);
  });

  it("recusa legenda vazia ou acima de 2200 caracteres", () => {
    expect(buildInstagramPost({ ...base, caption: "   " }, NOW).ok).toBe(false);
    expect(buildInstagramPost({ ...base, caption: "a".repeat(2201) }, NOW).ok).toBe(false);
    expect(buildInstagramPost({ ...base, caption: "a".repeat(2200) }, NOW).ok).toBe(true);
  });

  it("recusa imagem sem endereço https e conta não informada", () => {
    expect(buildInstagramPost({ ...base, imageUrl: "http://exemplo.com/a.png" }, NOW).ok).toBe(false);
    expect(buildInstagramPost({ ...base, accountId: "" }, NOW).ok).toBe(false);
  });
});

describe("montagem da publicação no LinkedIn", () => {
  it("publica texto agora na conta LinkedIn", () => {
    const built = buildLinkedInPost({ accountId: "li123", content: "Conteúdo profissional" }, NOW);
    expect(built.ok && built.body).toMatchObject({
      content: "Conteúdo profissional",
      platforms: [{ platform: "linkedin", accountId: "li123" }],
      publishNow: true,
    });
  });

  it("agenda conteúdo e associa página da empresa quando informada", () => {
    const built = buildLinkedInPost({ accountId: "li123", content: "Atualização da empresa", organizationId: "org456", scheduledFor: "2026-10-10T15:00:00-03:00" }, NOW);
    expect(built.ok && built.body).toMatchObject({
      scheduledFor: "2026-10-10T18:00:00.000Z",
      platforms: [{ platform: "linkedin", accountId: "li123", platformSpecificData: { organizationId: "org456" } }],
    });
    expect(built.ok && "publishNow" in built.body).toBe(false);
  });

  it("recusa conteúdo vazio e URL de imagem insegura", () => {
    expect(buildLinkedInPost({ accountId: "li123", content: "   " }, NOW).ok).toBe(false);
    expect(buildLinkedInPost({ accountId: "li123", content: "Texto", imageUrl: "http://exemplo.com/a.png" }, NOW).ok).toBe(false);
  });
});

describe("arquivos de arte", () => {
  it("só aceita imagens dentro da pasta de artes", () => {
    expect(resolveArtPath("../../.env").ok).toBe(false);
    expect(resolveArtPath("../../../Windows/win.ini").ok).toBe(false);
    expect(resolveArtPath("pedidos/x/script.js").ok).toBe(false);
    expect(resolveArtPath("pedidos/nao-existe/arte.png").ok).toBe(false);
  });

  it("lista as artes recentes só com caminhos relativos", () => {
    for (const art of recentArts(5)) {
      expect(art.path).toMatch(/^pedidos\/[^/]+\/[^/]+\.(png|jpe?g)$/i);
      expect(art.path.includes(":")).toBe(false);
    }
  });
});

describe("janela de 24h do Direct (regra da Meta)", () => {
  const NOW_DM = new Date("2026-10-10T18:00:00Z");
  const msg = (direction: InboxMessage["direction"], createdAt: string): InboxMessage => ({ message: "x", senderName: null, direction, createdAt });

  it("aberta com mensagem recebida há menos de 24h", () => {
    expect(dmWindowOpen([msg("incoming", "2026-10-10T10:00:00Z")], NOW_DM)).toBe(true);
  });

  it("fechada com a última recebida há mais de 24h, mesmo com mensagens enviadas depois", () => {
    expect(dmWindowOpen([msg("outgoing", "2026-10-10T17:00:00Z"), msg("incoming", "2026-10-09T10:00:00Z")], NOW_DM)).toBe(false);
  });

  it("fechada sem nenhuma mensagem recebida", () => {
    expect(dmWindowOpen([msg("outgoing", "2026-10-10T17:00:00Z")], NOW_DM)).toBe(false);
    expect(dmWindowOpen([], NOW_DM)).toBe(false);
  });
});

describe("erros da Zernio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZERNIO_API_KEY;
  });

  it("autenticação recusada vira mensagem clara, sem a chave", async () => {
    process.env.ZERNIO_API_KEY = "chave-secreta-xyz";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized chave-secreta-xyz" }), { status: 401 })));
    const error = await listInstagramAccounts().catch((e) => e);
    expect(error).toBeInstanceOf(ZernioError);
    expect((error as ZernioError).message).toContain("recusou a autenticação");
    expect((error as ZernioError).message).not.toContain("chave-secreta-xyz");
  });

  it("sem a chave configurada, avisa antes de chamar a rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(listInstagramAccounts()).rejects.toThrow("não configurada");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publicação recusada pelo Instagram (207, failed) não conta como publicada", async () => {
    process.env.ZERNIO_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ post: { status: "failed" } }), { status: 207 })));
    await expect(publishInstagramPost(base)).rejects.toThrow("recusou a publicação");
  });

  it("conferência lê o status real do post", async () => {
    process.env.ZERNIO_API_KEY = "k";
    const payload = { post: { _id: "p1", status: "published", platforms: [{ platformPostUrl: "https://instagram.com/p/abc" }] } };
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getPostStatus("p1")).resolves.toEqual({ status: "published", url: "https://instagram.com/p/abc" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/posts/p1");
  });

  it("conferência de post inexistente vira erro, não sucesso", async () => {
    process.env.ZERNIO_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    await expect(getPostStatus("nao-existe")).rejects.toThrow("não encontrou");
  });

  it("publicação criada devolve o status e o link", async () => {
    process.env.ZERNIO_API_KEY = "k";
    const payload = { post: { _id: "p1", status: "published", platforms: [{ platformPostUrl: "https://instagram.com/p/abc" }] } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 201 })));
    await expect(publishInstagramPost(base)).resolves.toMatchObject({ postId: "p1", status: "published", url: "https://instagram.com/p/abc", scheduled: false });
  });

  it("lista de contas traz o profileId (precisa dele para criar automação)", async () => {
    process.env.ZERNIO_API_KEY = "k";
    const payload = { accounts: [{ _id: "acc1", platform: "instagram", username: "hericksonmaia", isActive: true, profileId: { _id: "prof1", name: "Default" } }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })));
    await expect(listInstagramAccounts()).resolves.toEqual([{ id: "acc1", username: "hericksonmaia", active: true, profileId: "prof1" }]);
  });

  it("envio de DM manda a chave de idempotência e devolve o id da mensagem", async () => {
    process.env.ZERNIO_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: { messageId: "m1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendInboxMessage("conv1", "acc1", "oi", "chave-1")).resolves.toEqual({ messageId: "m1" });
    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["Idempotency-Key"]).toBe("chave-1");
  });
});
