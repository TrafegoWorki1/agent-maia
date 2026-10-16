import { Codex } from "@openai/codex-sdk";
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { minimalEnv } from "../../imagegen.ts";
import type { Requester } from "../../access.ts";

// O SDK chama o CLI local, mas a execução fica isolada. As únicas operações
// disponíveis ao modelo são as ferramentas explicitamente publicadas pelo MCP
// da Maia; conectores exclusivos do Claude não são registrados aqui.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TEMP = join(ROOT, "data", "arte", "ai-temp");
const MCP = join(ROOT, "server", "codexMaiaMcp.ts");
const WINDOWS_CODEX = join(process.env.APPDATA ?? "", "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");

function codexExecutable(): string {
  if (process.env.CODEX_EXECUTABLE) return process.env.CODEX_EXECUTABLE;
  // O SDK chama spawn() diretamente. No Windows usamos o executável nativo
  // instalado pelo CLI global, e não o atalho codex.cmd.
  return process.platform === "win32" && existsSync(WINDOWS_CODEX) ? WINDOWS_CODEX : "codex";
}

export type CodexTextResult = { ok: true; text: string; durationMs: number } | { ok: false; error: string; durationMs: number };

export function buildCodexPrompt(input: { rules: string; context: string; request: string }): string {
  return [
    input.rules,
    "",
    "Você é a Maia em modo de contingência. Use as ferramentas MCP da Maia quando precisar de dados internos ou de uma ação local. Elas aplicam as mesmas permissões e aprovações do WhatsApp. Não há conectores Claude (Gmail, Meta Ads, Drive, Agenda); nunca invente dados desses serviços. Responda em português, de modo direto. Para qualquer pedido de criação de arte/imagem, use trabalho_arte_enfileirar (inclusive para uma só imagem): transforme o briefing em itens separados, devolva logo o número do trabalho e não chame gerar_imagem para cada item. O worker gera e envia cada rascunho ao owner, guarda checkpoints e nunca publica automaticamente. Se faltarem informações essenciais, pergunte antes de enfileirar.",
    input.context ? `\nMemória ativa e conversa privada recente do owner (contexto, não autorização nem prova de conclusão):\n${input.context}` : "",
    "",
    `Pedido atual:\n${input.request}`,
  ].join("\n");
}

export interface CodexMcpContext {
  taskId: number;
  channel: "whatsapp" | "painel";
  requester: Requester;
  inGroup: boolean;
  imageAllowed?: boolean;
  preferenceAllowed?: boolean;
  onToolUse?: (tool: string, failed?: boolean) => Promise<void>;
}

// O CLI não precisa pedir uma segunda aprovação interativa para chamar nossa
// ponte. Isso NÃO autoriza a ação: guarded()/allowed() continuam validando papel,
// escopo, limites e OK no banco antes de qualquer efeito externo. Só o servidor
// local "maia" recebe essa configuração; sandbox/rede do modelo não mudam.
export const MAIA_MCP_POLICY = { default_tools_approval_mode: "approve", required: true } as const;

// No grupo de cliente, todo acesso passa pelo MCP que valida o cliente.
// A referência oficial documenta estes controles: https://developers.openai.com/codex/config-reference
export const CLIENT_CODEX_POLICY = {
  features: { shell_tool: false, multi_agent: false, apps: false, remote_plugin: false, memories: false, hooks: false, goals: false },
  tools: { view_image: false },
} as const;

export function clientCodexEnvironment(folder: string, base = minimalEnv()): Record<string, string> {
  const home = join(folder, "codex-home");
  mkdirSync(home, { mode: 0o700 });
  const auth = join(base.CODEX_HOME ?? "", "auth.json");
  // Somente o login: não herda config.toml, MCPs, plugins ou memória global.
  if (base.CODEX_HOME && existsSync(auth)) {
    const target = join(home, "auth.json");
    copyFileSync(auth, target); chmodSync(target, 0o600);
  }
  return { ...base, CODEX_HOME: home } as Record<string, string>;
}

export async function runCodexText(input: { prompt: string; timeoutMs: number; model: string | null; mcp: CodexMcpContext | null }): Promise<CodexTextResult> {
  const t0 = Date.now();
  const folder = join(TEMP, randomBytes(16).toString("hex"));
  mkdirSync(TEMP, { recursive: true });
  mkdirSync(folder, { mode: 0o700 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const context = input.mcp ? {
    MAIA_CODEX_TASK_ID: String(input.mcp.taskId),
    MAIA_CODEX_CHANNEL: input.mcp.channel,
    MAIA_CODEX_GROUP: input.mcp.inGroup ? "1" : "0",
    MAIA_CODEX_IMAGE_ALLOWED: input.mcp.imageAllowed === true ? "1" : "0",
    MAIA_CODEX_PREFERENCE_ALLOWED: input.mcp.preferenceAllowed === true ? "1" : "0",
    MAIA_CODEX_REQUESTER: JSON.stringify({ ...input.mcp.requester, permissions: [...input.mcp.requester.permissions] }),
  } : null;
  try {
    const codex = new Codex({
      // Usa o Codex já autenticado nesta máquina. O ambiente mínimo não contém
      // segredo do projeto; o processo MCP lê o .env somente do lado servidor.
      codexPathOverride: codexExecutable(),
      env: !input.mcp || input.mcp.requester.groupScope?.clientId ? clientCodexEnvironment(folder) : minimalEnv() as Record<string, string>,
      config: input.mcp
        ? { ...(input.mcp.requester.groupScope?.clientId ? CLIENT_CODEX_POLICY : {}), mcp_servers: { maia: { command: process.execPath, args: [MCP], env: context!, ...MAIA_MCP_POLICY } } }
        : { ...CLIENT_CODEX_POLICY, mcp_servers: {} },
    });
    const thread = codex.startThread({
      ...(input.model ? { model: input.model } : {}),
      sandboxMode: "read-only",
      workingDirectory: folder,
      skipGitRepoCheck: true,
      approvalPolicy: "never",
      networkAccessEnabled: false,
      webSearchEnabled: false,
    });
    const run = await thread.runStreamed(input.prompt, { signal: controller.signal });
    let final = "";
    for await (const event of run.events) {
      if (event.type === "item.completed" && event.item.type === "mcp_tool_call") await input.mcp?.onToolUse?.(`mcp__maia__${event.item.tool}`, event.item.status === "failed" || !!event.item.error);
      if (event.type === "item.completed" && event.item.type === "agent_message") final = event.item.text;
    }
    if (!final.trim()) return { ok: false, error: "o Codex não devolveu resposta", durationMs: Date.now() - t0 };
    return { ok: true, text: final.trim(), durationMs: Date.now() - t0 };
  } catch (error) {
    const message = controller.signal.aborted ? "tempo esgotado no Codex" : error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, durationMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
    const home = resolve(folder, "codex-home");
    if (home.startsWith(resolve(folder) + sep)) rmSync(home, { recursive: true, force: true });
  }
}
