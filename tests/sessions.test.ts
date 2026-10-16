import { describe, expect, it, vi } from "vitest";
import type { Db } from "../server/store.ts";

const state = vi.hoisted(() => ({ role: "member", permission: true, clientId: "11111111-1111-4111-8111-111111111111" as string | null, groupAllowed: true }));
vi.mock("../server/access.ts", () => ({
  resolveRequester: async (_db: unknown, number: string) => ({ role: state.role, number, permissions: new Set(state.permission ? ["conversa.maia"] : []) }),
  canConverse: (who: { role: string; permissions: Set<string> }) => who.role === "owner" || who.permissions.has("conversa.maia"),
}));
vi.mock("../server/groupScope.ts", () => ({
  loadGroupScope: async () => ({ jid: "group@g.us", clientId: state.clientId }),
  canAccessGroup: () => state.groupAllowed,
}));

import { canReadSession, searchAuthorizedSessionMessages } from "../server/sessions.ts";

function fakeDb(row: Record<string, unknown>): Db {
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) });
  return { from: () => query } as unknown as Db;
}

describe("leitura de sessões de membros", () => {
  it("nega histórico privado depois de perder conversa.maia", async () => {
    state.role = "member"; state.permission = true;
    const db = fakeDb({ id: "s1", channel: "whatsapp", scope_kind: "member_private", requester_key: "5511999990001", client_id: null });
    expect(await canReadSession(db, "s1", "5511999990001", "whatsapp")).not.toBeNull();
    state.permission = false;
    expect(await canReadSession(db, "s1", "5511999990001", "whatsapp")).toBeNull();
    await expect(searchAuthorizedSessionMessages(db, "s1", "5511999990001", "whatsapp", "briefing")).rejects.toThrow("Acesso ao contexto recusado");
    state.permission = true;
    expect(await canReadSession(db, "s1", "5511999990002", "whatsapp")).toBeNull();
  });

  it("não cruza clientes nem grupos revogados", async () => {
    state.clientId = "11111111-1111-4111-8111-111111111111"; state.groupAllowed = true;
    const db = fakeDb({ id: "s2", channel: "whatsapp", scope_kind: "group", conversation_key: "group@g.us", requester_key: "5511999990001", client_id: state.clientId });
    expect(await canReadSession(db, "s2", "5511999990001", "whatsapp")).not.toBeNull();
    state.clientId = "22222222-2222-4222-8222-222222222222";
    expect(await canReadSession(db, "s2", "5511999990001", "whatsapp")).toBeNull();
    state.clientId = "11111111-1111-4111-8111-111111111111"; state.groupAllowed = false;
    expect(await canReadSession(db, "s2", "5511999990001", "whatsapp")).toBeNull();
  });
});
