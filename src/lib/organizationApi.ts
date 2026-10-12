import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseBrowser";
import type { OrganizationData } from "../../shared/organization";
export type { OrganizationData, ClientRow, AccessGroupRow, RegisteredGroupRow } from "../../shared/organization";
type SaveAction = "client_save" | "access_group_save" | "group_save";
export function organizationRequest(): Promise<OrganizationData>;
export function organizationRequest(action: SaveAction, input: unknown): Promise<{ result: unknown }>;
export async function organizationRequest(action?: SaveAction, input?: unknown): Promise<OrganizationData | { result: unknown }> {
  const session = await supabase?.auth.getSession();
  const token = session?.data.session?.access_token;
  const response = await fetch("/api/organization", { method: action ? "POST" : "GET", cache: "no-store", headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(action ? { "Content-Type": "application/json" } : {}),
  }, ...(action ? { body: JSON.stringify({ action, input }) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Apenas o proprietário pode gerenciar clientes e grupos de acesso." : body.error ?? "Não foi possível carregar os cadastros.");
  return body;
}
export function useOrganization() {
  const [data, setData] = useState<OrganizationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const reload = useCallback(async (saved = false) => {
    try { const next = await organizationRequest(); if (mounted.current) { setData(next); setError(null); } }
    catch (cause) { if (mounted.current) setError(`${saved ? "Cadastro salvo, mas não foi possível atualizar a lista. " : ""}${cause instanceof Error ? cause.message : "Falha ao carregar cadastros."}`); }
  }, []);
  useEffect(() => { mounted.current = true; void reload(); return () => { mounted.current = false; }; }, [reload]);
  const save = async (action: "client_save" | "access_group_save" | "group_save", input: unknown): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true; setBusy(true); setNotice(null); setError(null);
    try { await organizationRequest(action, input); if (mounted.current) setNotice("Cadastro atualizado."); await reload(true); return true; }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Não foi possível salvar."); return false; }
    finally { saving.current = false; if (mounted.current) setBusy(false); }
  };
  return { data, error, notice, busy, reload, save };
}
