import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { supabaseFromEnv } from "../server/supabaseClient.ts";
import { handleWorkspace, json } from "../server/workspaceApi.ts";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const token = (req.headers.authorization ?? "").match(/^Bearer (.+)$/)?.[1];
  if (!token) return json(res,401,{ error: "login_required" });
  const url = process.env.SUPABASE_URL, key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return json(res,500,{ error: "config_missing" });
  const caller = createClient(url,key,{ global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const [owner, user] = await Promise.all([caller.rpc("is_owner"),caller.auth.getUser(token)]);
  if (owner.error || owner.data !== true || !user.data.user) return json(res,403,{ error: "owner_only" });
  return handleWorkspace(req,res,supabaseFromEnv(),user.data.user.id);
}
