import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "node:http";
import { canonicalPhone, samePhone } from "./evolutionWebhook.ts";
import type { Db } from "./store.ts";

export type OperationalRole = "membro" | "coordenador" | "responsavel_cliente" | "revisor" | "aprovador" | "financeiro";

export interface PanelIdentity {
  personId: string;
  authUserId: string | null;
  name: string;
  owner: boolean;
  directPermissions: Set<string>;
  permissionModes: Map<string, "permitido" | "bloqueado" | "aprovacao">;
  groupPermissions: Array<{ code: string; clientId: string | null }>;
  teams: Array<{ id: string; name: string; membershipRole: "membro" | "coordenador" }>;
  roles: Array<{ role: OperationalRole; teamId: string | null; clientId: string | null; projectId: string | null }>;
}

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function loadIdentity(db: Db, person: { id: string; auth_user_id: string | null; name: string; role: string; active: boolean }): Promise<PanelIdentity> {
  if (!person.active) throw new Error("Acesso revogado");
  const [direct, modes, memberships, operationalMemberships, roles] = await Promise.all([
    db.from("person_permissions").select("permission_code").eq("person_id", person.id),
    db.from("maia_member_access_modes").select("permission_code,mode").eq("person_id", person.id),
    db.from("maia_access_group_members").select("access_group_id").eq("person_id", person.id),
    db.from("work_team_members").select("team_id,membership_role,work_teams!inner(name,active)").eq("person_id", person.id).eq("active", true),
    db.from("work_scope_roles").select("role,team_id,client_id,project_id").eq("person_id", person.id).eq("active", true),
  ]);
  for (const result of [direct, modes, memberships, operationalMemberships, roles]) check(result.error);
  const accessIds = (memberships.data ?? []).map((row) => String(row.access_group_id));
  const accessGroups = accessIds.length
    ? await db.from("maia_access_groups").select("id,client_id,active").in("id", accessIds).eq("active", true)
    : { data: [], error: null };
  check(accessGroups.error);
  const activeIds = (accessGroups.data ?? []).map((row) => String(row.id));
  const inherited = activeIds.length
    ? await db.from("maia_access_group_permissions").select("access_group_id,permission_code").in("access_group_id", activeIds)
    : { data: [], error: null };
  check(inherited.error);
  const clientByGroup = new Map((accessGroups.data ?? []).map((row) => [String(row.id), row.client_id ? String(row.client_id) : null]));
  return {
    personId: String(person.id),
    authUserId: person.auth_user_id ? String(person.auth_user_id) : null,
    name: String(person.name),
    owner: person.role === "proprietario",
    directPermissions: new Set((direct.data ?? []).map((row) => String(row.permission_code))),
    permissionModes: new Map((modes.data ?? []).map((row) => [String(row.permission_code), row.mode as "permitido" | "bloqueado" | "aprovacao"])),
    groupPermissions: (inherited.data ?? []).map((row) => ({ code: String(row.permission_code), clientId: clientByGroup.get(String(row.access_group_id)) ?? null })),
    teams: (operationalMemberships.data ?? []).flatMap((row) => {
      const team = Array.isArray(row.work_teams) ? row.work_teams[0] : row.work_teams;
      return team && team.active ? [{ id: String(row.team_id), name: String(team.name), membershipRole: row.membership_role as "membro" | "coordenador" }] : [];
    }),
    roles: (roles.data ?? []).map((row) => ({ role: row.role as OperationalRole, teamId: row.team_id ? String(row.team_id) : null, clientId: row.client_id ? String(row.client_id) : null, projectId: row.project_id ? String(row.project_id) : null })),
  };
}

export async function identityByAuthUser(db: Db, authUserId: string): Promise<PanelIdentity> {
  const person = await db.from("people").select("id,auth_user_id,name,role,active").eq("auth_user_id", authUserId).maybeSingle();
  check(person.error);
  if (!person.data) throw new Error("Login sem vínculo com uma pessoa cadastrada");
  return loadIdentity(db, person.data);
}

export async function identityByNumber(db: Db, number: string): Promise<PanelIdentity> {
  const digits = canonicalPhone(number);
  if (!digits) throw new Error("Número do solicitante ausente");
  if (samePhone(digits,process.env.EVOLUTION_OWNER_NUMBER)) {
    const owner=await db.from("people").select("id,auth_user_id,name,role,active").eq("role","proprietario").eq("active",true);
    check(owner.error);
    if ((owner.data??[]).length!==1) throw new Error("Número autorizado sem cadastro único de proprietário");
    return loadIdentity(db,owner.data![0]);
  }
  const numbers = await db.from("person_numbers").select("number,person_id");
  check(numbers.error);
  const match = (numbers.data ?? []).find((row) => canonicalPhone(String(row.number)) === digits);
  if (!match) throw new Error("Número sem vínculo com uma pessoa cadastrada");
  const person = await db.from("people").select("id,auth_user_id,name,role,active").eq("id", match.person_id).maybeSingle();
  check(person.error);
  if (!person.data) throw new Error("Pessoa cadastrada não encontrada");
  return loadIdentity(db, person.data);
}

export function permissionMode(identity: PanelIdentity, code: string, clientId: string | null = null): "permitido" | "bloqueado" | "aprovacao" {
  if (identity.owner) return "permitido";
  const override = identity.permissionModes.get(code);
  if (override) return override;
  if (identity.directPermissions.has(code)) return "permitido";
  return identity.groupPermissions.some((grant) => grant.code === code && (grant.clientId === null || grant.clientId === clientId)) ? "permitido" : "bloqueado";
}

export function hasPermission(identity: PanelIdentity, code: string, clientId: string | null = null): boolean {
  return permissionMode(identity, code, clientId) === "permitido";
}

export function identityScreens(identity: PanelIdentity): string[] {
  if (identity.owner) return ["meu-dia","minha-equipe","coordenacao","direcao","planejamento","metricas"];
  if (!hasPermission(identity, "painel.ver")) return [];
  const result = new Set<string>(["meu-dia"]);
  if (identity.teams.length || identity.roles.some((role) => role.role === "membro")) result.add("minha-equipe");
  const coordinator=identity.roles.some((role) => role.role === "coordenador")||identity.teams.some((team)=>team.membershipRole==="coordenador");
  if (coordinator&&hasPermission(identity,"trabalho.ver")) result.add("coordenacao");
  if (coordinator&&hasPermission(identity,"trabalho.planejar")) result.add("planejamento");
  if (hasPermission(identity, "indicadores.ver")) result.add("metricas");
  return [...result];
}

export async function authenticatePanelRequest(req: IncomingMessage, db: Db): Promise<PanelIdentity> {
  const token = (req.headers.authorization ?? "").match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("login_required");
  const url = process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("config_missing");
  const caller = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const user = await caller.auth.getUser(token);
  if (user.error || !user.data.user) throw new Error("login_required");
  return identityByAuthUser(db, user.data.user.id);
}
