import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadRoutingConfig } from "../config.ts";
import { ClaudeCliUnavailable, claudeExecutor, runClaudeCli } from "./claudeCli.ts";
import type { ClaudeExecutor } from "../types.ts";

// Consulta simples ao Claude (uma pergunta, uma resposta de texto), sem as ferramentas da Maia: usada pela atualização
// periódica do painel e pela Maia de demonstração. Mesmo executor da Maia (CLI por padrão, SDK como alternativa).
// `allowTool` diz quais ferramentas de conectores da conta podem ser usadas; todo o resto é recusado.

export interface SimpleClaudeInput {
  prompt: string;
  systemPrompt: string;
  model?: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs?: number;
  allowTool?: (toolName: string) => boolean;
  // Demonstração: nenhum conector, nenhuma ferramenta interna.
  noTools?: boolean;
  executor?: ClaudeExecutor;
  spawnImpl?: Parameters<typeof runClaudeCli>[0]["spawnImpl"];
}

export interface SimpleClaudeResult {
  text: string;
  costUsd: number | null;
}

export async function runClaudeSimple(input: SimpleClaudeInput): Promise<SimpleClaudeResult> {
  const executor = input.executor ?? claudeExecutor(loadRoutingConfig());
  const timeoutMs = input.timeoutMs ?? 180_000;
  const allow = input.allowTool ?? (() => false);
  if (executor === "cli") {
    try {
      const out = await runClaudeCli({
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        model: input.model,
        maxBudgetUsd: input.maxBudgetUsd,
        maxTurns: input.maxTurns,
        timeoutMs,
        tools: [],
        permission: async (toolName, args) => (allow(toolName) ? { behavior: "allow", updatedInput: args } : { behavior: "deny", message: "Consulta somente leitura, com as ferramentas permitidas desta fonte." }),
        onToolUse: async () => {},
        spawnImpl: input.spawnImpl,
      });
      return { text: out.reply, costUsd: out.costUsd };
    } catch (error) {
      if (!(error instanceof ClaudeCliUnavailable)) throw error;
      console.error("[maia] Claude CLI indisponível, usando o Agent SDK:", error.message);
    }
  }
  return runViaSdk(input, allow, timeoutMs);
}

async function runViaSdk(input: SimpleClaudeInput, allow: (toolName: string) => boolean, timeoutMs: number): Promise<SimpleClaudeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const run = query({
      prompt: input.prompt,
      options: {
        systemPrompt: input.systemPrompt,
        ...(input.model ? { model: input.model } : {}),
        abortController: controller,
        maxTurns: input.maxTurns,
        maxBudgetUsd: input.maxBudgetUsd,
        persistSession: false,
        canUseTool: async (toolName, args) => (allow(toolName) ? { behavior: "allow", updatedInput: args } : { behavior: "deny", message: "Consulta somente leitura, com as ferramentas permitidas desta fonte." }),
        // Só os conectores do claude.ai: sem configurações locais, sem servidores MCP do computador.
        settingSources: [],
        ...(input.noTools ? { tools: [] } : {}),
        disallowedTools: ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"],
        cwd: process.cwd(),
        env: { ...process.env },
      },
    });
    for await (const message of run) {
      if (message.type !== "result") continue;
      const costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? null;
      if (message.is_error || message.subtype !== "success") throw new Error(`Agent SDK falhou (${message.subtype})`);
      return { text: message.result, costUsd };
    }
    throw new Error("O Agent SDK encerrou sem resposta");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("tempo esgotado no Claude");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
