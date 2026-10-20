import { describe, expect, it } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { isOperationalConnector, isOperationalConnectorRead } from "../server/operationalConnectors.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";
import { describeAction } from "../server/actionDescriptions.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });

describe("conectores de operação (Trello, Vercel, Miro, ClickUp, Docs)", () => {
  it("entram no inventário", () => {
    for (const t of ["mcp__claude_ai_Trello__trelloReadBoard", "mcp__claude_ai_Vercel__list_deployments", "mcp__claude_ai_Miro__board_search_boards", "mcp__claude_ai_ClickUp__get_task", "mcp__claude_ai_Claude_Docs__read"]) {
      expect(isKnownMcpTool(t), t).toBe(true);
    }
  });

  it("leituras conhecidas são livres para o owner no privado", () => {
    for (const t of ["mcp__claude_ai_Trello__trelloReadBoard", "mcp__claude_ai_Trello__trelloSearch", "mcp__claude_ai_Vercel__get_runtime_logs", "mcp__claude_ai_Vercel__list_deployments", "mcp__claude_ai_Miro__user_who_am_i", "mcp__claude_ai_Claude_Docs__query"]) {
      expect(isOperationalConnectorRead(t), t).toBe(true);
      expect(decideAccess(t, owner, {}, true).decision, t).toBe("allow");
    }
  });

  it("escritas pedem OK pontual, inclusive para o owner", () => {
    for (const t of ["mcp__claude_ai_Trello__trelloWriteCard", "mcp__claude_ai_Vercel__create_deployment", "mcp__claude_ai_Vercel__edit_project_env", "mcp__claude_ai_Vercel__request_rollback", "mcp__claude_ai_Miro__board_share", "mcp__claude_ai_ClickUp__create_task", "mcp__claude_ai_Claude_Docs__update"]) {
      expect(isOperationalConnectorRead(t), t).toBe(false);
      expect(decideAccess(t, owner, {}, false).decision, t).toBe("approve");
    }
  });

  it("leitura de variáveis, tokens e segredos não é livre", () => {
    for (const t of ["mcp__claude_ai_Vercel__get_project_env", "mcp__claude_ai_Vercel__filter_project_envs", "mcp__claude_ai_Vercel__get_edge_config_token", "mcp__claude_ai_Vercel__get_bypass_ip"]) {
      expect(isOperationalConnectorRead(t), t).toBe(false);
      expect(decideAccess(t, owner, {}, true).decision, t).toBe("approve");
    }
  });

  it("membros e visitantes não usam, nem com permissão de escrita ou de leitura", () => {
    expect(decideAccess("mcp__claude_ai_Trello__trelloReadBoard", member("escrita.pedir", "gmail.ler"), {}, true).decision).toBe("deny");
    expect(decideAccess("mcp__claude_ai_Trello__trelloWriteCard", member("escrita.pedir"), {}, false).decision).toBe("deny");
  });

  it("no grupo, mesmo o owner não usa: vale só no privado", () => {
    expect(decideAccess("mcp__claude_ai_Vercel__list_deployments", { ...owner, groupScope: { jid: "120@g.us" } } as Requester, {}, true).decision).toBe("deny");
  });

  it("não cobre famílias fora da lista", () => {
    expect(isOperationalConnector("mcp__claude_ai_Notion__notion-fetch")).toBe(false);
    expect(decideAccess("mcp__claude_ai_Notion__notion-fetch", owner, {}, true).decision).toBe("deny");
  });

  it("a aprovação mostra o serviço, sem nome técnico", () => {
    expect(describeAction("mcp__claude_ai_Vercel__create_deployment", {})).toContain("Vercel");
    expect(describeAction("mcp__claude_ai_Trello__trelloWriteCard", {})).toContain("Trello");
  });
});
