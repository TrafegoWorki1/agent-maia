import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { refreshAll, isRefreshing } from "../server/refreshJob.ts";
import { supabaseFromEnv } from "../server/supabaseClient.ts";

// Rota do painel na Vercel (/api/refresh). Dispara a atualização das fontes (Gmail, Meta Ads, Sheets,
// Agenda) manualmente. Só o proprietário logado pode chamar. 409 se já houver uma atualização em curso.

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return send(res, 401, { error: "login_required" });

  const url = process.env.SUPABASE_URL;
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) return send(res, 500, { error: "config_missing" });

  const caller = createClient(url, publishable, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const owner = await caller.rpc("is_owner");
  if (owner.error || owner.data !== true) return send(res, 403, { error: "owner_only" });

  if (isRefreshing()) return send(res, 409, { error: "already_refreshing" });

  try {
    void refreshAll(supabaseFromEnv());
    return send(res, 200, { ok: true });
  } catch (error) {
    console.error("[refresh] falha ao iniciar atualização:", error instanceof Error ? error.message : error);
    return send(res, 500, { error: "refresh_failed" });
  }
}
