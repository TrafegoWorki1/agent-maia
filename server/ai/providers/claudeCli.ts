import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ClaudeExecutor, RoutingConfig } from "../types.ts";

// Executor principal da Maia: o Claude Code CLI (`claude -p`). As ferramentas da Maia (o mesmo servidor em processo que o
// SDK usa) e a decisão de permissão/aprovação continuam no worker; o CLI as alcança por um MCP HTTP local, só em
// 127.0.0.1, com token por execução. Nada de regra nova: o `permission` recebido é o mesmo CanUseTool do WhatsApp/painel.

export class ClaudeCliUnavailable extends Error {}

export type Permission = (toolName: string, input: Record<string, unknown>) => Promise<{ behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string }>;

export interface ClaudeCliRun {
  reply: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
}

export interface ClaudeCliInput {
  prompt: string;
  systemPrompt: string;
  model: string | undefined;
  maxBudgetUsd: number;
  maxTurns: number;
  timeoutMs: number;
  // Servidor MCP em processo com as ferramentas da Maia (createImageServer(...).instance).
  // Sem servidor, só o verificador de permissão fica disponível (consultas simples, só com conectores da conta).
  maia?: { connect(transport: never): Promise<void>; close(): Promise<void> };
  // Ferramentas internas oferecidas ao CLI. Padrão: leitura (CLI_TOOLS). [] desliga todas.
  tools?: string[];
  permission: Permission;
  onToolUse: (tool: string) => Promise<void>;
  // Recibos estruturados de conectores, sem usar a resposta narrativa como prova.
  onStreamEvent?: (event: Record<string, unknown>) => Promise<void>;
  spawnImpl?: typeof spawn;
}

// Executor escolhido: variável de ambiente > config/ai-routing.json > cli. "sdk" volta ao comportamento anterior.
export function claudeExecutor(cfg: RoutingConfig, env: NodeJS.ProcessEnv = process.env): ClaudeExecutor {
  const wanted = (env.MAIA_CLAUDE_EXECUTOR ?? cfg.providers.claude.executor ?? "cli").trim().toLowerCase();
  return wanted === "sdk" ? "sdk" : "cli";
}

// Ferramentas internas liberadas ao agente operacional: só leitura. Escrita, shell e web ficam fora (iguais ao SDK).
export const CLI_TOOLS = ["Read", "Grep", "Glob", "ToolSearch", "TodoWrite"];
// WebSearch é oferecida só ao dono (maiaOwnerAgent.ts, via `tools`) e o servidor ainda confere cada uso (decideBuiltin).
// WebFetch segue bloqueado: abrir páginas traria o conteúdo inteiro de terceiros para dentro da conversa.
export const CLI_DISALLOWED = ["Bash", "PowerShell", "Edit", "Write", "WebFetch", "NotebookEdit"];
export const CLI_OWNER_TOOLS = [...CLI_TOOLS, "WebSearch"];
// Segredos nunca são lidos, mesmo dentro da pasta de trabalho (onde o CLI não pergunta antes de ler).
export const CLI_DENY_READ = ["**/.env", "**/.env.*", "**/.git/**", "**/.ssh/**", "**/.aws/**", "**/.claude*/**", "**/node_modules/**"].map((p) => `Read(${p})`);
export const PERMISSION_TOOL = "mcp__maiaperm__aprovar";

// O CLI recebe só o necessário para achar o binário e a sessão da conta; nenhum segredo do projeto (banco, Evolution...).
const ENV_KEYS = ["PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "LANG", "LC_ALL", "SHELL", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];

export function cliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { NO_COLOR: "1" };
  for (const key of ENV_KEYS) if (env[key]) out[key] = env[key];
  return out;
}

// Pastas extras de leitura (repositórios na VPS): MAIA_CLAUDE_ADD_DIRS, separadas por ";" (Windows) ou ":" (Linux).
export function cliAddDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MAIA_CLAUDE_ADD_DIRS ?? "").split(delimiter).map((d) => d.trim()).filter(Boolean);
}

export function buildCliArgs(input: { tools?: string[]; model?: string; maxBudgetUsd: number; maxTurns: number; systemPromptFile: string; mcpConfigFile: string; settingsFile: string; addDirs: string[] }): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    // Sem --restricted (decisão do owner, 20/10/2026): ele zera os conectores da conta (Meta Ads etc.), que o
    // agente precisa acessar. Bash/PowerShell/Edit/Write/WebFetch continuam fora por --tools/--disallowedTools;
    // a confinação de Read/Grep/Glob ao projeto é feita em código por decideBuiltin (server/access.ts), não pela
    // flag; e qualquer mcp__ fora do inventário de isKnownMcpTool (server/toolPolicy.ts) é negado por padrão —
    // então um servidor MCP local/global alheio (ex.: outro projeto deste computador) pode até conectar, mas
    // nenhuma ferramenta dele é chamável.
    "--tools", (input.tools ?? CLI_TOOLS).join(","),
    "--disallowedTools", ...CLI_DISALLOWED, PERMISSION_TOOL,
    "--settings", input.settingsFile,
    "--mcp-config", input.mcpConfigFile,
    "--permission-prompt-tool", PERMISSION_TOOL,
    "--system-prompt-file", input.systemPromptFile,
    "--max-turns", String(input.maxTurns),
    "--max-budget-usd", String(input.maxBudgetUsd),
    ...(input.model ? ["--model", input.model] : []),
    ...(input.addDirs.length ? ["--add-dir", ...input.addDirs] : []),
  ];
}

interface StreamState {
  usedTools: string[];
  result: { reply: string; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; cacheReadTokens: number | null; cacheCreationTokens: number | null } | null;
}

// Interpreta uma linha do stream-json. Erros do resultado sobem com o texto do CLI, para o classificador separar
// limite de uso de erro de tarefa (a mesma regra do SDK).
export function readStreamLine(line: string, state: StreamState): string[] {
  if (!line.startsWith("{")) return [];
  let event: any;
  try { event = JSON.parse(line); } catch { return []; }
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const tools = event.message.content.filter((b: any) => b?.type === "tool_use" && typeof b.name === "string").map((b: any) => b.name as string);
    state.usedTools.push(...tools);
    return tools;
  }
  if (event.type === "result") {
    if (event.is_error || event.subtype !== "success") {
      const detail = typeof event.result === "string" && event.result ? `: ${event.result.slice(0, 300)}` : "";
      throw new Error(`Claude CLI falhou (${event.subtype})${detail}`);
    }
    state.result = {
      reply: String(event.result ?? "").trim() || "Não consegui gerar uma resposta.",
      costUsd: event.total_cost_usd ?? null,
      tokensIn: event.usage?.input_tokens ?? null,
      tokensOut: event.usage?.output_tokens ?? null,
      cacheReadTokens: event.usage?.cache_read_input_tokens ?? null,
      cacheCreationTokens: event.usage?.cache_creation_input_tokens ?? null,
    };
  }
  return [];
}

function permissionServer(permission: Permission): McpServer {
  const server = new McpServer({ name: "maiaperm", version: "1.0.0" });
  server.registerTool("aprovar", {
    description: "Decide se o Claude Code pode usar uma ferramenta. Uso interno do servidor; o modelo não chama.",
    inputSchema: { tool_name: z.string(), input: z.record(z.string(), z.unknown()), tool_use_id: z.string().optional() },
  }, async ({ tool_name, input }) => {
    // Qualquer falha na decisão vira recusa: nunca libera por erro.
    const verdict = await permission(tool_name, input).catch((): { behavior: "deny"; message: string } => ({ behavior: "deny", message: "Não consegui verificar a permissão; ação recusada." }));
    return { content: [{ type: "text" as const, text: JSON.stringify(verdict.behavior === "allow" ? { behavior: "allow", updatedInput: verdict.updatedInput ?? input } : verdict) }] };
  });
  return server;
}

interface Loopback {
  port: number;
  token: string;
  close(): Promise<void>;
}

async function startLoopback(maia: ClaudeCliInput["maia"], permission: Permission): Promise<Loopback> {
  const token = randomBytes(24).toString("hex");
  const perm = permissionServer(permission);
  const routes = new Map<string, StreamableHTTPServerTransport>();
  const servers: [string, { connect(transport: never): Promise<void> }][] = [["/perm", perm]];
  if (maia) servers.push(["/maia", maia]);
  for (const [path, server] of servers) {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await server.connect(transport as never);
    routes.set(path, transport);
  }
  let port = 0;
  const http: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const transport = routes.get(path);
    if (req.headers.authorization !== `Bearer ${token}` || req.headers.host !== `127.0.0.1:${port}` || !transport) {
      res.writeHead(403).end();
      return;
    }
    transport.handleRequest(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
  });
  await new Promise<void>((ok, fail) => { http.once("error", fail); http.listen(0, "127.0.0.1", ok); });
  port = (http.address() as { port: number }).port;
  return {
    port,
    token,
    async close() {
      http.closeAllConnections();
      await new Promise<void>((ok) => http.close(() => ok()));
      await Promise.all([...routes.values()].map((t) => t.close().catch(() => {})));
      await perm.close().catch(() => {});
    },
  };
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
  else child.kill("SIGKILL");
}

export async function runClaudeCli(input: ClaudeCliInput, env: NodeJS.ProcessEnv = process.env): Promise<ClaudeCliRun> {
  const dir = mkdtempSync(join(tmpdir(), "maia-claude-"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const permission: Permission = (tool, args) => input.permission(tool, args);
  let loop: Loopback | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  try {
    loop = await startLoopback(input.maia, permission);
    const systemPromptFile = join(dir, "system.txt");
    const mcpConfigFile = join(dir, "mcp.json");
    const settingsFile = join(dir, "settings.json");
    const headers = { Authorization: `Bearer ${loop.token}` };
    writeFileSync(systemPromptFile, input.systemPrompt, "utf8");
    writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: {
      ...(input.maia ? { maia: { type: "http", url: `http://127.0.0.1:${loop.port}/maia`, headers } } : {}),
      maiaperm: { type: "http", url: `http://127.0.0.1:${loop.port}/perm`, headers },
    } }), "utf8");
    writeFileSync(settingsFile, JSON.stringify({ permissions: { deny: CLI_DENY_READ } }), "utf8");
    const args = buildCliArgs({ model: input.model, maxBudgetUsd: input.maxBudgetUsd, maxTurns: input.maxTurns, systemPromptFile, mcpConfigFile, settingsFile, addDirs: cliAddDirs(env), tools: input.tools });
    const spawnFn = input.spawnImpl ?? spawn;
    child = spawnFn(env.MAIA_CLAUDE_BIN || "claude", args, { cwd: env.MAIA_CLAUDE_WORKDIR || process.cwd(), env: cliEnv(env), stdio: ["pipe", "pipe", "pipe"], windowsHide: true }) as ChildProcessWithoutNullStreams;

    const state: StreamState = { usedTools: [], result: null };
    let stderr = "";
    let buffer = "";
    let failure: unknown = null;
    let chain: Promise<void> = Promise.resolve();
    const feed = (line: string) => {
      chain = chain.then(async () => {
        if (failure) return;
        try {
          if (input.onStreamEvent && line.startsWith("{")) await input.onStreamEvent(JSON.parse(line));
          for (const tool of readStreamLine(line, state)) await input.onToolUse(tool);
        } catch (error) { failure = error; }
      });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) { feed(buffer.slice(0, index).trim()); buffer = buffer.slice(index + 1); }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
    controller.signal.addEventListener("abort", () => child && killTree(child), { once: true });

    const code = await new Promise<number | null>((ok, fail) => {
      child!.once("error", fail);
      child!.once("close", ok);
      child!.stdin.on("error", () => {});
      child!.stdin.end(input.prompt, "utf8");
    });
    if (buffer.trim()) feed(buffer.trim());
    await chain;
    if (controller.signal.aborted) throw new Error("tempo esgotado no Claude");
    if (failure) throw failure;
    if (state.result) return state.result;
    const detail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 300);
    if (/unknown option|unknown argument|unrecognized/i.test(stderr)) throw new ClaudeCliUnavailable(`CLI sem suporte a uma opção necessária: ${detail}`);
    throw new Error(`Claude CLI encerrou sem resultado (código ${code})${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") throw new ClaudeCliUnavailable(`Claude CLI não encontrado (${env.MAIA_CLAUDE_BIN || "claude"}); defina MAIA_CLAUDE_BIN ou use MAIA_CLAUDE_EXECUTOR=sdk`);
    throw error;
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null) killTree(child);
    await loop?.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}
