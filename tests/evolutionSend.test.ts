import { afterEach, describe, expect, it, vi } from "vitest";
import { typingDelayMs, sendTextChecked } from "../server/evolutionSend.ts";

describe("simulação de digitação (delay repassado ao sendText)", () => {
  it("cresce com o tamanho do texto, dentro de um piso e um teto", () => {
    expect(typingDelayMs("oi")).toBe(1200); // abaixo do piso
    expect(typingDelayMs("a".repeat(1000))).toBe(6000); // acima do teto
    const meio = typingDelayMs("a".repeat(50));
    expect(meio).toBeGreaterThan(1200);
    expect(meio).toBeLessThan(6000);
  });

  it("nunca passa do teto, mesmo para texto bem longo", () => {
    expect(typingDelayMs("a".repeat(5000))).toBe(6000);
  });
});

describe("sendTextChecked manda o delay calculado para a Evolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("inclui delay no corpo do pedido", async () => {
    process.env.EVOLUTION_API_URL = "https://evo.exemplo";
    process.env.EVOLUTION_INSTANCE = "i";
    process.env.EVOLUTION_API_KEY = "k";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ key: { id: "m1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendTextChecked("5585999999999", "oi, tudo bem?");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ number: "5585999999999", text: "oi, tudo bem?" });
    expect(body.delay).toBe(typingDelayMs("oi, tudo bem?"));
  });
});
