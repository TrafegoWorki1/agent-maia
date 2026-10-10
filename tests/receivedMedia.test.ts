import { describe, expect, it } from "vitest";
import { findReceivedMedia, matchReceivedMedia, recordReceivedMedia, type ReceivedMediaRow } from "../server/receivedMedia.ts";
import type { Db } from "../server/store.ts";

// Metadados dos arquivos que membros e contatos mandam à Maia (para o owner pedir "me manda esse arquivo" depois).

function fakeDb(rows: Record<string, unknown>[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    from: (table: string) => {
      if (table !== "received_media") throw new Error(`tabela inesperada: ${table}`);
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: null });
        },
        select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }),
      };
    },
  } as unknown as Db;
  return { db, inserted };
}

const dbRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  conv: "dm:5585911112222",
  from_number: "5585911112222",
  from_name: "Jéssica",
  media_type: "image",
  file_name: "foto.jpg",
  caption: "olha",
  path: "/tmp/x.jpg",
  mimetype: "image/jpeg",
  received_at: "2026-10-09T10:00:00Z",
  ...over,
});

describe("gravação e busca no banco", () => {
  it("grava os metadados do arquivo recebido", async () => {
    const { db, inserted } = fakeDb();
    await recordReceivedMedia(db, {
      conv: "dm:5585911112222",
      fromNumber: "5585911112222",
      fromName: "Jéssica",
      mediaType: "image",
      fileName: "foto.jpg",
      caption: "olha",
      path: "/tmp/x.jpg",
      mimetype: "image/jpeg",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ conv: "dm:5585911112222", media_type: "image", path: "/tmp/x.jpg", from_name: "Jéssica" });
  });

  it("acha por nome, por número ou, sem filtro, o mais recente", async () => {
    const { db } = fakeDb([dbRow({ id: 2, from_name: "Jefferson", from_number: "5585955556666" }), dbRow({ id: 1 })]);
    expect((await findReceivedMedia(db))?.id).toBe(2);
    expect((await findReceivedMedia(db, "Jéssica"))?.id).toBe(1);
    expect((await findReceivedMedia(db, "5585955556666"))?.id).toBe(2);
    expect(await findReceivedMedia(db, "ninguém mandou isso")).toBeNull();
  });

  it("sem nenhum arquivo, devolve null", async () => {
    const { db } = fakeDb([]);
    expect(await findReceivedMedia(db)).toBeNull();
  });
});

describe("matchReceivedMedia (função pura)", () => {
  const rows: ReceivedMediaRow[] = [
    { id: 1, conv: "dm:1", fromNumber: "5585911112222", fromName: "Jéssica", mediaType: "image", fileName: "a.jpg", caption: "", path: "p1", mimetype: "image/jpeg", receivedAt: "2026-10-09T10:00:00Z" },
    { id: 2, conv: "dm:2", fromNumber: "5585955556666", fromName: "Jefferson", mediaType: "document", fileName: "b.pdf", caption: "", path: "p2", mimetype: "application/pdf", receivedAt: "2026-10-09T11:00:00Z" },
  ];
  it("sem query, pega o primeiro (o mais recente, pela ordenação do banco)", () => {
    expect(matchReceivedMedia(rows)?.id).toBe(1);
    expect(matchReceivedMedia([])).toBeNull();
  });
  it("por nome (sem acento/maiúscula) ou por número", () => {
    expect(matchReceivedMedia(rows, "jefferson")?.id).toBe(2);
    expect(matchReceivedMedia(rows, "+55 85 95555-6666")?.id).toBe(2);
    expect(matchReceivedMedia(rows, "ninguém")).toBeNull();
  });
});
