// Transcrição de áudio (voz → texto) pelo servidor Whisper do próprio owner (EasyPanel, "Whisper Official API").
// Decisão do owner (2026-10-09): o áudio do dono vai para esse servidor, nunca para terceiros. A chave fica só no .env.
// Contrato do servidor: POST /transcribe?language=pt&task=transcribe, multipart com o campo audio_file;
// resposta {"text": "...", "language": "pt", "segments": [...]}. Roda em CPU: pode levar de 20 a 90 segundos.
export type Transcriber = (audio: Buffer, mimetype: string) => Promise<string>;

// 120 s por tentativa e sem nova tentativa quando estoura o tempo: o pior caso é ~2 min, não os ~8 min de antes (12/10/2026).
const TIMEOUT_MS = 120_000;
const RETRY_STATUS = new Set([502, 503, 504]); // o contêiner pode estar reiniciando
const RETRY_WAIT_MS = 10_000;

function extensionFor(mimetype: string): string {
  if (/ogg|opus/i.test(mimetype)) return "ogg";
  if (/mp4|m4a|aac/i.test(mimetype)) return "m4a";
  if (/mpeg|mp3/i.test(mimetype)) return "mp3";
  if (/wav/i.test(mimetype)) return "wav";
  if (/webm/i.test(mimetype)) return "webm";
  return "ogg";
}

export interface WhisperConfig {
  url: string;
  key?: string;
  language?: string;
  retryWaitMs?: number;
  timeoutMs?: number;
}

// Nunca inclui a chave nem o corpo da resposta nas mensagens de erro.
export async function whisperTranscribe(config: WhisperConfig, audio: Buffer, mimetype: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const endpoint = `${config.url.replace(/\/+$/, "")}/transcribe?language=${config.language ?? "pt"}&task=transcribe`;
  const attempt = async (): Promise<Response> => {
    const form = new FormData();
    form.append("audio_file", new Blob([new Uint8Array(audio)], { type: mimetype || "audio/ogg" }), `audio.${extensionFor(mimetype)}`);
    const headers: Record<string, string> = {};
    if (config.key) {
      headers.Authorization = `Bearer ${config.key}`;
      headers["x-api-key"] = config.key;
    }
    return fetchImpl(endpoint, { method: "POST", headers, body: form, signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS) });
  };
  let timedOut = false;
  const run = async (): Promise<Response | null> => {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) timedOut = true;
      return null;
    }
  };
  let response = await run();
  if (timedOut) throw new Error("o servidor de transcrição não respondeu a tempo");
  if (!response || RETRY_STATUS.has(response.status)) {
    await new Promise((resolve) => setTimeout(resolve, config.retryWaitMs ?? RETRY_WAIT_MS));
    response = await run();
    if (timedOut) throw new Error("o servidor de transcrição não respondeu a tempo");
  }
  if (!response) throw new Error("o servidor de transcrição não respondeu");
  if (response.status === 401 || response.status === 403) throw new Error("o servidor de transcrição recusou a chave");
  if (!response.ok) throw new Error(`o servidor de transcrição respondeu HTTP ${response.status}`);
  const json = (await response.json().catch(() => null)) as { text?: unknown } | null;
  return typeof json?.text === "string" ? json.text.trim() : "";
}

export function transcriberFromEnv(timeoutMs?: number): Transcriber | null {
  const url = process.env.WHISPER_API_URL;
  if (!url) return null;
  const config: WhisperConfig = { url, key: process.env.WHISPER_API_KEY, ...(timeoutMs ? { timeoutMs } : {}) };
  return (audio, mimetype) => whisperTranscribe(config, audio, mimetype);
}
