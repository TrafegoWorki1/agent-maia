import type { Db } from "./store.ts";
import type { Requester } from "./access.ts";
export interface GroupScope { jid: string; name: string; clientId: string | null; clientName: string | null; accessGroupId: string | null; groupRevision?: number; clientRevision?: number | null; accessRevision?: number | null; startedAt?: string }
export function scopeIncludesMessage(scope: GroupScope, receivedAt?: string): boolean {
  return !receivedAt || !scope.startedAt || Date.parse(receivedAt) >= Date.parse(scope.startedAt);
}
export async function loadGroupScope(db: Db, jid: string): Promise<GroupScope | null> {
  const group = await db.from("maia_groups").select("jid,name,active,client_id,access_group_id,revision,scope_started_at").eq("jid", jid).eq("active", true).maybeSingle();
  if (group.error) throw new Error("Não foi possível confirmar o acesso ao grupo.");
  if (!group.data) return null;
  let clientName: string | null = null;
  let clientRevision: number | null = null;
  let accessRevision: number | null = null;
  if (group.data.client_id) {
    const client = await db.from("maia_clients").select("name,active,revision").eq("id", group.data.client_id).maybeSingle();
    if (client.error || !client.data?.active) return null;
    clientName = String(client.data.name);
    clientRevision = Number(client.data.revision);
  }
  if (group.data.access_group_id) {
    const access = await db.from("maia_access_groups").select("active,client_id,revision").eq("id", group.data.access_group_id).maybeSingle();
    if (access.error || !access.data?.active || access.data.client_id !== group.data.client_id) return null;
    accessRevision = Number(access.data.revision);
  }
  return { jid, name: String(group.data.name), clientId: group.data.client_id, clientName, accessGroupId: group.data.access_group_id, groupRevision:Number(group.data.revision),clientRevision,accessRevision,startedAt:group.data.scope_started_at };
}
export function canAccessGroup(who: Requester, scope: GroupScope): boolean {
  if (who.role === "owner") return true;
  if (scope.accessGroupId) return who.accessGroups?.includes(scope.accessGroupId) ?? false;
  if (scope.clientId) return who.role === "member" && (who.clientIds?.includes(scope.clientId) ?? false);
  return true;
}
const CLIENT_TOOLS = new Set(["mcp__maia__buscar_conhecimento", "mcp__maia__avisar_dono", "mcp__maia__grupo_info", "mcp__maia__grupo_participantes", "mcp__maia__grupo_ler_enquetes", "mcp__maia__grupo_enviar_texto", "mcp__maia__grupo_enviar_enquete", "mcp__maia__grupo_gerenciar_participantes", "mcp__maia__grupo_alterar_foto"]);
export function groupToolDenial(tool: string, who: Requester, targetJid?: string): string | null {
  const scope = who.groupScope;
  if (!scope?.clientId) return null;
  if (!CLIENT_TOOLS.has(tool)) return "Esta ferramenta usa dados gerais da operação e não está disponível no grupo deste cliente.";
  if (tool.startsWith("mcp__maia__grupo_") && targetJid !== scope.jid) return "No grupo de cliente, as ações e consultas ficam restritas ao próprio grupo.";
  return null;
}
