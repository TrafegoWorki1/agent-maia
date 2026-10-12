import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR, saveMedia } from "./media.ts";
import { transcriberFromEnv, type Transcriber } from "./transcribe.ts";

// Áudio do dono que não pôde ser transcrito (servidor Whisper fora do ar ou lento) fica em data/midia por 24 h,
// como qualquer mídia do dono (retenção de server/media.ts). O worker tenta de novo de tempos em tempos e, quando
// consegue, mostra o texto ao dono. Não executa o pedido sozinho: um pedido atrasado pode já não valer.

const PENDING = /^(\d+)-audio-pendente\.(ogg|m4a|mp3|wav|webm)$/;

function extensionFor(mimetype: string): string {
  if (/mp4|m4a|aac/i.test(mimetype)) return "m4a";
  if (/mpeg|mp3/i.test(mimetype)) return "mp3";
  if (/wav/i.test(mimetype)) return "wav";
  if (/webm/i.test(mimetype)) return "webm";
  return "ogg";
}

export function savePendingAudio(data: Buffer, mimetype: string, now = Date.now(), dir = MEDIA_DIR): string | null {
  try {
    return saveMedia(data, `audio-pendente.${extensionFor(mimetype)}`, now, dir);
  } catch (error) {
    console.error("[audio] não consegui guardar o áudio:", error instanceof Error ? error.message : error);
    return null;
  }
}

export function pendingAudios(dir = MEDIA_DIR): { path: string; at: number; mimetype: string }[] {
  try {
    return readdirSync(dir)
      .map((name) => ({ name, match: PENDING.exec(name) }))
      .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
      .map(({ name, match }) => ({ path: join(dir, name), at: Number(match[1]), mimetype: `audio/${match[2] === "m4a" ? "mp4" : match[2]}` }))
      .sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

// Tenta transcrever o áudio pendente mais antigo. Devolve true se avisou o dono.
export async function retryPendingAudio(notify: (text: string) => Promise<void>, transcribe: Transcriber | null = transcriberFromEnv(), dir = MEDIA_DIR): Promise<boolean> {
  const next = pendingAudios(dir)[0];
  if (!next || !transcribe) return false;
  let text: string;
  try {
    text = (await transcribe(readFileSync(next.path), next.mimetype)).trim();
  } catch {
    return false;
  }
  rmSync(next.path, { force: true });
  if (!text) return false;
  const when = new Date(next.at).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
  await notify(`O servidor de transcrição voltou. O áudio das ${when} que não consegui ouvir diz: "${text.slice(0, 1500)}". Quer que eu faça o que ele pedia?`);
  return true;
}
