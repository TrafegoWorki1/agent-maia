import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingAudios, retryPendingAudio, savePendingAudio } from "../server/audioRetry.ts";

// Decisão do owner (12/10/2026): áudio que a transcrição não deu conta é guardado por 24 h e retomado depois.
const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "maia-audio-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("áudio pendente", () => {
  it("guarda o áudio com a extensão certa e lista do mais antigo para o mais novo", () => {
    const dir = tmp();
    const second = savePendingAudio(Buffer.from("b"), "audio/ogg; codecs=opus", 2000, dir);
    const first = savePendingAudio(Buffer.from("a"), "audio/mp4", 1000, dir);
    expect(second).toContain("2000-audio-pendente.ogg");
    expect(first).toContain("1000-audio-pendente.m4a");
    writeFileSync(join(dir, "outro-arquivo.pdf"), "x");
    expect(pendingAudios(dir).map((a) => a.at)).toEqual([1000, 2000]);
  });

  it("quando o servidor volta, mostra o texto ao dono e apaga o áudio", async () => {
    const dir = tmp();
    const path = savePendingAudio(Buffer.from("a"), "audio/ogg", 1000, dir)!;
    const notify = vi.fn(async () => {});
    const done = await retryPendingAudio(notify, async () => "  salva o contato do João  ", dir);
    expect(done).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]).includes("salva o contato do João")).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("se o servidor continua fora, mantém o áudio e não avisa", async () => {
    const dir = tmp();
    const path = savePendingAudio(Buffer.from("a"), "audio/ogg", 1000, dir)!;
    const notify = vi.fn(async () => {});
    const done = await retryPendingAudio(notify, async () => { throw new Error("fora"); }, dir);
    expect(done).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(true);
  });

  it("sem transcritor configurado ou sem áudio pendente, não faz nada", async () => {
    const dir = tmp();
    const notify = vi.fn(async () => {});
    expect(await retryPendingAudio(notify, async () => "x", dir)).toBe(false);
    savePendingAudio(Buffer.from("a"), "audio/ogg", 1000, dir);
    expect(await retryPendingAudio(notify, null, dir)).toBe(false);
  });
});
