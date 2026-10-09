import { downloadAudio, sendOwnerText } from "./evolutionSend.ts";
import type { AudioRef } from "./evolutionWebhook.ts";
import { transcriberFromEnv } from "./transcribe.ts";
import { handleOwnerMessage } from "./maiaOwnerAgent.ts";
import { parseCreateGroup, parseOwnerTask, requestCreateGroup } from "./groups.ts";
import { createOwnerTask, getDb, recordMessage } from "./store.ts";

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
  const groupRequest = parseCreateGroup(text);
  if (groupRequest) {
    const reply = await requestCreateGroup(deps, groupRequest.name, groupRequest.participants);
    await notifyOwner(reply);
    return null;
  }
  const task = parseOwnerTask(text);
  if (task) {
    const taskId = await createOwnerTask(db, { title: task.title, groupName: task.groupName });
    await notifyOwner(`Tarefa #${taskId} criada: ${task.title}${task.groupName ? ` (grupo ${task.groupName})` : ""}.`);
    return null;
  }
  return handleOwnerMessage(text);
}

const AUDIO_UNAVAILABLE = "Recebi seu áudio, mas ainda não consigo transcrever áudios nesta Maia. Pode mandar em texto por enquanto.";

// Áudio do dono: baixa pela Evolution, transcreve e trata o texto como um comando digitado.
// O áudio não é gravado; o texto transcrito segue as mesmas regras do texto (guardado só para o dono).
export async function handleOwnerAudio(ref: AudioRef): Promise<void> {
  const transcribe = transcriberFromEnv();
  if (!transcribe) {
    await notifyOwner(AUDIO_UNAVAILABLE);
    return;
  }
  try {
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
