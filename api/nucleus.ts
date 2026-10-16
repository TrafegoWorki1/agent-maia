import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { supabaseFromEnv } from "../server/supabaseClient.ts";
import { handleNucleus } from "../server/nucleusApi.ts";
import { json } from "../server/workspaceApi.ts";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = (req.headers.authorization ?? "").match(/^Bearer (.+)$/)?.[1];
  if (!token) return json(res, 401, { error: "login_required" });
  const url = process.env.SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json(res, 500, { error: "config_missing" });
  const caller = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const owner = await caller.rpc("is_owner");
  if (owner.error || owner.data !== true) return json(res, 403, { error: "owner_only" });
  return handleNucleus(req, res, supabaseFromEnv());
}
