import { downloadAudio, downloadMedia, sendOwnerText } from "./evolutionSend.ts";
import type { AudioRef, MediaRef } from "./evolutionWebhook.ts";
import { buildMediaPrompt, classifyDocument, docxToText, extractVideoParts, MAX_BYTES, MAX_TRANSCRIBE_SECONDS, MAX_VIDEO_SECONDS, MEMBER_MEDIA_DIR, saveMedia, videoDuration, xlsxToText, type MediaKind } from "./media.ts";
import { transcriberFromEnv } from "./transcribe.ts";
import { handleGroupMessage, handleMemberMessage, handleOwnerMessage } from "./maiaOwnerAgent.ts";
import { CALLS_MAIA } from "./inbox.ts";
import { canConverse, resolveRequester } from "./access.ts";
import { recordConvMessage } from "./conversations.ts";
import { recordReceivedMedia } from "./receivedMedia.ts";
import { handleDirectImage, isDirectImageRequest } from "./creative/creativeRouter.ts";
import { parseGroupIntent, requestCreateGroup } from "./groups.ts";
import { getDb, recordMessage } from "./store.ts";

// Roteamento dos comandos do dono: aviso, criar grupo (com aprovação), tarefa e conversa com a Maia.
// Usado pelo webhook local e pelo worker da fila, para os dois fazerem exatamente a mesma coisa.

// Envia um aviso ao dono pelo WhatsApp e registra na conversa.
export async function notifyOwner(text: string): Promise<void> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  if (!owner) return;
  await sendOwnerText(owner, text);
  await recordMessage(getDb(), { channel: "whatsapp", author: "maia", text });
}

export async function routeOwnerText(text: string): Promise<number | null> {
  const db = getDb();
  const deps = { db, notifyOwner };
  // Pedidos de grupo são tratados aqui, sem o agente: a aprovação é criada de verdade.
  const owner = process.env.EVOLUTION_OWNER_NUMBER;
  const groupRequest = parseGroupIntent(text, owner);
  if (groupRequest) {
    if (groupRequest.participants.length === 0) {
      await notifyOwner(`Para criar o grupo "${groupRequest.name}", mande os números dos participantes, com DDI e DDD. Exemplo: criar grupo ${groupRequest.name} | ${owner ?? "5585999999999"}`);
      return null;
    }
    const reply = await requestCreateGroup(deps, groupRequest.name, groupRequest.participants);
    await notifyOwner(reply);
    return null;
  }
  if (/^s*colocar/i.test(text)) {
    await notifyOwner("Ainda não consigo adicionar pessoas a um grupo que já existe. Para um grupo novo, mande: criar grupo Nome | 5585999999999, 5585888888888.");
    return null;
  }
  // Pedidos de tarefa passam pelas ferramentas persistidas: não criam um log de IA
  // disfarçado de tarefa nem interpretam "prazo" como parte do título.
  // Pedido de arte vai direto ao executor criativo, sem passar pelo Claude.
  if (isDirectImageRequest(text)) return handleDirectImage({ db, notifyOwner }, text);
  return handleOwnerMessage(text);
}

const AUDIO_UNAVAILABLE = "Recebi seu áudio, mas o servidor de transcrição não está configurado (WHISPER_API_URL). Pode mandar em texto por enquanto.";

// Áudio do dono: baixa pela Evolution, transcreve e trata o texto como um comando digitado.
// O áudio não é gravado; o texto transcrito segue as mesmas regras do texto (guardado só para o dono).
export async function handleOwnerAudio(ref: AudioRef): Promise<void> {
  const transcribe = transcriberFromEnv();
  if (!transcribe) {
    await notifyOwner(AUDIO_UNAVAILABLE);
    return;
  }
  try {
    // A transcrição roda em CPU e pode levar de 20 a 90 segundos: avisa que recebeu.
    await notifyOwner("Recebi o áudio, transcrevendo (pode levar até um minuto)...");
    const { data, mimetype } = await downloadAudio(ref.key, ref.mimetype);
    const text = (await transcribe(data, mimetype)).trim();
    if (!text) {
      await notifyOwner("Não consegui entender o áudio. Pode mandar de novo ou em texto?");
      return;
    }
    await recordMessage(getDb(), { channel: "whatsapp", author: "owner", text });
    await notifyOwner(`Entendi: "${text}"`);
    await routeOwnerText(text);
  } catch (error) {
    console.error("[audio]", error instanceof Error ? error.message : error);
    await notifyOwner("Não consegui processar o áudio agora. Tente de novo ou mande em texto.");
  }
}

const MEDIA_LABEL: Record<MediaKind, string> = { image: "a imagem", video: "o vídeo", document: "o documento" };
const MEDIA_EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "application/pdf": ".pdf" };

// Imagem, vídeo ou documento do dono: baixa, entende (ver server/media.ts) e trata como um pedido dele, com as mesmas
// permissões do texto. O arquivo fica em data/midia por 24 h e é apagado depois.
export async function handleOwnerMedia(ref: MediaRef): Promise<void> {
  const kind = ref.mediaType;
  const limit = MAX_BYTES[kind];
  if (ref.size !== null && ref.size > limit) {
    await notifyOwner(`${MEDIA_LABEL[kind][0].toUpperCase()}${MEDIA_LABEL[kind].slice(1)} passa de ${Math.round(limit / 1024 / 1024)} MB. Mande um arquivo menor.`);
    return;
  }
  try {
    await notifyOwner(`Recebi ${MEDIA_LABEL[kind]}, analisando${kind === "video" ? " (vídeos podem levar até 1 ou 2 minutos)" : ""}...`);
    const { data, mimetype } = await downloadMedia(ref.key, ref.mimetype, limit);
    const name = ref.fileName || `${kind === "image" ? "imagem" : kind === "video" ? "video" : "documento"}${MEDIA_EXT[mimetype] ?? ""}`;
    const path = saveMedia(data, name);
    const base = { mediaType: kind, fileName: ref.fileName, caption: ref.caption, path } as const;
    let prompt: string;
    if (kind === "image") {
      prompt = buildMediaPrompt(base);
    } else if (kind === "document") {
      const docType = classifyDocument(mimetype, ref.fileName);
      if (docType === "unsupported") {
        await notifyOwner(`Não consigo ler esse tipo de arquivo (${ref.fileName || mimetype}). Aceito PDF, Word (.docx), Excel (.xlsx), texto, CSV e JSON.`);
        return;
      }
      const text = docType === "pdf" ? undefined : docType === "docx" ? docxToText(data) : docType === "xlsx" ? xlsxToText(data) : data.toString("utf8");
      prompt = buildMediaPrompt({ ...base, docType, text });
    } else {
      const duration = await videoDuration(path);
      const parts = await extractVideoParts(path, duration);
      const transcribe = transcriberFromEnv();
      let transcript: string | null = null;
      let note: string | undefined;
      if (parts.audio && transcribe) transcript = (await transcribe(parts.audio, "audio/mpeg").catch(() => "")) || null;
      if (duration !== null && duration > MAX_VIDEO_SECONDS) note = `O vídeo tem ${Math.round(duration)} s: só vi os quadros, sem transcrever o áudio.`;
      else if (duration !== null && duration > MAX_TRANSCRIBE_SECONDS) note = `O vídeo tem ${Math.round(duration)} s: transcrevi só os primeiros ${MAX_TRANSCRIBE_SECONDS} s do áudio.`;
      prompt = buildMediaPrompt({ ...base, transcript, frames: parts.frames, note });
    }
    await recordMessage(getDb(), { channel: "whatsapp", author: "owner", text: `[${kind === "image" ? "imagem" : kind === "video" ? "vídeo" : "documento"}${ref.fileName ? ` ${ref.fileName}` : ""}] ${ref.caption}`.trim() });
    await handleOwnerMessage(prompt);
  } catch (error) {
    console.error("[midia]", error instanceof Error ? error.message : error);
    await notifyOwner(`Não consegui abrir ${MEDIA_LABEL[kind]} agora${error instanceof Error && /maior que/.test(error.message) ? `: ${error.message}` : ""}. Tente de novo ou me diga o que precisa em texto.`);
  }
}

export interface MemberAudioRef extends AudioRef {
  name: string;
}

// Áudio de um membro autorizado (permissão conversa.maia): mesma transcrição do áudio do dono, mas a resposta
// sai no privado do próprio membro e segue as permissões dele (decidido por handleMemberMessage/decideAccess).
export async function handleMemberAudio(ref: MemberAudioRef): Promise<void> {
  const digits = ref.from.replace(/\D/g, "");
  const who = await resolveRequester(getDb(), digits, ref.name);
  if (!canConverse(who)) return; // a permissão pode ter sido retirada entre o envio e o processamento
  const transcribe = transcriberFromEnv();
  if (!transcribe) {
    await sendOwnerText(digits, AUDIO_UNAVAILABLE).catch(() => {});
    return;
  }
  try {
    await sendOwnerText(digits, "Recebi o áudio, transcrevendo (pode levar até um minuto)...");
    const { data, mimetype } = await downloadAudio(ref.key, ref.mimetype);
    const text = (await transcribe(data, mimetype)).trim();
    if (!text) {
      await sendOwnerText(digits, "Não consegui entender o áudio. Pode mandar de novo ou em texto?");
      return;
    }
    await recordConvMessage(getDb(), { conv: `dm:${digits}`, participant: digits, name: ref.name, text }).catch(() => {});
    await handleMemberMessage({ from: ref.from, name: ref.name, text });
  } catch (error) {
    console.error("[audio-membro]", error instanceof Error ? error.message : error);
    await sendOwnerText(digits, "Não consegui processar o áudio agora. Tente de novo ou mande em texto.").catch(() => {});
  }
}

export interface GroupAudioRef extends AudioRef {
  jid: string;
  participant: string;
  name: string;
  // Já decidido em server/inbox.ts (menção, resposta à Maia ou conversa em andamento) — sem o texto ainda,
  // já que áudio só tem texto depois de transcrito. A chamada pelo nome (CALLS_MAIA) é somada aqui, no texto.
  addressed: boolean;
}

// Áudio num grupo cadastrado: transcreve e trata como o texto do grupo (mesma memória de 7 dias, mesma regra
// de só responder quando chamada). Sem avisos de "transcrevendo": isso poluiria o grupo para quem não pediu nada.
export async function handleGroupAudio(ref: GroupAudioRef): Promise<void> {
  const transcribe = transcriberFromEnv();
  if (!transcribe) return;
  try {
    const { data, mimetype } = await downloadAudio(ref.key, ref.mimetype);
    const text = (await transcribe(data, mimetype)).trim();
    if (!text) return;
    await recordConvMessage(getDb(), { conv: ref.jid, participant: ref.participant, name: ref.name, text }).catch((error) => console.error("[audio-grupo] conversa:", error instanceof Error ? error.message : error));
    if (!ref.addressed && !CALLS_MAIA.test(text)) return;
    await handleGroupMessage({ jid: ref.jid, participant: ref.participant, name: ref.name, text });
  } catch (error) {
    console.error("[audio-grupo]", error instanceof Error ? error.message : error);
  }
}

export interface MemberMediaRef extends MediaRef {
  name: string;
}

// Imagem, vídeo ou documento de um membro autorizado: o mesmo entendimento do dono (ver server/media.ts), mas o
// arquivo fica em data/midia-membros por 7 dias (decisão do owner, 2026-10-09) e o metadado vai para
// received_media, para o owner poder pedir o arquivo de volta depois (ferramenta arquivo_reenviar).
export async function handleMemberMedia(ref: MemberMediaRef): Promise<void> {
  const digits = ref.from.replace(/\D/g, "");
  const who = await resolveRequester(getDb(), digits, ref.name);
  if (!canConverse(who)) return;
  const kind = ref.mediaType;
  const limit = MAX_BYTES[kind];
  const requesterName = who.name || ref.name || `+${digits}`;
  if (ref.size !== null && ref.size > limit) {
    await sendOwnerText(digits, `${MEDIA_LABEL[kind][0].toUpperCase()}${MEDIA_LABEL[kind].slice(1)} passa de ${Math.round(limit / 1024 / 1024)} MB. Mande um arquivo menor.`).catch(() => {});
    return;
  }
  try {
    await sendOwnerText(digits, `Recebi ${MEDIA_LABEL[kind]}, analisando${kind === "video" ? " (vídeos podem levar até 1 ou 2 minutos)" : ""}...`);
    const { data, mimetype } = await downloadMedia(ref.key, ref.mimetype, limit);
    const name = ref.fileName || `${kind === "image" ? "imagem" : kind === "video" ? "video" : "documento"}${MEDIA_EXT[mimetype] ?? ""}`;
    const path = saveMedia(data, name, Date.now(), MEMBER_MEDIA_DIR);
    await recordReceivedMedia(getDb(), { conv: `dm:${digits}`, fromNumber: digits, fromName: requesterName, mediaType: kind, fileName: ref.fileName, caption: ref.caption, path, mimetype }).catch((error) => console.error("[midia-membro] registro:", error instanceof Error ? error.message : error));
    const base = { mediaType: kind, fileName: ref.fileName, caption: ref.caption, path, sender: requesterName } as const;
    let prompt: string;
    if (kind === "image") {
      prompt = buildMediaPrompt(base);
    } else if (kind === "document") {
      const docType = classifyDocument(mimetype, ref.fileName);
      if (docType === "unsupported") {
        await sendOwnerText(digits, `Não consigo ler esse tipo de arquivo (${ref.fileName || mimetype}). Aceito PDF, Word (.docx), Excel (.xlsx), texto, CSV e JSON.`);
        return;
      }
      const text = docType === "pdf" ? undefined : docType === "docx" ? docxToText(data) : docType === "xlsx" ? xlsxToText(data) : data.toString("utf8");
      prompt = buildMediaPrompt({ ...base, docType, text });
    } else {
      const duration = await videoDuration(path);
      const parts = await extractVideoParts(path, duration);
      const transcribe = transcriberFromEnv();
      let transcript: string | null = null;
      let note: string | undefined;
      if (parts.audio && transcribe) transcript = (await transcribe(parts.audio, "audio/mpeg").catch(() => "")) || null;
      if (duration !== null && duration > MAX_VIDEO_SECONDS) note = `O vídeo tem ${Math.round(duration)} s: só vi os quadros, sem transcrever o áudio.`;
      else if (duration !== null && duration > MAX_TRANSCRIBE_SECONDS) note = `O vídeo tem ${Math.round(duration)} s: transcrevi só os primeiros ${MAX_TRANSCRIBE_SECONDS} s do áudio.`;
      prompt = buildMediaPrompt({ ...base, transcript, frames: parts.frames, note });
    }
    const label = `[${kind === "image" ? "imagem" : kind === "video" ? "vídeo" : "documento"}${ref.fileName ? ` ${ref.fileName}` : ""}] ${ref.caption}`.trim();
    await recordConvMessage(getDb(), { conv: `dm:${digits}`, participant: digits, name: requesterName, text: label }).catch(() => {});
    await handleMemberMessage({ from: ref.from, name: ref.name, text: prompt });
  } catch (error) {
    console.error("[midia-membro]", error instanceof Error ? error.message : error);
    await sendOwnerText(digits, `Não consegui abrir ${MEDIA_LABEL[kind]} agora${error instanceof Error && /maior que/.test(error.message) ? `: ${error.message}` : ""}. Tente de novo ou me diga o que precisa em texto.`).catch(() => {});
  }
}
