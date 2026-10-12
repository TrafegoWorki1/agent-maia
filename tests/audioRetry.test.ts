import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pendingAudios, retryPendingAudio, savePendingAudio } from "../server/audioRetry.ts";

// Decisão do owner (12/10/2026): áudio que a transcrição não deu conta é guardado por 24 h e retomado depois,
// do dono e dos membros.
const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "maia-audio-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const handlers = () => ({ notifyOwner: vi.fn(async (_text: string) => {}), resumeMember: vi.fn(async (_m: { from: string; name: string }, _t: string) => {}) });
const owner = { kind: "owner" } as const;

describe("áudio pendente", () => {
  it("guarda o áudio com a extensão certa e lista do mais antigo para o mais novo", () => {
    const dir = tmp();
    const second = savePendingAudio(Buffer.from("b"), "audio/ogg; codecs=opus", owner, 2000, dir);
    const first = savePendingAudio(Buffer.from("a"), "audio/mp4", owner, 1000, dir);
    expect(second).toContain("2000-audio-pendente.ogg");
    expect(first).toContain("1000-audio-pendente.m4a");
    writeFileSync(join(dir, "outro-arquivo.pdf"), "x");
    expect(pendingAudios(dir).map((a) => a.at)).toEqual([1000, 2000]);
  });

  it("dono: quando o servidor volta, mostra o texto ao dono e apaga o áudio", async () => {
    const dir = tmp();
    const path = savePendingAudio(Buffer.from("a"), "audio/ogg", owner, 1000, dir)!;
    const h = handlers();
    expect(await retryPendingAudio(h, async () => "  salva o contato do João  ", dir)).toBe(true);
    expect(h.notifyOwner).toHaveBeenCalledTimes(1);
    expect(h.notifyOwner.mock.calls[0][0]).toContain("salva o contato do João");
    expect(h.resumeMember).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
  });

  it("membro: o texto volta como mensagem do próprio membro, sem avisar o dono", async () => {
    const dir = tmp();
    const path = savePendingAudio(Buffer.from("a"), "audio/ogg", { kind: "member", from: "558588887777", name: "Max" }, 1000, dir)!;
    const h = handlers();
    expect(await retryPendingAudio(h, async () => "me manda o resumo", dir)).toBe(true);
    expect(h.resumeMember).toHaveBeenCalledWith({ from: "558588887777", name: "Max" }, "me manda o resumo");
    expect(h.notifyOwner).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(false);
    expect(existsSync(path.replace(/\.ogg$/, ".json"))).toBe(false);
  });

  it("áudio guardado sem o arquivo .json (versão anterior) é tratado como do dono", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "1000-audio-pendente.ogg"), "a");
    const h = handlers();
    expect(await retryPendingAudio(h, async () => "oi", dir)).toBe(true);
    expect(h.notifyOwner).toHaveBeenCalledTimes(1);
  });

  it("se o servidor continua fora, mantém o áudio e não avisa", async () => {
    const dir = tmp();
    const path = savePendingAudio(Buffer.from("a"), "audio/ogg", owner, 1000, dir)!;
    const h = handlers();
    expect(await retryPendingAudio(h, async () => { throw new Error("fora"); }, dir)).toBe(false);
    expect(h.notifyOwner).not.toHaveBeenCalled();
    expect(existsSync(path)).toBe(true);
  });

  it("sem transcritor configurado ou sem áudio pendente, não faz nada", async () => {
    const dir = tmp();
    const h = handlers();
    expect(await retryPendingAudio(h, async () => "x", dir)).toBe(false);
    savePendingAudio(Buffer.from("a"), "audio/ogg", owner, 1000, dir);
    expect(await retryPendingAudio(h, null, dir)).toBe(false);
  });
});
