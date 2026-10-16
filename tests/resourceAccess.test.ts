import { describe, expect, it } from "vitest";
import { decideResourceAccess, driveResourceFromTool } from "../server/resourceAccess.ts";
import type { Requester } from "../server/access.ts";
import type { Db } from "../server/store.ts";

const member = (groups: string[] = []): Requester => ({ role: "member", personId: "p1", name: "Ana", number: "551199", permissions: new Set(["sheets.ler"]), accessGroups: groups });
function dbWith(rows: Record<string, unknown>[], error: { message: string } | null = null): Db {
  return { from: () => { const q: any = { select: () => q, eq: () => q, then: (resolve: (value: unknown) => void) => resolve({ data: rows, error }) }; return q; } } as unknown as Db;
}

describe("autorização por recurso", () => {
  it("nega arquivo de outro cliente mesmo com sheets.ler", async () => {
    const result = await decideResourceAccess({ db: dbWith([{ resource_type: "client", resource_id: "cliente-a", client_id: "cliente-a", project_id: null, capability: "read", decision: "allow", source: "direct", access_group_id: null, expires_at: null, revoked_at: null }]), requester: member(), operation: "read", resource: { type: "drive_file", id: "arquivo-b", clientId: "cliente-b" }, capability: "read", channel: "whatsapp" });
    expect(result.decision).toBe("deny");
  });

  it("negação específica do arquivo vence concessão herdada da pasta", async () => {
    const rows = [
      { resource_type: "drive_folder", resource_id: "pasta", client_id: null, project_id: null, capability: "read", decision: "allow", source: "access_group", access_group_id: "g1", expires_at: null, revoked_at: null },
      { resource_type: "drive_file", resource_id: "arquivo", client_id: null, project_id: null, capability: "read", decision: "deny", source: "direct", access_group_id: null, expires_at: null, revoked_at: null },
    ];
    const result = await decideResourceAccess({ db: dbWith(rows), requester: member(["g1"]), operation: "read", resource: { type: "drive_file", id: "arquivo", parentFolderIds: ["pasta"] }, capability: "read", channel: "whatsapp" });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("restrição específica");
  });

  it("ignora permissão expirada e grupo removido na próxima chamada", async () => {
    const rows = [
      { resource_type: "drive_file", resource_id: "arquivo", client_id: null, project_id: null, capability: "read", decision: "allow", source: "direct", access_group_id: null, expires_at: "2026-01-01T00:00:00Z", revoked_at: null },
      { resource_type: "drive_file", resource_id: "arquivo", client_id: null, project_id: null, capability: "read", decision: "allow", source: "access_group", access_group_id: "removido", expires_at: null, revoked_at: null },
    ];
    const result = await decideResourceAccess({ db: dbWith(rows), requester: member([]), operation: "read", resource: { type: "drive_file", id: "arquivo" }, capability: "read", channel: "whatsapp", now: new Date("2026-10-16T00:00:00Z") });
    expect(result.decision).toBe("deny");
  });

  it("busca global sem id não vira acesso a todo o Drive", () => {
    expect(driveResourceFromTool("mcp__claude_ai_Google_Drive__search_files", { query: "cliente" })).toBeNull();
  });
});
