// Banco temporário e isolado (PGlite, Postgres em memória). Aplica o bootstrap da plataforma e depois TODAS as
// migrações de supabase/migrations, em ordem. Nunca toca em banco remoto.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { SNAPSHOT_SQL, type SnapshotRow } from "./snapshot.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
export const BOOTSTRAP_FILE = join(ROOT, "supabase", "ci", "bootstrap.sql");
export const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export function listMigrations(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export interface LocalDb {
  db: PGlite;
  applied: string[];
  snapshot(): Promise<SnapshotRow[]>;
  close(): Promise<void>;
}

export async function buildLocalDb(dir = MIGRATIONS_DIR): Promise<LocalDb> {
  const db = new PGlite({ extensions: { vector } });
  await db.exec(readFileSync(BOOTSTRAP_FILE, "utf8"));
  const applied: string[] = [];
  for (const file of listMigrations(dir)) {
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migração ${file} falhou: ${error instanceof Error ? error.message : String(error)}`);
    }
    applied.push(file);
  }
  return {
    db,
    applied,
    snapshot: async () => (await db.query<SnapshotRow>(SNAPSHOT_SQL)).rows,
    close: () => db.close(),
  };
}
