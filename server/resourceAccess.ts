import type { Requester } from "./access.ts";
import type { Db } from "./store.ts";

export type ResourceType = "drive_file" | "drive_folder" | "client" | "project" | "group" | "integration" | "task";
export type ResourceCapability = "read" | "write" | "send" | "share" | "admin";
export type ResourceDecision = { decision: "allow" | "approve" | "deny"; reason: string; requiredPermission?: string; scope?: { clientId?: string; projectId?: string; resourceId?: string } };

export interface ResourceRef {
  type: ResourceType;
  id: string;
  clientId?: string;
  projectId?: string;
  parentFolderIds?: string[];
}

type Grant = {
  resource_type: ResourceType;
  resource_id: string;
  client_id: string | null;
  project_id: string | null;
  capability: ResourceCapability;
  decision: "allow" | "deny" | "approval_required";
  source: "direct" | "access_group" | "manual" | "maia";
  access_group_id: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

const RESOURCE_ID_KEYS = ["file_id", "fileId", "spreadsheet_id", "spreadsheetId", "document_id", "documentId", "resource_id", "resourceId"];
const FOLDER_ID_KEYS = ["folder_id", "folderId"];

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof input[key] === "string" && input[key]) return String(input[key]);
  return null;
}

export function driveResourceFromTool(toolName: string, input: Record<string, unknown>): { resource: ResourceRef; capability: ResourceCapability } | null {
  if (!toolName.startsWith("mcp__claude_ai_Google_Drive__")) return null;
  const folder = firstString(input, FOLDER_ID_KEYS);
  const file = firstString(input, RESOURCE_ID_KEYS);
  const id = file ?? folder;
  if (!id) return null;
  const operation = toolName.split("__").at(-1) ?? "";
  const capability: ResourceCapability = /share|permission/i.test(operation) ? "share" : /create|update|write|move|delete|trash|rename/i.test(operation) ? "write" : "read";
  return { resource: { type: file ? "drive_file" : "drive_folder", id }, capability };
}

function applies(grant: Grant, resource: ResourceRef, capability: ResourceCapability, groups: ReadonlySet<string>, now: number): boolean {
  if (grant.revoked_at || (grant.expires_at && Date.parse(grant.expires_at) <= now)) return false;
  if (grant.source === "access_group" && (!grant.access_group_id || !groups.has(grant.access_group_id))) return false;
  if (grant.capability !== "admin" && grant.capability !== capability) return false;
  if (grant.resource_type === resource.type && grant.resource_id === resource.id) return true;
  if (grant.resource_type === "drive_folder" && resource.parentFolderIds?.includes(grant.resource_id)) return true;
  if (grant.resource_type === "project" && resource.projectId === grant.resource_id) return true;
  if (grant.resource_type === "client" && resource.clientId === grant.resource_id) return true;
  return false;
}

export async function decideResourceAccess(input: {
  db: Db;
  requester: Requester;
  operation: string;
  resource: ResourceRef;
  capability: ResourceCapability;
  channel: "whatsapp" | "painel";
  now?: Date;
}): Promise<ResourceDecision> {
  const scope = { ...(input.resource.clientId ? { clientId: input.resource.clientId } : {}), ...(input.resource.projectId ? { projectId: input.resource.projectId } : {}), resourceId: input.resource.id };
  if (input.requester.role === "owner") return { decision: "allow", reason: "owner autenticado", scope };
  if (input.requester.role !== "member" || !input.requester.personId) return { decision: "deny", reason: "identidade cadastrada obrigatória para acessar o recurso", scope };
  if (input.capability === "read" && !input.requester.permissions.has("sheets.ler")) return { decision: "deny", reason: "falta a capacidade base sheets.ler", requiredPermission: "sheets.ler", scope };

  const { data, error } = await input.db.from("maia_resource_access").select("resource_type,resource_id,client_id,project_id,capability,decision,source,access_group_id,expires_at,revoked_at").eq("person_id", input.requester.personId);
  if (error) return { decision: "deny", reason: "escopo de recurso indisponível; acesso bloqueado com segurança", scope };
  const groups = new Set(input.requester.accessGroups ?? []);
  const grants = ((data ?? []) as Grant[]).filter((grant) => applies(grant, input.resource, input.capability, groups, (input.now ?? new Date()).getTime()));
  const exact = grants.filter((grant) => grant.resource_type === input.resource.type && grant.resource_id === input.resource.id);
  const relevant = exact.length ? exact : grants;
  if (relevant.some((grant) => grant.decision === "deny")) return { decision: "deny", reason: "há uma restrição específica vigente para este recurso", scope };
  if (relevant.some((grant) => grant.decision === "approval_required")) return { decision: "approve", reason: "este recurso exige aprovação pontual", scope };
  if (relevant.some((grant) => grant.decision === "allow")) return { decision: "allow", reason: "recurso autorizado e revalidado", scope };
  return { decision: "deny", reason: "nenhuma autorização vigente para este arquivo, pasta, cliente ou projeto", scope };
}

export async function decideDriveToolAccess(db: Db, requester: Requester, toolName: string, input: Record<string, unknown>, channel: "whatsapp" | "painel"): Promise<ResourceDecision | null> {
  if (!toolName.startsWith("mcp__claude_ai_Google_Drive__")) return null;
  if (requester.role === "owner") return { decision: "allow", reason: "owner autenticado" };
  const request = driveResourceFromTool(toolName, input);
  if (!request) return { decision: "deny", reason: "a operação do Drive não informou um arquivo ou pasta autorizado; buscas globais não são liberadas por sheets.ler" };
  return decideResourceAccess({ db, requester, operation: toolName, resource: request.resource, capability: request.capability, channel });
}
