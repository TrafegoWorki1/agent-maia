import type { IncomingMessage, ServerResponse } from "node:http";
import { tokenFromRequest, tokenMatches } from "../server/evolutionWebhook.ts";
import { toInboxRow } from "../server/inbox.ts";
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

// Grupos em que a Maia atende. Cache de 60 s para não consultar o banco a cada evento.
let groupsCache: { at: number; jids: Set<string> } | null = null;
async function maiaGroups(): Promise<Set<string>> {
  if (groupsCache && Date.now() - groupsCache.at < 60_000) return groupsCache.jids;
  try {
    const { data } = await supabaseFromEnv().from("maia_groups").select("jid").eq("active", true);
    groupsCache = { at: Date.now(), jids: new Set((data ?? []).map((r) => String(r.jid))) };
  } catch {
    // Sem o banco, mantém a última lista conhecida; a mensagem ainda é gravada sem texto.
    groupsCache = { at: Date.now(), jids: groupsCache?.jids ?? new Set() };
  }
  return groupsCache.jids;
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

  const row = toInboxRow(body, process.env.EVOLUTION_OWNER_NUMBER, process.env.EVOLUTION_APPROVER_NUMBER, await maiaGroups());
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
