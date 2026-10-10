import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import type { Db } from "../store.ts";
import { MEDIA_DIR, safeName } from "../media.ts";

// Ponte temporária para mídia do dono precisar de um endereço público (ex.: subir vídeo/imagem
// no Meta Ads, cuja ferramenta de upload por URL exige um link https direto, sem login). Usa um
// bucket privado do Supabase (projeto da própria Maia) e devolve uma URL assinada, de curta duração.
// Nunca fica pública por padrão: o bucket é privado e o arquivo é apagado pela limpeza periódica.

export const ADS_MEDIA_BUCKET = "ads_media_temp";
const SIGNED_URL_TTL_SECONDS = 2 * 60 * 60; // 2 horas: dá tempo do Meta Ads processar o vídeo
export const ADS_MEDIA_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // mesmo teto de vídeo do Meta Ads (100 MiB)

let ensured = false;

// Cria o bucket se não existir. Idempotente; chamado antes de cada upload, sem recriar à toa.
export async function ensureAdsMediaBucket(db: Db): Promise<void> {
  if (ensured) return;
  const { data } = await db.storage.getBucket(ADS_MEDIA_BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(ADS_MEDIA_BUCKET, {
      public: false,
      fileSizeLimit: MAX_UPLOAD_BYTES,
      allowedMimeTypes: ["image/jpeg", "image/png", "video/mp4", "video/quicktime"],
    });
    if (error && !/already exists/i.test(error.message)) throw new Error(`bucket de mídia de anúncio: ${error.message}`);
  }
  ensured = true;
}

// Só arquivos dentro de data/midia (mídia que o próprio dono mandou pelo WhatsApp). Nada de caminho
// fora da pasta, e nada de pasta de artes (essa já tem seu próprio fluxo via Zernio).
export function resolveOwnerMediaPath(inputPath: string): { ok: true; path: string } | { ok: false; error: string } {
  const full = resolve(inputPath);
  const rel = relative(MEDIA_DIR, full);
  if (rel.startsWith("..") || rel === "" || resolve(MEDIA_DIR, rel) !== full) return { ok: false, error: "o arquivo precisa ser uma mídia que o dono mandou pelo WhatsApp (pasta data/midia)" };
  if (!existsSync(full)) return { ok: false, error: "arquivo não encontrado (pode já ter vencido a retenção de 24h)" };
  if (statSync(full).size > MAX_UPLOAD_BYTES) return { ok: false, error: "o arquivo passa de 100 MB" };
  return { ok: true, path: full };
}

function contentTypeOf(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.(jpe?g)$/i.test(path)) return "image/jpeg";
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.(mov|qt)$/i.test(path)) return "video/quicktime";
  return "application/octet-stream";
}

export interface TempAdMediaUrl {
  url: string;
  storagePath: string;
  expiresInSeconds: number;
}

// Sobe o arquivo ao bucket temporário e devolve uma URL assinada (expira em 2h). Quem chama ainda
// precisa usar essa URL numa ferramenta de anúncios (ex.: ads_creative_upload_media, upload_source
// URL) — isto só prepara o endereço público, não sobe nada no Meta Ads.
export async function uploadTempAdMedia(db: Db, path: string): Promise<TempAdMediaUrl> {
  await ensureAdsMediaBucket(db);
  const contentType = contentTypeOf(path);
  const storagePath = `temp/${Date.now()}-${safeName(basename(path), "midia")}`;
  const data = readFileSync(path);
  const { error: uploadError } = await db.storage.from(ADS_MEDIA_BUCKET).upload(storagePath, data, { contentType, upsert: false });
  if (uploadError) throw new Error(`envio ao bucket temporário: ${uploadError.message}`);
  const { data: signed, error: signError } = await db.storage.from(ADS_MEDIA_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) throw new Error(`gerar link temporário: ${signError?.message ?? "sem URL devolvida"}`);
  return { url: signed.signedUrl, storagePath, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}

// Limpeza periódica: apaga arquivos do bucket mais velhos que o teto (2h por padrão), mesmo que a
// URL assinada já tenha expirado por conta própria — não depende só da expiração do link.
export async function purgeTempAdMedia(db: Db, maxAgeMs = ADS_MEDIA_MAX_AGE_MS, now = Date.now()): Promise<number> {
  const { data, error } = await db.storage.from(ADS_MEDIA_BUCKET).list("temp", { limit: 200 });
  if (error) return 0; // bucket pode nem existir ainda; nada a limpar
  const stale = (data ?? []).filter((item) => item.created_at && now - Date.parse(item.created_at) > maxAgeMs).map((item) => `temp/${item.name}`);
  if (stale.length === 0) return 0;
  const { error: removeError } = await db.storage.from(ADS_MEDIA_BUCKET).remove(stale);
  if (removeError) throw new Error(`limpeza do bucket temporário: ${removeError.message}`);
  return stale.length;
}
