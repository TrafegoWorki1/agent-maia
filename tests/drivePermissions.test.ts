import { describe, expect, it, vi } from "vitest";
import { createTrackedDriveShare, revokeTrackedDriveShare, type DrivePermissionProvider } from "../server/drivePermissions.ts";
import type { Db } from "../server/store.ts";

function memoryDb() {
  const rows: Record<string, any>[] = [];
  const db = { from: () => {
    let op: "select" | "insert" | "update" = "select"; let payload: any = {}; const filters: [string, unknown][] = [];
    const run = () => {
      if (op === "insert") { const row = { id: "tracked-1", revocation_status: "active", ...payload }; rows.push(row); return [row]; }
      const found = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      if (op === "update") found.forEach((row) => Object.assign(row, payload));
      return found;
    };
    const q: any = { insert: (value: any) => { op = "insert"; payload = value; return q; }, update: (value: any) => { op = "update"; payload = value; return q; }, select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, single: async () => ({ data: run()[0] ?? null, error: null }), maybeSingle: async () => ({ data: run()[0] ?? null, error: null }), then: (resolve: (v: unknown) => void) => resolve({ data: run(), error: null }) };
    return q;
  } } as unknown as Db;
  return { db, rows };
}

describe("permissões do Drive criadas pela Maia", () => {
  it("persiste permissionId confirmado e só confirma revogação após releitura", async () => {
    const { db, rows } = memoryDb();
    let exists = true;
    const provider: DrivePermissionProvider = {
      create: vi.fn(async () => ({ permissionId: "perm-1" })),
      get: vi.fn(async () => ({ exists, role: "reader" })),
      revoke: vi.fn(async () => { exists = false; }),
    };
    const tracked: any = await createTrackedDriveShare(db, provider, { resourceId: "file-1", resourceKind: "file", target: "a@example.com", role: "reader" });
    expect(tracked.drive_permission_id).toBe("perm-1");
    const revoked: any = await revokeTrackedDriveShare(db, provider, tracked.id);
    expect(revoked.revocation_status).toBe("revoked");
    expect(rows[0].evidence.revokeConfirmed).toBe(true);
  });

  it("não repete quando a remoção fica incerta", async () => {
    const { db } = memoryDb();
    const provider: DrivePermissionProvider = { create: async () => ({ permissionId: "perm-2" }), get: async () => ({ exists: true }), revoke: async () => { throw new Error("timeout"); } };
    const tracked: any = await createTrackedDriveShare(db, provider, { resourceId: "file-2", resourceKind: "file", target: "b@example.com", role: "reader" });
    await expect(revokeTrackedDriveShare(db, provider, tracked.id)).rejects.toThrow("não repita automaticamente");
  });
});
