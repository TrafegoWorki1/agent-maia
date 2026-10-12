import { canonicalPhone } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

// Agenda de contatos da Maia. Preenche sozinha com quem fala nos grupos cadastrados; o dono corrige nome e apelido.
// O número é sempre real (nunca inventado): vem do WhatsApp ou do cadastro.

export interface Contact {
  number: string;
  name: string;
  aliases: string[];
}

const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

export async function upsertContact(db: Db, input: { number: string; name: string; conv?: string | null; source?: "grupo" | "cadastrado" | "mensagem" }): Promise<void> {
  const number = input.number.replace(/\D/g, "");
  if (number.length < 10 || number.length > 15) return;
  const { data } = await db.from("contacts").select("number, name").eq("number", number).maybeSingle();
  if (!data) {
    const { error } = await db.from("contacts").insert({ number, name: input.name.slice(0, 60), source: input.source ?? "grupo", first_conv: input.conv ?? null });
    if (error && error.code !== "23505") throw new Error(`contato: ${error.message}`);
    return;
  }
  // Mantém o nome já salvo (o dono pode ter corrigido); só preenche se estava vazio.
  const patch: Record<string, unknown> = { last_seen: new Date().toISOString() };
  if (!data.name && input.name) patch.name = input.name.slice(0, 60);
  await db.from("contacts").update(patch).eq("number", number);
}

// Casa "Jéssica", "jessica" ou um número com os contatos. Nome parcial vale se for único.
export function matchContacts(all: Contact[], query: string): Contact[] {
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 10) return all.filter((c) => canonicalPhone(c.number) === canonicalPhone(digits));
  const q = norm(query);
  if (!q) return [];
  const exact = all.filter((c) => norm(c.name) === q || c.aliases.some((a) => norm(a) === q));
  if (exact.length > 0) return exact;
  return all.filter((c) => norm(c.name).includes(q) || c.aliases.some((a) => norm(a).includes(q)));
}

export async function loadContacts(db: Db): Promise<Contact[]> {
  const { data, error } = await db.from("contacts").select("number, name, aliases");
  if (error) throw new Error(`contatos: ${error.message}`);
  return (data ?? []).map((r) => ({ number: String(r.number), name: String(r.name), aliases: (r.aliases ?? []) as string[] }));
}

export async function resolveContact(db: Db, query: string): Promise<{ ok: true; contact: Contact } | { ok: false; error: string }> {
  const hits = matchContacts(await loadContacts(db), query);
  if (hits.length === 1) return { ok: true, contact: hits[0] };
  if (hits.length === 0) return { ok: false, error: `não tenho "${query}" nos contatos. Salve com contato_salvar (nome e número) e envie de novo` };
  return { ok: false, error: `há ${hits.length} contatos para "${query}" (${hits.slice(0, 4).map((c) => `${c.name || "sem nome"} +${c.number}`).join("; ")}). Diga qual` };
}

// Contato avulso: só entra na agenda (permite à Maia enviar e receber o repasse), sem Pessoa, papel nem permissão.
export async function saveContact(db: Db, input: { name: string; number: string }): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const number = input.number.replace(/\D/g, "");
  if (number.length < 12 || number.length > 13) return { ok: false, error: "número inválido (use DDI+DDD+número)" };
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "falta o nome" };
  const existing = (await loadContacts(db)).find((c) => canonicalPhone(c.number) === canonicalPhone(number));
  if (existing) return { ok: true, created: false };
  try {
    await upsertContact(db, { number, name, source: "cadastrado" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, created: true };
}

// A Maia mandou mensagem a este número nas últimas 48 h? Compara pelo número canônico (com ou sem o nono dígito).
export async function hasRecentOutreach(db: Db, number: string, now = Date.now()): Promise<boolean> {
  const since = new Date(now - 48 * 3600_000).toISOString();
  const { data } = await db.from("outreach").select("number").gte("at", since);
  const wanted = canonicalPhone(number);
  return (data ?? []).some((r) => canonicalPhone(String(r.number)) === wanted);
}

// Cadastra um membro da equipe: pessoa com número e permissões. Só quando o dono pede para adicionar à equipe.
export async function registerMember(db: Db, input: { name: string; number: string; permissions?: string[] }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const number = input.number.replace(/\D/g, "");
  if (number.length < 12 || number.length > 13) return { ok: false, error: "número inválido (use DDI+DDD+número)" };
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, error: "falta o nome" };
  const { data: existing } = await db.from("person_numbers").select("person_id").eq("number", number).maybeSingle();
  if (existing) return { ok: false, error: "esse número já está cadastrado em Pessoas" };
  const created = await db.from("people").insert({ name, role: "equipe", active: true }).select("id").single();
  if (created.error || !created.data) return { ok: false, error: `não consegui cadastrar: ${created.error?.message ?? "sem retorno"}` };
  const id = String(created.data.id);
  const nums = await db.from("person_numbers").insert({ number, person_id: id });
  if (nums.error) return { ok: false, error: `não consegui salvar o número: ${nums.error.message}` };
  const allowed = new Set(["conversa.maia", "resumo.ver", ...(input.permissions ?? [])]);
  const catalog = await db.from("permission_catalog").select("code");
  const valid = new Set((catalog.data ?? []).map((c) => String(c.code)));
  const rows = [...allowed].filter((p) => valid.has(p)).map((permission_code) => ({ person_id: id, permission_code }));
  if (rows.length > 0) await db.from("person_permissions").insert(rows);
  await upsertContact(db, { number, name, source: "cadastrado" });
  return { ok: true, id };
}
