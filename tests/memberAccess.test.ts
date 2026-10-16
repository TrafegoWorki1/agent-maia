import { describe, expect, it, vi } from "vitest";
import { approvalBinding } from "../server/approvals.ts";
import { canConverse, decideAccess, type Requester } from "../server/access.ts";
import { runMemberAccessTool, validateMemberAccessChange } from "../server/memberAccessTools.ts";
import type { Db } from "../server/store.ts";

const member = (extra: Partial<Requester> = {}): Requester => ({ role: "member", name: "Ana", number: "5511999999999", permissions: new Set(["conversa.maia", "sheets.ler", "mensagem.enviar"]), ...extra });

describe("administração de acessos", () => {
  it("não permite que membro administre acessos, nem mediante aprovação", () => {
    for (const tool of ["localizar", "consultar", "definir"]) expect(decideAccess(`mcp__maia__membro_acesso_${tool}`, member(), {}, tool !== "definir").decision).toBe("deny");
  });
  it("bloqueio individual prevalece sobre concessão herdada e sobre aprovação geral", () => {
    const who = member({ blockedPermissions: new Set(["sheets.ler", "mensagem.enviar"]) });
    expect(decideAccess("mcp__claude_ai_Google_Drive__search_files", who, {}, true).decision).toBe("deny");
    expect(decideAccess("mcp__maia__contato_enviar_mensagem", who, {}, false).decision).toBe("deny");
  });
  it("exige OK pontual sem conceder acesso permanente", () => {
    const who = member({ approvalPermissions: new Set(["sheets.ler"]), permissions: new Set(["conversa.maia"]) });
    expect(decideAccess("mcp__claude_ai_Google_Drive__search_files", who, {}, true).decision).toBe("approve");
    expect(who.permissions.has("sheets.ler")).toBe(false);
    const first = approvalBinding(who.number, "search", { file: "A" }, 1);
    expect(first).not.toEqual(approvalBinding(who.number, "search", { file: "B" }, 1));
    expect(first).not.toEqual(approvalBinding("5511888888888", "search", { file: "A" }, 1));
    expect(first).not.toEqual(approvalBinding(who.number, "search", { file: "A" }, 2));
  });
  it("revogação de conversa impede a próxima ação", () => {
    expect(canConverse(member())).toBe(true);
    expect(canConverse(member({ permissions: new Set(), blockedPermissions: new Set(["conversa.maia"]) }))).toBe(false);
  });
  it("não confirma capacidade sem política efetiva nem OK pontual para entrada", () => {
    expect(() => validateMemberAccessChange("capacidade.inexistente", "bloqueado")).toThrow("nenhuma alteração");
    expect(() => validateMemberAccessChange("conversa.maia", "aprovacao")).toThrow("não admite OK pontual");
    expect(() => validateMemberAccessChange("sheets.ler", "aprovacao")).not.toThrow();
    expect(() => validateMemberAccessChange("painel.ver", "bloqueado")).not.toThrow();
    expect(() => validateMemberAccessChange("painel.ver", "aprovacao")).toThrow();
    expect(() => validateMemberAccessChange("trabalho.revisar", "permitido")).not.toThrow();
  });
  it("localização por cadastro devolve todas as homônimas, sem escolher por conta própria", async () => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "5511990000000");
    const people = [{ id: "11111111-1111-4111-8111-111111111111", name: "Jéssica Lima", active: true, role: "equipe" }, { id: "22222222-2222-4222-8222-222222222222", name: "Jessica Souza", active: true, role: "equipe" }];
    const db = { from: (table: string) => {
      const rows = table === "people" ? people : [];
      const chain = { select: () => chain, eq: () => chain, neq: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: rows, error: null })) };
      return chain;
    } } as unknown as Db;
    try {
      const found = await runMemberAccessTool(db, "membro_acesso_localizar", { busca: "jessica" }, "5511990000000");
      expect(found).toHaveLength(2);
      await expect(runMemberAccessTool(db, "membro_acesso_localizar", { busca: "jessica" }, "5511888888888")).rejects.toThrow("proprietário autenticado");
    } finally { vi.unstubAllEnvs(); }
  });
});
