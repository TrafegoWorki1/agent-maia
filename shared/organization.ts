export interface ClientRow { id: string; name: string; active: boolean; revision: number }
export interface AccessGroupRow { id: string; name: string; client_id: string | null; active: boolean; revision: number; members: string[]; permissions: string[] }
export interface RegisteredGroupRow { jid: string; name: string; active: boolean; source: string; kind: "interno" | "cliente"; client_id: string | null; access_group_id: string | null; revision: number }
export interface OrganizationData {
  clients: ClientRow[];
  accessGroups: AccessGroupRow[];
  groups: RegisteredGroupRow[];
  people: { id: string; name: string; role: string; active: boolean }[];
  permissions: { code: string; label: string; description: string }[];
}
