import type { Db } from "./store.ts";

export interface DrivePermissionProvider {
  create(input: { resourceId: string; resourceKind: "file" | "folder"; target: string; role: string }): Promise<{ permissionId: string }>;
  get(input: { resourceId: string; permissionId: string }): Promise<{ exists: boolean; role?: string }>;
  revoke(input: { resourceId: string; permissionId: string }): Promise<void>;
}

export interface TrackedShareInput {
  resourceId: string;
  resourceKind: "file" | "folder";
  target: string;
  role: string;
  personId?: string | null;
  clientId?: string | null;
  requestedBy?: string | null;
  approvedBy?: string | null;
}

export async function createTrackedDriveShare(db: Db, provider: DrivePermissionProvider, input: TrackedShareInput) {
  const created = await provider.create(input);
  if (!created.permissionId) throw new Error("O Drive não devolveu permissionId; resultado incerto e não confirmado.");
  const confirmed = await provider.get({ resourceId: input.resourceId, permissionId: created.permissionId });
  if (!confirmed.exists) throw new Error("O Drive não confirmou o compartilhamento; resultado incerto.");
  const row = {
    drive_permission_id: created.permissionId,
    drive_file_id: input.resourceKind === "file" ? input.resourceId : null,
    drive_folder_id: input.resourceKind === "folder" ? input.resourceId : null,
    person_id: input.personId ?? null,
    client_id: input.clientId ?? null,
    permission_role: confirmed.role ?? input.role,
    created_by_maia: true,
    requested_by: input.requestedBy ?? null,
    approved_by: input.approvedBy ?? null,
    evidence: { createConfirmed: true },
  };
  const { data, error } = await db.from("maia_drive_permissions").insert(row).select("*").single();
  if (error || !data) throw new Error(`Compartilhamento confirmado no Drive, mas o rastreio falhou: ${error?.message ?? "sem retorno"}. Não repita automaticamente.`);
  return data;
}

export async function revokeTrackedDriveShare(db: Db, provider: DrivePermissionProvider, id: string) {
  const found = await db.from("maia_drive_permissions").select("*").eq("id", id).eq("created_by_maia", true).maybeSingle();
  if (found.error || !found.data) throw new Error("A Maia só pode revogar permissões registradas como criadas por ela.");
  if (found.data.revocation_status === "revoked") return found.data;
  const resourceId = String(found.data.drive_file_id ?? found.data.drive_folder_id ?? "");
  await db.from("maia_drive_permissions").update({ revocation_status: "revoking" }).eq("id", id).eq("revocation_status", "active");
  try {
    await provider.revoke({ resourceId, permissionId: String(found.data.drive_permission_id) });
    const confirmed = await provider.get({ resourceId, permissionId: String(found.data.drive_permission_id) });
    if (confirmed.exists) throw new Error("O Drive ainda apresenta a permissão depois da remoção.");
    const { data, error } = await db.from("maia_drive_permissions").update({ revocation_status: "revoked", revoked_at: new Date().toISOString(), evidence: { ...(found.data.evidence ?? {}), revokeConfirmed: true } }).eq("id", id).select("*").single();
    if (error || !data) throw new Error(error?.message ?? "sem retorno");
    return data;
  } catch (error) {
    await db.from("maia_drive_permissions").update({ revocation_status: "uncertain", evidence: { ...(found.data.evidence ?? {}), revokeError: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) } }).eq("id", id);
    throw new Error(`Revogação não confirmada; não repita automaticamente: ${error instanceof Error ? error.message : String(error)}`);
  }
}
