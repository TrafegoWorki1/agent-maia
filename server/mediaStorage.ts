import { readFileSync } from "node:fs";
import { supabaseFromEnv } from "./supabaseClient.ts";

const BUCKET = "midia-recebida";

// Faz upload de um arquivo baixado para o bucket Supabase Storage e devolve a URL pública assinada
// (válida por 7 dias, mesma retenção do disco local). Lança se o Supabase rejeitar.
// Caminho no bucket: <conv>/<timestamp>-<fileName> — sem colisão e rastreável por conversa.
export async function uploadReceivedMedia(
  data: Buffer,
  fileName: string,
  mimetype: string,
  conv: string,
): Promise<string> {
  const client = supabaseFromEnv();
  const ts = Date.now();
  const storagePath = `${conv}/${ts}-${fileName}`;
  const { error } = await client.storage.from(BUCKET).upload(storagePath, data, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Storage upload falhou: ${error.message}`);
  // URL assinada de 7 dias — mesma janela que MEMBER_MEDIA_TTL_MS.
  const { data: signed, error: signErr } = await client.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 7 * 24 * 3600);
  if (signErr || !signed?.signedUrl) throw new Error(`Storage URL falhou: ${signErr?.message ?? "sem URL"}`);
  return signed.signedUrl;
}
