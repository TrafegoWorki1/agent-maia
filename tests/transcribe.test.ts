import { describe, expect, it, vi } from "vitest";
import { whisperTranscribe } from "../server/transcribe.ts";

const cfg = { url: "https://whisper.exemplo/", key: "chave-secreta-xyz", retryWaitMs: 1 };
const audio = Buffer.from("fake-ogg");
const ok = (text: string) => new Response(JSON.stringify({ text, language: "pt", segments: [] }), { status: 200 });

describe("transcrição pelo servidor Whisper", () => {
  it("envia o áudio como audio_file em português e devolve o texto", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ok("  Cria uma planilha  "));
    await expect(whisperTranscribe(cfg, audio, "audio/ogg; codecs=opus", fetchMock as unknown as typeof fetch)).resolves.toBe("Cria uma planilha");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://whisper.exemplo/transcribe?language=pt&task=transcribe");
    expect((init.body as FormData).get("audio_file")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer chave-secreta-xyz");
  });

  it("tenta de novo uma vez quando o servidor está reiniciando (502)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(ok("oi"));
    await expect(whisperTranscribe(cfg, audio, "audio/ogg", fetchMock as unknown as typeof fetch)).resolves.toBe("oi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("áudio sem fala devolve texto vazio", async () => {
    const fetchMock = vi.fn(async () => ok(""));
    await expect(whisperTranscribe(cfg, audio, "audio/ogg", fetchMock as unknown as typeof fetch)).resolves.toBe("");
  });

  it("erros não vazam a chave", async () => {
    const denied = vi.fn(async () => new Response("chave-secreta-xyz inválida", { status: 401 }));
    const error = (await whisperTranscribe(cfg, audio, "audio/ogg", denied as unknown as typeof fetch).catch((e) => e)) as Error;
    expect(error.message).toContain("recusou a chave");
    expect(error.message).not.toContain("chave-secreta-xyz");
    const down = vi.fn(async () => { throw new Error("rede"); });
    await expect(whisperTranscribe(cfg, audio, "audio/ogg", down as unknown as typeof fetch)).rejects.toThrow("não respondeu");
  });
});
