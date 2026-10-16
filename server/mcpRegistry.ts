import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveRequester } from "./access.ts";
import { addTaskEvent, type Db } from "./store.ts";
import { readSecret, SECRET_NAME } from "./vault.ts";
import { samePhone } from "./evolutionWebhook.ts";

export const mcpServerInputSchema = z.object({ ownerKey: z.string().trim().min(1).max(240), clientId: z.string().uuid().nullable().default(null), name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), transport: z.enum(["stdio", "http", "sse"]), endpoint: z.string().url().optional(), command: z.string().max(500).optional(), allowedTools: z.array(z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/)).max(200).default([]), readOnlyTools: z.array(z.string()).max(200).default([]), timeoutMs: z.number().int().min(100).max(120000).default(10000), authSecretRef: z.string().max(120).optional() });
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;
export interface McpToolAuthorization { server: string; tool: string; allowed: boolean; reason: string }
export interface SavedMcpServer { id: string; owner_key: string; client_id: string | null; name: string; transport: string; endpoint: string | null; allowed_tools: string[]; read_only_tools: string[]; timeout_ms: number; auth_secret_ref: string | null; status: string }

export function validateMcpServer(input: Omit<McpServerInput, "readOnlyTools"> & { readOnlyTools?: string[] }): string[] {
  const errors: string[] = [];
  if (input.name === "maia") errors.push("nome maia é reservado ao catálogo interno");
  if (input.transport !== "http") errors.push("somente MCP Streamable HTTP é suportado nesta versão");
  if (!input.endpoint) errors.push("servidor HTTP/SSE exige endpoint");
  else if (new URL(input.endpoint).protocol !== "https:") errors.push("endpoint MCP exige HTTPS");
  if (input.readOnlyTools?.some((tool) => !input.allowedTools.includes(tool))) errors.push("ferramenta de leitura fora da allowlist");
  if (input.authSecretRef && !SECRET_NAME.test(input.authSecretRef)) errors.push("referência de segredo inválida");
  return errors;
}

export function authorizeMcpTool(server: { name: string; allowed_tools: string[]; status: string }, tool: string): McpToolAuthorization {
  if (server.status !== "configured" && server.status !== "connected") return { server: server.name, tool, allowed: false, reason: "servidor MCP não está habilitado" };
  if (!server.allowed_tools.includes(tool)) return { server: server.name, tool, allowed: false, reason: "ferramenta não está na allowlist do servidor" };
  return { server: server.name, tool, allowed: true, reason: "allowlist explícita; política da Maia ainda deve ser aplicada" };
}

export function allowedMcpEndpoint(endpoint: string, configuredHosts = process.env.MAIA_MCP_ALLOWED_HOSTS ?? ""): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && configuredHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean).includes(url.hostname.toLowerCase());
  } catch { return false; }
}

export async function saveMcpServer(db: Db, input: McpServerInput): Promise<string> {
  const value = mcpServerInputSchema.parse(input);
  const invalid = validateMcpServer(value);
  if (invalid.length) throw new Error(invalid.join("; "));
  const row = { owner_key: value.ownerKey, client_id: value.clientId, name: value.name, transport: value.transport, endpoint: value.endpoint ?? null, command: null, allowed_tools: value.allowedTools, read_only_tools: value.readOnlyTools, timeout_ms: value.timeoutMs, auth_secret_ref: value.authSecretRef ?? null, status: "configured", updated_at: new Date().toISOString() };
  let existing = db.from("maia_mcp_servers").select("id").eq("owner_key", value.ownerKey).eq("name", value.name);
  existing = value.clientId ? existing.eq("client_id", value.clientId) : existing.is("client_id", null);
  const found = await existing.maybeSingle();
  if (found.error) throw new Error(`Consulta MCP indisponível: ${found.error.message}`);
  const result = found.data ? await db.from("maia_mcp_servers").update(row).eq("id", found.data.id).select("id").single() : await db.from("maia_mcp_servers").insert(row).select("id").single();
  if (result.error || !result.data) throw new Error(`Não consegui salvar servidor MCP: ${result.error?.message ?? "sem retorno"}`);
  return String(result.data.id);
}

async function loadMcpServer(db: Db, id: string): Promise<SavedMcpServer> {
  const { data, error } = await db.from("maia_mcp_servers").select("id,owner_key,client_id,name,transport,endpoint,allowed_tools,read_only_tools,timeout_ms,auth_secret_ref,status").eq("id", id).maybeSingle();
  if (error || !data) throw new Error("Servidor MCP não encontrado.");
  return data as SavedMcpServer;
}

async function connectMcp(db: Db, server: SavedMcpServer): Promise<Client> {
  if (server.transport !== "http" || !server.endpoint || !allowedMcpEndpoint(server.endpoint)) throw new Error("Endpoint MCP não autorizado pelo host allowlist.");
  const secret = server.auth_secret_ref ? await readSecret(db, server.auth_secret_ref) : undefined;
  if (server.auth_secret_ref && !secret) throw new Error("Credencial MCP indisponível no cofre.");
  const client = new Client({ name: "agent-maia", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(server.endpoint), { requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined, redirectPolicy: "same-origin" });
  await client.connect(transport, { timeout: server.timeout_ms });
  return client;
}

export async function probeMcpServer(db: Db, id: string): Promise<string[]> {
  const server = await loadMcpServer(db, id);
  if (server.status === "disabled") throw new Error("Servidor MCP desabilitado.");
  let client: Client | null = null;
  try {
    client = await connectMcp(db, server);
    const tools = await client.listTools(undefined, { timeout: server.timeout_ms });
    await db.from("maia_mcp_servers").update({ status: "connected", last_error: null, updated_at: new Date().toISOString() }).eq("id", id);
    return tools.tools.map((tool) => tool.name).filter((name) => server.allowed_tools.includes(name));
  } catch (error) {
    await db.from("maia_mcp_servers").update({ status: "error", last_error: "Conexão, autenticação ou listagem falhou; revisar configuração.", updated_at: new Date().toISOString() }).eq("id", id);
    throw new Error(`MCP indisponível: ${error instanceof Error ? error.name : "erro desconhecido"}`);
  } finally { await client?.close().catch(() => {}); }
}

// Somente leitura explicitamente declarada. Escritas exigem ponte de aprovação própria e ficam recusadas.
export async function callConfiguredMcpReadTool(db: Db, input: { serverId: string; tool: string; arguments: Record<string, unknown>; requesterNumber: string; taskId: number }): Promise<string> {
  const server = await loadMcpServer(db, input.serverId);
  if (server.client_id) throw new Error("MCP por cliente ainda não está habilitado.");
  const requester = await resolveRequester(db, input.requesterNumber, "");
  if (requester.role !== "owner" || !samePhone(input.requesterNumber, server.owner_key)) throw new Error("Acesso MCP recusado.");
  if (!authorizeMcpTool(server, input.tool).allowed || !server.read_only_tools.includes(input.tool)) throw new Error("Ferramenta MCP não autorizada para leitura.");
  let client: Client | null = null;
  try {
    client = await connectMcp(db, server);
    const result = await client.callTool({ name: input.tool, arguments: input.arguments }, undefined, { timeout: server.timeout_ms });
    await addTaskEvent(db, input.taskId, "tool_use", `mcp:${server.name}:${input.tool}`, result.isError ? "falhou" : "leitura concluída");
    if (result.isError) throw new Error("Ferramenta MCP retornou erro.");
    const content = Array.isArray(result.content) ? result.content as Array<{ type: string; text?: string }> : [];
    return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").slice(0, 16000);
  } finally { await client?.close().catch(() => {}); }
}
