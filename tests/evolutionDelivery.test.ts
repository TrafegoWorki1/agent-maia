import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { DeliveryError, deliveryDiagnostic, sendOwnerText, sendTextChecked, splitReply } from "../server/evolutionSend.ts";

describe("entrega confirmada e diagnóstico sem dados privados", () => {
  beforeEach(() => {
    vi.stubEnv("EVOLUTION_API_URL","https://example.invalid"); vi.stubEnv("EVOLUTION_API_KEY","secret-test"); vi.stubEnv("EVOLUTION_INSTANCE","maia");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("divide resposta longa sem quebrar emoji ou perder conteúdo", () => {
    const input = "💚".repeat(6001);
    expect(splitReply(input)).toHaveLength(3);
    expect(splitReply(input).join("")).toBe(input);
    expect(() => splitReply("  ")).toThrow(DeliveryError);
  });
  it("exige ID, mesmo com HTTP 200", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{ status:200 })));
    await expect(sendTextChecked("5511999999999","oi")).rejects.toMatchObject({ uncertain:true });
  });
  it("HTTP 400 fica explícito, corpo não aparece no erro", async () => {
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({ message:"invalid number 5511999999999 secret-test texto privado" }),{ status:400 })));
    const error = await sendTextChecked("5511999999999","oi").catch((e: Error) => e);
    expect(error).toMatchObject({ uncertain:false });
    expect(String(error)).toContain("HTTP 400");
    expect(String(error)).not.toMatch(/5511999999999|secret-test|texto privado/);
  });
  it("timeout ou 502 é incerto e não repete POST", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("timeout")); vi.stubGlobal("fetch",fetch);
    await expect(sendTextChecked("5511999999999","oi")).rejects.toMatchObject({ uncertain:true });
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response("{}",{ status:502 }));
    await expect(sendTextChecked("5511999999999","oi")).rejects.toMatchObject({ uncertain:true });
  });
  it("envio simples também exige aceitação das partes", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"key":{"id":"message-1"}}',{ status:201 }))); vi.stubGlobal("fetch",fetch);
    await sendOwnerText("5511999999999","A".repeat(3500)); expect(fetch).toHaveBeenCalledTimes(2);
    expect(deliveryDiagnostic({ message:"sensitive unknown message" })).toBe("sem diagnóstico seguro retornado");
  });
});
