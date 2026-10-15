import { z } from "zod";
import type { Db } from "./store.ts";

export const ownerMemoryKind = z.enum(["compromisso", "contexto", "preferencia"]);
export const ownerMemoryStatus = z.enum(["active", "completed", "archived"]);
export type OwnerMemoryKind = z.infer<typeof ownerMemoryKind>;
export type OwnerMemoryStatus = z.infer<typeof ownerMemoryStatus>;

export interface OwnerMemory {
  id: number;
  created_at: string;
  updated_at: string;
  title: string;
  detail: string;
  kind: OwnerMemoryKind;
  status: OwnerMemoryStatus;
  due_at: string | null;
  source_task_id: number | null;
  created_by: "maia" | "owner";
  completed_at: string | null;
  revision: number;
}
const SELECT = "id,created_at,updated_at,title,detail,kind,status,due_at,source_task_id,created_by,completed_at,revision";

export async function listOwnerMemories(db: Db, includeInactive = false, limit = 100): Promise<OwnerMemory[]> {
  let query = db.from("owner_memories").select(SELECT).order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(limit, 200)));
  if (!includeInactive) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(`Memória da Maia indisponível: ${error.message}`);
  return (data ?? []) as OwnerMemory[];
}

export function rankOwnerMemories(rows: OwnerMemory[], query: string, limit = 10): OwnerMemory[] {
  const terms = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2);
  if (!terms.length) return rows.slice(0, Math.max(1, Math.min(limit, 30)));
  return rows.map((row) => {
    const text = `${row.title} ${row.detail}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return { row, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || Date.parse(b.row.updated_at) - Date.parse(a.row.updated_at)).slice(0, Math.max(1, Math.min(limit, 30))).map((item) => item.row);
}

export async function searchOwnerMemories(db: Db, query: string, limit = 10): Promise<OwnerMemory[]> {
  return rankOwnerMemories(await listOwnerMemories(db, false, 200), query, limit);
}

export async function saveOwnerMemory(db: Db, input: { title: string; detail: string; kind?: OwnerMemoryKind; due_at?: string | null; source_task_id?: number | null; created_by?: "maia" | "owner" }, now = new Date()): Promise<OwnerMemory> {
  const parsed = z.object({ title: z.string().trim().min(1).max(160), detail: z.string().trim().min(1).max(4000), kind: ownerMemoryKind.default("compromisso"), due_at: z.string().datetime({ offset: true }).nullable().optional(), source_task_id: z.number().int().positive().nullable().optional(), created_by: z.enum(["maia", "owner"]).default("maia") }).parse(input);
  const { data, error } = await db.from("owner_memories").insert({ ...parsed, status: "active", updated_at: now.toISOString() }).select(SELECT).single();
  if (error) throw new Error(`Não consegui registrar na memória da Maia: ${error.message}`);
  return data as OwnerMemory;
}

export async function updateOwnerMemory(db: Db, input: unknown, now = new Date()): Promise<OwnerMemory> {
  const value = z.object({ id: z.number().int().positive(), revision: z.number().int().positive(), title: z.string().trim().min(1).max(160).optional(), detail: z.string().trim().min(1).max(4000).optional(), kind: ownerMemoryKind.optional(), status: ownerMemoryStatus.optional(), due_at: z.string().datetime({ offset: true }).nullable().optional() }).refine((v) => Object.keys(v).some((key) => !["id", "revision"].includes(key)), "Informe ao menos uma alteração").parse(input);
  const patch: Record<string, unknown> = { updated_at: now.toISOString(), revision: value.revision + 1 };
  for (const key of ["title", "detail", "kind", "status", "due_at"] as const) if (value[key] !== undefined) patch[key] = value[key];
  if (value.status === "completed") patch.completed_at = now.toISOString();
  if (value.status && value.status !== "completed") patch.completed_at = null;
  const { data, error } = await db.from("owner_memories").update(patch).eq("id", value.id).eq("revision", value.revision).select(SELECT).maybeSingle();
  if (error) throw new Error(`Não consegui atualizar a memória da Maia: ${error.message}`);
  if (!data) throw new Error("Este registro mudou em outra sessão. Atualize o painel e tente novamente.");
  return data as OwnerMemory;
}

export async function ownerMemoryContext(db: Db): Promise<string> {
  const rows = await listOwnerMemories(db, false, 30);
  let remaining = 9000;
  const lines: string[] = [];
  for (const row of rows) {
    const due = row.due_at ? ` · prazo ${new Date(row.due_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "";
    const line = `- [${row.kind}] ${row.title}${due}: ${row.detail.slice(0, 800)}`;
    if (line.length > remaining) break;
    lines.push(line);
    remaining -= line.length;
  }
  return lines.join("\n");
}
