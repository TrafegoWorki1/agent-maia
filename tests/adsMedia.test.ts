import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR } from "../server/media.ts";
import { ADS_MEDIA_MAX_AGE_MS, purgeTempAdMedia, resolveOwnerMediaPath, uploadTempAdMedia } from "../server/integrations/adsMedia.ts";

describe("mídia de anúncio: só arquivos que o dono mandou (data/midia)", () => {
  const file = join(MEDIA_DIR, "teste-video.mp4");

  afterEach(() => {
    rmSync(file, { force: true });
  });

  it("aceita arquivo real dentro de data/midia", () => {
    mkdirSync(MEDIA_DIR, { recursive: true });
    writeFileSync(file, "conteudo");
    const result = resolveOwnerMediaPath(file);
    expect(result).toEqual({ ok: true, path: file });
  });

  it("recusa caminho fora de data/midia (ex.: pasta de artes ou .env)", () => {
    expect(resolveOwnerMediaPath(join(MEDIA_DIR, "..", "arte", "x.png")).ok).toBe(false);
    expect(resolveOwnerMediaPath(join(MEDIA_DIR, "..", "..", ".env")).ok).toBe(false);
  });

  it("recusa arquivo que não existe (ex.: já venceu a retenção de 24h)", () => {
    expect(resolveOwnerMediaPath(join(MEDIA_DIR, "nao-existe.mp4"))).toMatchObject({ ok: false });
  });
});

describe("bucket temporário de mídia de anúncio (Supabase Storage)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeDb(overrides: Record<string, unknown> = {}) {
    const bucket = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://exemplo.supabase.co/sign/abc" }, error: null }),
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    };
    return { storage: { from: () => bucket, getBucket: vi.fn().mockResolvedValue({ data: { name: "ads_media_temp" } }) } } as never;
  }

  it("sobe o arquivo e devolve uma URL assinada, válida por 2h", async () => {
    mkdirSync(MEDIA_DIR, { recursive: true });
    const file = join(MEDIA_DIR, "teste-upload.mp4");
    writeFileSync(file, "bytes");
    const db = fakeDb();
    const result = await uploadTempAdMedia(db, file);
    expect(result.url).toBe("https://exemplo.supabase.co/sign/abc");
    expect(result.expiresInSeconds).toBe(2 * 60 * 60);
    expect(result.storagePath).toMatch(/^temp\//);
    rmSync(file, { force: true });
  });

  it("limpeza só apaga arquivos mais velhos que o teto (2h)", async () => {
    const now = Date.now();
    const bucket = {
      list: vi.fn().mockResolvedValue({
        data: [
          { name: "velho.mp4", created_at: new Date(now - ADS_MEDIA_MAX_AGE_MS - 1000).toISOString() },
          { name: "novo.mp4", created_at: new Date(now - 1000).toISOString() },
        ],
        error: null,
      }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    };
    const db = { storage: { from: () => bucket } } as never;
    const removed = await purgeTempAdMedia(db, ADS_MEDIA_MAX_AGE_MS, now);
    expect(removed).toBe(1);
    expect(bucket.remove).toHaveBeenCalledWith(["temp/velho.mp4"]);
  });

  it("limpeza não falha se o bucket ainda não existir", async () => {
    const db = { storage: { from: () => ({ list: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }) }) } } as never;
    await expect(purgeTempAdMedia(db)).resolves.toBe(0);
  });
});
