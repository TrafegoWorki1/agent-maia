import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { buildSnapshot } from "../server/snapshot.ts";
import { supabaseFromEnv } from "../server/supabaseClient.ts";

// Rota do painel na Vercel (/api/snapshot). Só o proprietário logado recebe os dados.
// A checagem usa o login de quem chama (is_owner no banco), não uma senha guardada no servidor.

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return send(res, 401, { error: "login_required" });

  const url = process.env.SUPABASE_URL;
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) return send(res, 500, { error: "config_missing" });

  // Cliente com o login de quem chama: o banco responde se essa pessoa é o proprietário.
  const caller = createClient(url, publishable, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const owner = await caller.rpc("is_owner");
  if (owner.error || owner.data !== true) return send(res, 403, { error: "owner_only" });

  try {
    return send(res, 200, await buildSnapshot(supabaseFromEnv()));
  } catch (error) {
    console.error("[snapshot] falha ao montar o painel:", error instanceof Error ? error.message : error);
    return send(res, 500, { error: "snapshot_failed" });
  }
}
