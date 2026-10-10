import type { Db } from "./store.ts";
import type { MediaKind } from "./media.ts";

// Metadados dos arquivos que membros e contatos mandaram à Maia (nunca os do dono: o reenvio é só de terceiros).
// Serve para o owner pedir "me manda o arquivo que a Jéssica mandou" depois, sem precisar pedir de novo à pessoa.

export interface ReceivedMediaInput {
  conv: string;
  fromNumber: string;
  fromName: string;
  mediaType: MediaKind;
  fileName: string;
  caption: string;
  path: string;
  mimetype: string;
}

export async function recordReceivedMedia(db: Db, input: ReceivedMediaInput): Promise<void> {
  const { error } = await db.from("received_media").insert({
    conv: input.conv,
    from_number: input.fromNumber,
    from_name: input.fromName.slice(0, 60),
    media_type: input.mediaType,
    file_name: input.fileName.slice(0, 120),
    caption: input.caption.slice(0, 1000),
    path: input.path,
    mimetype: input.mimetype,
  });
  if (error) throw new Error(`mídia recebida: ${error.message}`);
}

export interface ReceivedMediaRow {
  id: number;
  conv: string;
  fromNumber: string;
  fromName: string;
  mediaType: MediaKind;
  fileName: string;
  caption: string;
  path: string;
  mimetype: string;
  receivedAt: string;
}

function toRow(r: Record<string, unknown>): ReceivedMediaRow {
  return {
    id: Number(r.id),
    conv: String(r.conv),
    fromNumber: String(r.from_number),
    fromName: String(r.from_name),
    mediaType: r.media_type as MediaKind,
    fileName: String(r.file_name),
    caption: String(r.caption),
    path: String(r.path),
    mimetype: String(r.mimetype),
    receivedAt: String(r.received_at),
  };
}

// Casa "query" contra o nome ou o número de quem mandou. Sem query, pega o mais recente de qualquer pessoa.
export function matchReceivedMedia(rows: ReceivedMediaRow[], query?: string): ReceivedMediaRow | null {
  if (!rows.length) return null;
  if (!query?.trim()) return rows[0];
  const q = query.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const hit = rows.find((r) => (digits.length >= 8 && r.fromNumber.includes(digits)) || r.fromName.toLowerCase().includes(q));
  return hit ?? null;
}

// Últimos arquivos recebidos (até 30), mais recente primeiro, para o matchReceivedMedia escolher.
export async function findReceivedMedia(db: Db, query?: string): Promise<ReceivedMediaRow | null> {
  const { data, error } = await db.from("received_media").select("*").order("received_at", { ascending: false }).limit(30);
  if (error) throw new Error(`mídia recebida: ${error.message}`);
  return matchReceivedMedia((data ?? []).map(toRow), query);
}
