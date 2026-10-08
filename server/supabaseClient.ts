import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./loadEnv.ts";

// Cliente do banco da Maia no Supabase. Usa a chave de serviço: ela ignora RLS, por isso fica só
// no servidor (PC ou Vercel) e nunca vai para o navegador. As tabelas não têm políticas para anon.
export function supabaseFromEnv(): SupabaseClient {
  loadLocalEnv();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase não configurado: faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
