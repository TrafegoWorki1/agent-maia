import { createClient } from "@supabase/supabase-js";

// Cliente do navegador: usa a chave PÚBLICA (publishable). Nunca a service role aqui.
// As tabelas só liberam leitura e escrita para quem está logado, conforme as políticas do banco.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "maia-auth" } })
  : null;
