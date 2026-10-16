import { describe, expect, it } from "vitest";
import { assembleContext, compressSessionMessages, EXECUTOR_CONTEXT_BUDGETS } from "../server/context.ts";
import { parseSkillMarkdown, skillMatches } from "../server/skills.ts";
import { validateStepDependencies } from "../server/planExecution.ts";
import { nextCronAt, nextScheduleAt } from "../server/scheduler.ts";
import { decideControlledExecution } from "../server/controlledExecution.ts";
import { allowedMcpEndpoint, authorizeMcpTool, validateMcpServer } from "../server/mcpRegistry.ts";

describe("núcleo persistente da Maia", () => {
  it("comprime mensagens sem apagar a fonte e registra cobertura", () => {
    const rows = [1, 2, 3].map((id) => ({ id, session_id: "s", task_id: null, at: "2026-10-16T12:00:00Z", author: "owner" as const, text: `decisão ${id}`, source: "whatsapp" as const, source_event_key: null, metadata: {} }));
    const summary = compressSessionMessages(rows, EXECUTOR_CONTEXT_BUDGETS.codex);
    expect(summary.coversThroughMessageId).toBe(3);
    expect(summary.sourceMessageCount).toBe(3);
    expect(summary.facts.sources[0]).toContain("messages:1-3");
    expect(assembleContext({ summary: summary.summary, scope: "grupo cliente A" }, EXECUTOR_CONTEXT_BUDGETS.codex)).toContain("contexto, não prova");
  });

  it("aceita somente skills Markdown com ferramentas autorizadas", () => {
    const skill = parseSkillMarkdown("---\nid: diagnostico-operacional\nversion: 1.0.0\ndescription: diagnosticar worker e filas\nscope: owner\ntools: tarefas_listar,provider_status\n---\n1. Consulte o estado.\n2. Relate evidências.");
    expect(skill.id).toBe("diagnostico-operacional");
    expect(skill.toolNames).toEqual(["tarefas_listar", "provider_status"]);
    expect(skillMatches({ description: skill.description, scope: { value: skill.scope }, tools: skill.toolNames }, "diagnóstico do worker", new Set(skill.toolNames))).toBe(true);
    expect(skillMatches({ description: skill.description, scope: { value: skill.scope }, tools: skill.toolNames }, "diagnóstico do worker", new Set(["tarefas_listar"]))).toBe(false);
  });

  it("valida dependências, intervalos e cron antes de executar", () => {
    expect(validateStepDependencies([{ step_no: 1, depends_on: [] }, { step_no: 2, depends_on: [1] }])).toEqual([]);
    expect(validateStepDependencies([{ step_no: 1, depends_on: [2] }])).toHaveLength(1);
    const base = new Date("2026-10-16T12:00:00-03:00");
    expect(nextScheduleAt("interval", "2h", base)?.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(nextCronAt("*/15 * * * *", base)?.toISOString()).toBe("2026-10-16T15:15:00.000Z");
    expect(nextCronAt("30 12 * * *", base)?.getMinutes()).toBe(30);
    expect(nextCronAt("30 12 * * *", new Date("2026-10-16T14:00:00Z"), "America/Sao_Paulo")?.toISOString()).toBe("2026-10-16T15:30:00.000Z");
    expect(nextCronAt("30 12 * * *", base, "Invalid/Zone")).toBeNull();
  });

  it("mantém execução controlada desabilitada e MCP em allowlist", () => {
    expect(decideControlledExecution({ requestedBy: "owner", kind: "command", cwd: "data/run", timeoutMs: 1000, command: "echo ok", enabled: false, approved: true }).allowed).toBe(false);
    expect(validateMcpServer({ ownerKey: "owner", clientId: null, name: "externo", transport: "http", allowedTools: [], timeoutMs: 10000 }).join(" ")).toMatch(/endpoint/);
    expect(authorizeMcpTool({ name: "externo", allowed_tools: ["listar"], status: "configured" }, "publicar").allowed).toBe(false);
    expect(authorizeMcpTool({ name: "externo", allowed_tools: ["listar"], status: "configured" }, "listar").allowed).toBe(true);
    expect(allowedMcpEndpoint("https://mcp.example.test/api", "mcp.example.test")).toBe(true);
    expect(allowedMcpEndpoint("http://mcp.example.test/api", "mcp.example.test")).toBe(false);
    expect(allowedMcpEndpoint("https://attacker.test/api", "mcp.example.test")).toBe(false);
  });
});
