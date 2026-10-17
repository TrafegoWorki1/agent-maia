import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createImageServer } from "../server/maiaImageTool.ts";
import { canRequestCreativeJob } from "../server/conversationPolicy.ts";
import { isImageCreationRequest } from "../server/ai/rulesClassifier.ts";

const queue = vi.hoisted(() => vi.fn().mockResolvedValue(42));
vi.mock("../server/creativeJobs.ts", () => ({ createCreativeJob: queue }));
vi.mock("../server/store.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/store.ts")>(),
  getDb: () => ({}),
}));

const clients: Client[] = [];
const servers: ReturnType<typeof createImageServer>[] = [];
async function call(channel: "whatsapp" | "painel", enabled: boolean, isOwner: boolean) {
  const server = createImageServer(channel, 9, enabled, isOwner);
  servers.push(server);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverSide as never);
  const client = new Client({ name: "teste-continuidade", version: "1" });
  clients.push(client);
  await client.connect(clientSide);
  return client.callTool({ name: "trabalho_arte_enfileirar", arguments: {
    titulo: "Nosso Tesla", itens: [
      { briefing: "Capa: Nosso Tesla. Foto cinematográfica, fundo escuro.", formato: "feed" },
      { briefing: "Primeira impressão: foto externa em ângulo 3/4.", formato: "feed" },
    ],
  } });
}

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.instance.close();
  queue.mockClear();
});

describe("continuidade de pedido criativo sem comando repetido", () => {
  it("não usa o classificador como recusa ao roteiro que o executor vinculou ao pedido anterior", async () => {
    expect(isImageCreationRequest("## LÂMINA 01 — CAPA\nNOSSO TESLA.\nVisual: Foto cinematográfica do Tesla.")).toBe(false);
    const enabled = canRequestCreativeJob({ role: "owner" }, "whatsapp");
    const result = await call("whatsapp", enabled, true);
    expect(result.isError).not.toBe(true);
    expect(queue).toHaveBeenCalledExactlyOnceWith({}, expect.objectContaining({ sourceTaskId: 9, items: expect.arrayContaining([
      expect.objectContaining({ briefing: expect.stringContaining("Nosso Tesla"), format: "feed" }),
    ]) }));
  });

  it.each([
    ["whatsapp", true, false], // A habilitação sozinha não concede papel de owner.
    ["whatsapp", false, true], // Escopo que não admite produção privada.
    ["painel", true, true],
  ] as const)("recusa fora do papel/canal habilitado: %s, %s, %s", async (channel, enabled, owner) => {
    expect((await call(channel, enabled, owner)).isError).toBe(true);
    expect(queue).not.toHaveBeenCalled();
  });

  it("não habilita membros nem transporta a capacidade privada para grupos", () => {
    expect(canRequestCreativeJob({ role: "member" }, "whatsapp")).toBe(false);
    expect(canRequestCreativeJob({ role: "owner" }, "whatsapp", true)).toBe(false);
    expect(canRequestCreativeJob({ role: "owner" }, "painel")).toBe(false);
  });
});
