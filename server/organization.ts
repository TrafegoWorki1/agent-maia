import { z } from "zod";
import type { Db } from "./store.ts";
import { fetchLiveGroups } from "./groups.ts";
import type { OrganizationData, RegisteredGroupRow } from "../shared/organization.ts";

const name = z.string().trim().min(1).max(100);
const id = z.uuid();
export const clientInput = z.object({ id: id.optional(), revision: z.number().int().positive().optional(), name, active: z.boolean().default(true) });
export const accessGroupInput = z.object({ id: id.optional(), revision: z.number().int().positive().optional(), name,
  client_id: id.nullable().default(null), active: z.boolean().default(true), members: z.array(id).max(200),
  permissions: z.array(z.string().min(1).max(80)).max(100) });
export const groupInput = z.object({ jid: z.string().regex(/^\d+@g\.us$/), revision: z.number().int().positive().optional(),
  kind: z.enum(["interno", "cliente"]), client_id: id.nullable().default(null), access_group_id: id.nullable().default(null),
  active: z.boolean().optional() }).refine((v) => (v.kind === "cliente") === Boolean(v.client_id), "Selecione o cliente do grupo.");

function check(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (["42P01", "42703", "PGRST205", "PGRST204"].includes(error.code ?? "")) throw new Error("O cadastro de clientes e grupos de acesso aguarda a atualização do banco.");
  if (error.code === "23505") throw new Error("Já existe um cadastro com esse nome. Atualize a lista.");
  throw new Error(error.message);
}
export async function organizationView(db: Db): Promise<OrganizationData> {
  const [clients, groups, access, members, grants, people, permissions] = await Promise.all([
    db.from("maia_clients").select("id,name,active,revision").order("name"),
    db.from("maia_groups").select("jid,name,active,source,kind,client_id,access_group_id,revision").order("name"),
    db.from("maia_access_groups").select("id,name,active,client_id,revision").order("name"),
    db.from("maia_access_group_members").select("access_group_id,person_id"),
    db.from("maia_access_group_permissions").select("access_group_id,permission_code"),
    db.from("people").select("id,name,role,active").order("name"),
    db.from("permission_catalog").select("code,label,description").order("code"),
  ]);
  for (const result of [clients, groups, access, members, grants, people, permissions]) check(result.error);
  return { clients: clients.data ?? [], groups: (groups.data ?? []) as RegisteredGroupRow[], people: people.data ?? [], permissions: permissions.data ?? [],
    accessGroups: (access.data ?? []).map((g) => ({ ...g,
      members: (members.data ?? []).filter((m) => m.access_group_id === g.id).map((m) => String(m.person_id)),
      permissions: (grants.data ?? []).filter((p) => p.access_group_id === g.id).map((p) => String(p.permission_code)),
    })) };
}
export async function saveClient(db: Db, input: unknown) {
  const v = clientInput.parse(input);
  if (v.id && !v.revision) throw new Error("Atualize o cliente antes de salvar.");
  const result = v.id ? await db.from("maia_clients").update({ name: v.name, active: v.active, revision: v.revision! + 1 }).eq("id", v.id).eq("revision", v.revision).select("id").maybeSingle()
    : await db.from("maia_clients").insert({ name: v.name, active: v.active }).select("id").single();
  check(result.error); if (!result.data) throw new Error("Cliente alterado por outra sessão. Atualize antes de salvar."); return result.data;
}
export async function saveAccessGroup(db: Db, input: unknown) {
  const v = accessGroupInput.parse(input);
  if (v.id && !v.revision) throw new Error("Atualize o grupo antes de salvar.");
  const result = await db.rpc("save_maia_access_group", { p_id: v.id ?? null, p_revision: v.revision ?? null, p_name: v.name,
    p_client_id: v.client_id, p_active: v.active, p_members: [...new Set(v.members)], p_permissions: [...new Set(v.permissions)] });
  check(result.error); return result.data;
}
export async function saveWhatsAppGroup(db: Db, input: unknown) {
  const v = groupInput.parse(input);
  const current = await db.from("maia_groups").select("jid,name,revision,active").eq("jid", v.jid).maybeSingle();
  check(current.error);
  if (v.client_id) {
    const client = await db.from("maia_clients").select("id").eq("id", v.client_id).eq("active", true).maybeSingle();
    check(client.error); if (!client.data) throw new Error("Selecione um cliente ativo.");
  }
  if (v.access_group_id) {
    const group = await db.from("maia_access_groups").select("client_id,active").eq("id", v.access_group_id).maybeSingle();
    check(group.error);
    if (!group.data?.active || group.data.client_id !== v.client_id) throw new Error("Selecione um grupo de acesso ativo do mesmo cliente.");
  }
  const patch = { kind: v.kind, client_id: v.client_id, access_group_id: v.access_group_id, active: v.active ?? current.data?.active ?? false };
  if (current.data) {
    if (!v.revision || v.revision !== current.data.revision) throw new Error("Grupo alterado por outra sessão. Atualize antes de salvar.");
    const result = await db.from("maia_groups").update({ ...patch, revision: v.revision + 1 }).eq("jid", v.jid).eq("revision", v.revision).select("jid").maybeSingle();
    check(result.error); if (!result.data) throw new Error("Grupo alterado por outra sessão. Atualize antes de salvar.");
    return result.data;
  }
  const live = await fetchLiveGroups();
  const group = live.groups.find((g) => g.jid === v.jid);
  if (!group) throw new Error("O grupo precisa constar na lista do WhatsApp antes de ser cadastrado.");
  const result = await db.from("maia_groups").insert({ jid: v.jid, name: group.subject, source: "cadastrado", ...patch }).select("jid").single();
  check(result.error); return result.data;
}
export const organizationTools = [
  { name: "grupos_clientes_listar", description: "Lista grupos cadastrados, clientes e grupos de acesso. Privado do owner; somente leitura.", schema: z.object({}),
    run: async (db: Db, _input: unknown) => { const v = await organizationView(db); return { clients: v.clients, groups: v.groups, accessGroups: v.accessGroups.map(({ members, permissions, ...g }) => g) }; } },
  { name: "grupo_cliente_classificar", description: "Classifica grupo WhatsApp como interno ou de cliente. Use JID e revisão consultados. Cadastro não ativa atendimento automaticamente. Exclusivo do owner no privado.", schema: groupInput,
    run: saveWhatsAppGroup },
];
