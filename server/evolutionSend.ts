// Envia texto pela instância da Evolution. Só é usado para responder ao dono autorizado.
export async function sendOwnerText(number: string, text: string): Promise<void> {
  for (const part of splitReply(text)) await sendTextChecked(number, part);
}

export class DeliveryError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain: boolean) { super(message); this.name = "DeliveryError"; this.uncertain = uncertain; }
}

export function splitReply(text: string, max = 3000): string[] {
  if (!Number.isInteger(max) || max < 1) throw new DeliveryError("Limite de mensagem inválido", false);
  const chars = Array.from(text.trim());
  if (!chars.length) throw new DeliveryError("Evolution sendText: resposta vazia", false);
  const parts: string[] = [];
  while (chars.length) parts.push(chars.splice(0, max).join(""));
  return parts;
}

// Somente diagnóstico controlado: nunca salva corpo cru (pode conter texto/número/chaves).
export function deliveryDiagnostic(body: unknown): string {
  const raw = JSON.stringify(body ?? {}).toLowerCase();
  if (/not connected|connection closed|disconnected|connection.*not open/.test(raw)) return "instância desconectada";
  if (/not.*whatsapp|invalid.*number|number.*invalid|exists.*false/.test(raw)) return "destinatário inválido ou não registrado";
  if (/too long|maximum|max length|length.*exceed/.test(raw)) return "texto excedeu limite";
  if (/unauthorized|invalid.*key|forbidden/.test(raw)) return "autenticação recusada";
  if (/required|validation|bad request/.test(raw)) return "validação do pedido recusada";
  return "sem diagnóstico seguro retornado";
}

// Limite de tamanho do áudio (nota de voz ou arquivo) baixado da Evolution.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Baixa o arquivo de um áudio recebido, pela mesma instância. Fica só em memória: não é gravado em disco.
export async function downloadAudio(key: Record<string, unknown>, fallbackMimetype: string): Promise<{ data: Buffer; mimetype: string }> {
  return downloadMedia(key, fallbackMimetype, MAX_AUDIO_BYTES);
}

// Baixa o arquivo (áudio, imagem, vídeo ou documento) de uma mensagem recebida, pela mesma instância. Só em memória.
export async function downloadMedia(key: Record<string, unknown>, fallbackMimetype: string, maxBytes: number): Promise<{ data: Buffer; mimetype: string }> {
  const base = process.env.EVOLUTION_API_URL;
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!base || !apiKey || !instance) throw new Error("Evolution não configurada no .env");
  const response = await fetch(`${base}/chat/getBase64FromMediaMessage/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({ message: { key }, convertToMp4: false }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Evolution getBase64 falhou: HTTP ${response.status}`);
  const json = (await response.json()) as { base64?: unknown; mimetype?: unknown };
  if (typeof json.base64 !== "string" || !json.base64) throw new Error("Evolution não devolveu o áudio");
  const data = Buffer.from(json.base64, "base64");
  if (data.length > maxBytes) throw new Error(`arquivo maior que ${Math.round(maxBytes / 1024 / 1024)} MB`);
  return { data, mimetype: typeof json.mimetype === "string" ? json.mimetype : fallbackMimetype };
}

// Envia uma imagem ao dono pela instância da Evolution (arte gerada pela Maia).
export async function sendOwnerImage(number: string, path: string, caption: string): Promise<string | null> {
  const base = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!base || !key || !instance) throw new Error("Evolution não configurada no .env");
  const { readFileSync } = await import("node:fs");
  const mimetype = /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png";
  const response = await fetch(`${base}/message/sendMedia/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ number, mediatype: "image", mimetype, caption, media: readFileSync(path).toString("base64"), fileName: path.split(/[\/]/).pop() }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Evolution sendMedia falhou: HTTP ${response.status}`);
  // O id da mensagem confirma que o WhatsApp aceitou o envio. Sem id, a entrega não está conferida.
  const body = (await response.json().catch(() => null)) as { key?: { id?: unknown } } | null;
  return typeof body?.key?.id === "string" ? body.key.id : null;
}

// Envia texto e devolve o id da mensagem aceita pelo WhatsApp (conferência da entrega). Sem id, não está conferido.
export async function sendTextChecked(number: string, text: string): Promise<string> {
  const base = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!base || !key || !instance) throw new DeliveryError("Evolution não configurada no .env", false);
  if (!text.trim() || !number || Array.from(text).length > 3000) throw new DeliveryError("Evolution sendText: destinatário/texto inválido ou maior que 3000 caracteres", false);
  let response: Response;
  try { response = await fetch(`${base.replace(/\/$/, "")}/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ number, text }),
    signal: AbortSignal.timeout(20_000),
  }); } catch {
    throw new DeliveryError("Evolution sendText: rede/tempo limite; resultado incerto, não repetir automaticamente", true);
  }
  const body = (await response.json().catch(() => null)) as { key?: { id?: unknown } } | null;
  const id = typeof body?.key?.id === "string" ? body.key.id : null;
  if (!response.ok || !id) throw new DeliveryError(`Evolution sendText falhou: HTTP ${response.status}; ${deliveryDiagnostic(body)}${response.ok ? "; sem ID, resultado incerto" : ""}`, response.ok || response.status >= 500 || response.status === 408);
  return id;
}
