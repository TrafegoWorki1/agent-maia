import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runClaudeCli, type Permission } from "../server/ai/providers/claudeCli.ts";

// Verificação manual do executor Claude Code CLI (usa a conta logada; custa centavos com o modelo haiku).
// Não toca no banco, na Evolution nem em nada externo: o servidor "maia" abaixo é falso e o verificador só libera `eco`.
//   pnpm smoke:claude-cli
// Confere: o CLI acha o binário e a sessão, chama a ferramenta pelo MCP local, passa pelo verificador de permissão
// (inclusive recusando) e não lê segredos (.env).

const calls: string[] = [];
const maia = new McpServer({ name: "maia", version: "1.0.0" });
maia.registerTool("eco", { description: "Devolve o texto recebido.", inputSchema: { texto: z.string() } }, async ({ texto }) => ({ content: [{ type: "text" as const, text: `eco: ${texto}` }] }));
maia.registerTool("apagar_tudo", { description: "Ferramenta de teste que deve ser recusada.", inputSchema: {} }, async () => {
  calls.push("EXECUTOU apagar_tudo");
  return { content: [{ type: "text" as const, text: "apagado" }] };
});

const asked: string[] = [];
const permission: Permission = async (tool, input) => {
  asked.push(tool);
  return tool === "mcp__maia__eco" ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Não permitido neste teste." };
};

const tools: string[] = [];
const out = await runClaudeCli({
  prompt: "Faça nesta ordem: 1) chame a ferramenta mcp__maia__eco com texto 'ola'; 2) chame a ferramenta mcp__maia__apagar_tudo; 3) leia o arquivo .env desta pasta. Depois responda em uma frase dizendo o que funcionou e o que foi recusado.",
  systemPrompt: "Você é um verificador de integração. Use as ferramentas pedidas, sem inventar resultados.",
  model: process.env.SMOKE_MODEL ?? "haiku",
  maxBudgetUsd: 0.1,
  maxTurns: 8,
  timeoutMs: 120_000,
  maia: maia as never,
  permission,
  onToolUse: async (name) => { tools.push(name); },
});

const ok = {
  "chamou eco": tools.includes("mcp__maia__eco"),
  "verificador foi consultado": asked.includes("mcp__maia__eco") && asked.includes("mcp__maia__apagar_tudo"),
  "apagar_tudo não executou": !calls.length,
  "resposta recebida": out.reply.length > 0,
};
console.log(JSON.stringify({ ferramentas: tools, perguntadas: asked, custoUsd: out.costUsd, resposta: out.reply, verificacoes: ok }, null, 2));
process.exit(Object.values(ok).every(Boolean) ? 0 : 1);
