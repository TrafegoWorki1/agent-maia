import { describe, it, expect, vi } from "vitest";
import { runClaudeSimple } from "../server/ai/providers/claudeSimple.ts";
import { fakeSpawn } from "./helpers/fakeClaude.ts";

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdk.query }));

const ok = (result: string) => JSON.stringify({ type: "result", subtype: "success", is_error: false, result, total_cost_usd: 0.02, usage: { input_tokens: 3, output_tokens: 2 } });
const base = { prompt: "Consulte", systemPrompt: "Só leitura", model: "haiku", maxTurns: 6, maxBudgetUsd: 0.5, timeoutMs: 5000 };

describe("consulta simples (atualização do painel e demonstração) pelo Claude Code CLI", () => {
  it("devolve texto e custo e não oferece ferramentas internas nem o servidor de ferramentas da Maia", async () => {
    const spawned = fakeSpawn([ok('{"total": 2}')]);
    const out = await runClaudeSimple({ ...base, executor: "cli", allowTool: () => false, spawnImpl: spawned.impl });
    expect(out).toEqual({ text: '{"total": 2}', costUsd: 0.02 });
    const [call] = spawned.calls;
    expect(call.stdin).toBe("Consulte");
    expect(call.args[call.args.indexOf("--tools") + 1]).toBe("");
    expect(call.args).toContain("--restricted");
    expect(call.args).toContain("--permission-prompt-tool");
    expect(call.args).not.toContain("--dangerously-skip-permissions");
  });
  it("erro do resultado sobe com o texto do CLI (a fonte vira erro no painel, nunca número inventado)", async () => {
    const spawned = fakeSpawn([JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Not logged in" })]);
    await expect(runClaudeSimple({ ...base, executor: "cli", spawnImpl: spawned.impl })).rejects.toThrow(/Claude CLI falhou.*Not logged in/);
  });
  it("sem o CLI instalado, a consulta segue pelo Agent SDK e devolve a resposta dele", async () => {
    sdk.query.mockReturnValueOnce((async function* () { yield { type: "result", subtype: "success", is_error: false, result: "via sdk", total_cost_usd: 0.05 }; })());
    const impl = vi.fn(() => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); }) as never;
    const out = await runClaudeSimple({ ...base, executor: "cli", allowTool: () => false, spawnImpl: impl });
    expect(out).toEqual({ text: "via sdk", costUsd: 0.05 });
    expect(sdk.query).toHaveBeenCalledTimes(1);
  });
  it("com executor sdk não abre o CLI", async () => {
    sdk.query.mockReturnValueOnce((async function* () { yield { type: "result", subtype: "success", is_error: false, result: "ok sdk", total_cost_usd: 0 }; })());
    const spawned = fakeSpawn([]);
    const out = await runClaudeSimple({ ...base, executor: "sdk", spawnImpl: spawned.impl });
    expect(out.text).toBe("ok sdk");
    expect(spawned.calls).toHaveLength(0);
  });
});
