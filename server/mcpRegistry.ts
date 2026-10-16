import { z } from "zod";
import type { Db } from "./store.ts";

export const mcpServerInputSchema = z.object({ ownerKey: z.string().trim().min(1).max(240), clientId: z.string().uuid().nullable().default(null), name: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), transport: z.enum(["stdio", "http", "sse"]), endpoint: z.string().url().optional(), command: z.string().max(500).optional(), allowedTools: z.array(z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/)).max(200).default([]), timeoutMs: z.number().int().min(100).max(120000).default(10000), authSecretRef: z.string().max(120).optional() });
export type McpServerInput = z.infer<typeof mcpServerInputSchema>;
export interface McpToolAuthorization { server: string; tool: string; allowed: boolean; reason: string }

export function validateMcpServer(input: McpServerInput): string[] {
  const errors: string[] = [];
  if (input.transport === "http" || input.transport === "sse") if (!input.endpoint) errors.push("servidor HTTP/SSE exige endpoint");
  if (input.transport === "stdio" && !input.command) errors.push("servidor stdio exige comando configurado");
  if (input.name === "maia") errors.push("nome maia é reservado para o catálogo interno");
  return errors;
}

export function authorizeMcpTool(server: { name: string; allowed_tools: string[]; status: string }, tool: string): McpToolAuthorization {
  if (server.status !== "configured" && server.status !== "connected") return { server: server.name, tool, allowed: false, reason: "servidor MCP não está habilitado" };
  if (!server.allowed_tools.includes(tool)) return { server: server.name, tool, allowed: false, reason: "ferramenta não está na allowlist do servidor" };
  return { server: server.name, tool, allowed: true, reason: "allowlist explícita; política da Maia ainda deve ser aplicada" };
}

export async function saveMcpServer(db: Db, input: McpServerInput): Promise<string> {
  const value = mcpServerInputSchema.parse(input); const invalid = validateMcpServer(value); if (invalid.length) throw new Error(invalid.join("; "));
  const { data, error } = await db.from("maia_mcp_servers").upsert({ owner_key: value.ownerKey, client_id: value.clientId, name: value.name, transport: value.transport, endpoint: value.endpoint ?? null, command: value.command ?? null, allowed_tools: value.allowedTools, timeout_ms: value.timeoutMs, auth_secret_ref: value.authSecretRef ?? null, status: "configured", updated_at: new Date().toISOString() }, { onConflict: "owner_key,name,client_id" }).select("id").single();
  if (error || !data) throw new Error(`Não consegui salvar servidor MCP: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}
