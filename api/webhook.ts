import type { IncomingMessage, ServerResponse } from "node:http";
import { tokenFromRequest, tokenMatches } from "../server/evolutionWebhook.ts";
import { toInboxRow, type GroupState } from "../server/inbox.ts";
import { supabaseFromEnv } from "../server/supabaseClient.ts";

// Rota do webhook na Vercel (/api/webhook). Só recebe e grava na fila `inbox` do Supabase.
// Não chama o Claude, não envia mensagem e não lê o banco: quem processa é o worker do PC.
// Resposta 200 só depois de gravar; erro de gravação responde 500 e a Evolution tenta de novo.

const MAX_BODY_BYTES = 64_000;
const UNIQUE_VIOLATION = "23505";

type Req = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// A Vercel pode já ter lido o corpo (req.body). Se não, lemos o stream com limite de tamanho.
async function readBody(req: Req): Promise<string | null> {
  if (req.body !== undefined) return typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) return null;
  }
  return raw;
}

// Grupos em que a Maia atende. Cache de 10 s para não consultar o banco a cada evento.
let groupsCache: { at: number; jids: Map<string, GroupState> } | null = null;
async function maiaGroups(): Promise<Map<string, GroupState>> {
  // 10 s: a conversa em andamento (última resposta da Maia) precisa chegar rápido ao webhook.
  if (groupsCache && Date.now() - groupsCache.at < 10_000) return groupsCache.jids;
  try {
    const { data } = await supabaseFromEnv().from("maia_groups").select("jid, last_reply_at, last_reply_to").eq("active", true);
    groupsCache = { at: Date.now(), jids: new Map((data ?? []).map((r) => [String(r.jid), { lastReplyAt: r.last_reply_at as string | null, lastReplyTo: r.last_reply_to as string | null }] as [string, GroupState])) };
  } catch {
    // Sem o banco, mantém a última lista conhecida; a mensagem ainda é gravada sem texto.
    groupsCache = { at: Date.now(), jids: groupsCache?.jids ?? new Map() };
  }
  return groupsCache.jids;
}

// Números que a Maia contatou nas últimas 48 h (tabela outreach). A resposta deles entra na fila com texto.
let contactedCache: { at: number; numbers: Set<string> } | null = null;
async function contactedNumbers(): Promise<Set<string>> {
  if (contactedCache && Date.now() - contactedCache.at < 10_000) return contactedCache.numbers;
  try {
    const since = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data } = await supabaseFromEnv().from("outreach").select("number").gte("at", since);
    contactedCache = { at: Date.now(), numbers: new Set((data ?? []).map((r) => String(r.number))) };
  } catch {
    contactedCache = { at: Date.now(), numbers: contactedCache?.numbers ?? new Set() };
  }
  return contactedCache.numbers;
}

// Números de pessoas cadastradas, ativas, com a permissão conversa.maia (decisão do owner, 2026-10-09: membro pode
// falar com a Maia no privado, dentro do que pode). Cache de 10 s, mesmo padrão dos outros.
let membersCache: { at: number; numbers: Set<string> } | null = null;
async function membersWithConversa(): Promise<Set<string>> {
  if (membersCache && Date.now() - membersCache.at < 10_000) return membersCache.numbers;
  try {
    const db = supabaseFromEnv();
    const perms = await db.from("person_permissions").select("person_id").eq("permission_code", "conversa.maia");
    const personIds = [...new Set((perms.data ?? []).map((r) => r.person_id))];
    let numbers = new Set<string>();
    if (personIds.length > 0) {
      const people = await db.from("people").select("id").in("id", personIds).eq("active", true).neq("role", "proprietario");
      const activeIds = (people.data ?? []).map((r) => r.id);
      if (activeIds.length > 0) {
        const nums = await db.from("person_numbers").select("number").in("person_id", activeIds);
        numbers = new Set((nums.data ?? []).map((r) => String(r.number)));
      }
    }
    membersCache = { at: Date.now(), numbers };
  } catch {
    // Sem o banco, mantém a última lista conhecida; sem lista, nenhum membro fala no privado.
    membersCache = { at: Date.now(), numbers: membersCache?.numbers ?? new Set() };
  }
  return membersCache.numbers;
}

export default async function handler(req: Req, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  const url = new URL(req.url ?? "/", "http://localhost");
  const token = tokenFromRequest(url.searchParams.get("token"), req.headers["x-webhook-token"]);
  if (!tokenMatches(token, process.env.EVOLUTION_WEBHOOK_SECRET)) return send(res, 401, { error: "unauthorized" });

  const raw = await readBody(req);
  if (raw === null) return send(res, 413, { error: "too_large" });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }

  const row = toInboxRow(body, process.env.EVOLUTION_OWNER_NUMBER, process.env.EVOLUTION_APPROVER_NUMBER, await maiaGroups(), new Date(), await contactedNumbers(), await membersWithConversa());
  if (!row) return send(res, 400, { error: "invalid_event" });

  try {
    const { error } = await supabaseFromEnv().from("inbox").insert(row);
    if (error?.code === UNIQUE_VIOLATION) return send(res, 200, { ok: true, duplicate: true });
    if (error) {
      console.error("[webhook] falha ao gravar na fila:", error.message);
      return send(res, 500, { error: "storage_failed" });
    }
  } catch (error) {
    console.error("[webhook] configuração ou conexão com o Supabase:", error instanceof Error ? error.message : error);
    return send(res, 500, { error: "storage_failed" });
  }
  return send(res, 200, { ok: true });
}
