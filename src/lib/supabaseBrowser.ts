import { createClient } from "@supabase/supabase-js";

// Cliente do navegador: usa a chave PÚBLICA (publishable). Nunca a service role aqui.
// As tabelas só liberam leitura e escrita para quem está logado, conforme as políticas do banco.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Antes de criar o cliente: o Supabase apaga o token da URL ao ler o link. Guardamos aqui se o
// acesso veio de um convite ou de recuperação de senha, para pedir a senha antes de entrar.
export const arrivedFromAuthLink = /type=(invite|recovery)/.test(window.location.hash);

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "maia-auth" } })
  : null;
