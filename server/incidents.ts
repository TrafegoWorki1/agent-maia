import type { Db } from "./store.ts";

export type IncidentType = "execution_error" | "missing_proof" | "uncertain_result";
export type IncidentStatus = "open" | "resolved" | "ignored";

export interface Incident {
  id: string;
  created_at: string;
  tipo: IncidentType;
  ferramenta: string | null;
  descricao: string;
  contexto: Record<string, unknown>;
  status: IncidentStatus;
  correcao_proposta: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export async function createIncident(
  db: Db,
  tipo: IncidentType,
  descricao: string,
  opts: { ferramenta?: string; contexto?: Record<string, unknown> } = {},
): Promise<string> {
  const { data, error } = await db
    .from("maia_incidents")
    .insert({ tipo, descricao, ferramenta: opts.ferramenta ?? null, contexto: opts.contexto ?? {} })
    .select("id")
    .single();
  if (error) throw new Error(`incidents: ${error.message}`);
  return (data as { id: string }).id;
}

export async function proposeCorrection(db: Db, incidentId: string, correcao: string): Promise<void> {
  const { error } = await db.from("maia_incidents").update({ correcao_proposta: correcao }).eq("id", incidentId);
  if (error) throw new Error(`incidents: ${error.message}`);
}

export async function resolveIncident(db: Db, incidentId: string): Promise<void> {
  const { error } = await db.from("maia_incidents").update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: "maia" }).eq("id", incidentId);
  if (error) throw new Error(`incidents: ${error.message}`);
}

export async function listOpenIncidents(db: Db, limit = 20): Promise<Incident[]> {
  const { data, error } = await db.from("maia_incidents").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`incidents: ${error.message}`);
  return (data ?? []) as Incident[];
}
