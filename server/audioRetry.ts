import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_DIR, saveMedia } from "./media.ts";
import { transcriberFromEnv, type Transcriber } from "./transcribe.ts";

// Áudio que a transcrição não deu conta (servidor Whisper fora do ar ou lento) fica em data/midia por 24 h, como qualquer
// mídia do dono (retenção de server/media.ts). Um arquivo .json ao lado diz de quem é o áudio. O worker tenta de novo
// de tempos em tempos: para o dono, mostra o texto e pergunta o que fazer (um pedido atrasado pode já não valer); para
// um membro, trata o texto como a mensagem dele, dentro das permissões dele (quem decide é handleMemberMessage);
// em grupo, segue o mesmo caminho do áudio de grupo (memória do grupo e resposta só se a Maia foi chamada).

export interface GroupMeta {
  jid: string;
  participant: string;
  name: string;
  addressed: boolean;
  receivedAt?: string;
  keyId?: string;
}

export type PendingMeta = { kind: "owner" } | { kind: "member"; from: string; name: string } | ({ kind: "group" } & GroupMeta);

// Em segundo plano ninguém espera: um áudio longo pode levar minutos no Whisper em CPU (medido em 12/10/2026).
const RETRY_TIMEOUT_MS = 360_000;

const PENDING = /^(\d+)-audio-pendente\.(ogg|m4a|mp3|wav|webm)$/;

function extensionFor(mimetype: string): string {
  if (/mp4|m4a|aac/i.test(mimetype)) return "m4a";
  if (/mpeg|mp3/i.test(mimetype)) return "mp3";
  if (/wav/i.test(mimetype)) return "wav";
  if (/webm/i.test(mimetype)) return "webm";
  return "ogg";
}

const sidecar = (audioPath: string) => audioPath.replace(/\.[^.]+$/, ".json");

export function savePendingAudio(data: Buffer, mimetype: string, meta: PendingMeta = { kind: "owner" }, now = Date.now(), dir = MEDIA_DIR): string | null {
  try {
    const path = saveMedia(data, `audio-pendente.${extensionFor(mimetype)}`, now, dir);
    writeFileSync(sidecar(path), JSON.stringify(meta));
    return path;
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

function readMeta(audioPath: string): PendingMeta {
  try {
    const meta = JSON.parse(readFileSync(sidecar(audioPath), "utf8")) as Record<string, unknown>;
    if (meta.kind === "member" && typeof meta.from === "string") return { kind: "member", from: meta.from, name: typeof meta.name === "string" ? meta.name : "" };
    if (meta.kind === "group" && typeof meta.jid === "string") {
      return {
        kind: "group",
        jid: meta.jid,
        participant: typeof meta.participant === "string" ? meta.participant : "",
        name: typeof meta.name === "string" ? meta.name : "",
        addressed: meta.addressed === true,
        ...(typeof meta.receivedAt === "string" ? { receivedAt: meta.receivedAt } : {}),
        ...(typeof meta.keyId === "string" ? { keyId: meta.keyId } : {}),
      };
    }
  } catch {
    // arquivo guardado pela versão anterior (sem .json) ou ilegível: era do dono
  }
  return { kind: "owner" };
}

export interface RetryHandlers {
  notifyOwner: (text: string) => Promise<void>;
  resumeMember: (meta: { from: string; name: string }, text: string) => Promise<void>;
  resumeGroup: (meta: GroupMeta, text: string) => Promise<void>;
}

// Tenta transcrever o áudio pendente mais antigo. Devolve true se o texto foi entregue.
export async function retryPendingAudio(handlers: RetryHandlers, transcribe: Transcriber | null = transcriberFromEnv(RETRY_TIMEOUT_MS), dir = MEDIA_DIR): Promise<boolean> {
  const next = pendingAudios(dir)[0];
  if (!next || !transcribe) return false;
  let text: string;
  try {
    text = (await transcribe(readFileSync(next.path), next.mimetype)).trim();
  } catch {
    return false;
  }
  const meta = readMeta(next.path);
  rmSync(next.path, { force: true });
  rmSync(sidecar(next.path), { force: true });
  if (!text) return false;
  if (meta.kind === "member") {
    await handlers.resumeMember({ from: meta.from, name: meta.name }, text);
    return true;
  }
  if (meta.kind === "group") {
    await handlers.resumeGroup(meta, text);
    return true;
  }
  const when = new Date(next.at).toLocaleTimeString("pt-BR", { timeZone: "America/Fortaleza", hour: "2-digit", minute: "2-digit" });
  await handlers.notifyOwner(`O servidor de transcrição voltou. O áudio das ${when} que não consegui ouvir diz: "${text.slice(0, 1500)}". Quer que eu faça o que ele pedia?`);
  return true;
}
