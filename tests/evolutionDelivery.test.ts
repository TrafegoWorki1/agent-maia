import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { DeliveryError, deliveryDiagnostic, sendFile, sendOwnerText, sendTextChecked, splitReply } from "../server/evolutionSend.ts";

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

  it("sendFile reenvia um arquivo recebido e devolve o id da mensagem", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maia-sendfile-"));
    const path = join(dir, "foto.jpg");
    writeFileSync(path, "conteudo-da-imagem");
    try {
      const fetch = vi.fn().mockResolvedValue(new Response('{"key":{"id":"message-reenvio"}}', { status: 201 }));
      vi.stubGlobal("fetch", fetch);
      const id = await sendFile("5511999999999", path, "image", "image/jpeg", "legenda", "foto.jpg");
      expect(id).toBe("message-reenvio");
      const [url, init] = fetch.mock.calls[0];
      expect(String(url)).toContain("/message/sendMedia/maia");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body).toMatchObject({ number: "5511999999999", mediatype: "image", mimetype: "image/jpeg", caption: "legenda", fileName: "foto.jpg" });
      expect(Buffer.from(body.media, "base64").toString()).toBe("conteudo-da-imagem");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sendFile sem Evolution configurada avisa com clareza", async () => {
    vi.unstubAllEnvs();
    await expect(sendFile("5511999999999", "x", "image", "image/jpeg", "", "")).rejects.toThrow("não configurada");
  });
});
