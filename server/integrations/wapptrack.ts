// Cliente mínimo do MCP do WappTrack (CRM/automação de WhatsApp da empresa, motor Disparom) via Streamable HTTP.
// Variáveis de ambiente: WAPPTRACK_MCP_URL, WAPPTRACK_MCP_TOKEN. Protocolo: JSON-RPC 2.0 "tools/call" por POST,
// sem necessidade de initialize/sessão (confirmado contra o servidor real). Resposta chega como texto simples
// ou como um único evento SSE ("event: message\ndata: {...}"); as duas formas são aceitas.

const TIMEOUT_MS = 20_000;
const MAX_RESULT_CHARS = 16_000;

export class WapptrackError extends Error {}

// Só leitura: nenhuma delas cria, altera ou apaga nada na empresa.
export const WAPPTRACK_READ_TOOLS = new Set([
  "get_active_account", "list_connections", "list_members", "list_departments", "list_labels",
  "list_custom_fields", "list_customers", "list_products", "list_sales_history", "list_templates",
  "list_pixel_configs", "list_payment_integrations", "list_flows", "get_flow", "validate_flow",
  "list_node_types", "get_node_type", "list_trigger_types", "list_agents", "get_agent",
  "get_agent_config", "list_knowledge_bases",
]);

// Cria, altera ou apaga algo na empresa (fluxo, agente, cliente, etiqueta etc.).
export const WAPPTRACK_WRITE_TOOLS = new Set([
  "create_customer", "create_label", "create_custom_field", "create_department", "create_product",
  "create_flow", "update_flow", "archive_flow", "delete_flow", "add_flow_node", "update_flow_node",
  "delete_flow_node", "reposition_flow_nodes", "add_flow_connection", "delete_flow_connection",
  "add_flow_trigger", "delete_flow_trigger", "create_agent", "update_agent", "delete_agent",
  "manage_knowledge_base", "save_agent_stage", "delete_agent_stage", "replace_stage_training",
  "set_agent_business_hours", "manage_agent_transition",
]);

function wapptrackEnv(): { url: string; token: string } {
  const url = process.env.WAPPTRACK_MCP_URL?.trim();
  const token = process.env.WAPPTRACK_MCP_TOKEN?.trim();
  if (!url || !token) throw new WapptrackError("WappTrack não configurado: defina WAPPTRACK_MCP_URL e WAPPTRACK_MCP_TOKEN no .env do servidor.");
  return { url, token };
}

// O corpo pode vir como JSON puro ou como um evento SSE de uma linha só ("event: message\ndata: {...}").
function parseJsonRpcBody(text: string): unknown {
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  const jsonText = dataLine ? dataLine.slice(5).trim() : text.trim();
  try { return JSON.parse(jsonText); } catch { throw new WapptrackError("WappTrack: resposta sem JSON válido."); }
}

interface JsonRpcToolResult { content?: Array<{ type: string; text?: string }>; isError?: boolean }

export async function callWapptrackTool(toolName: string, args: Record<string, unknown>): Promise<string> {
  if (!WAPPTRACK_READ_TOOLS.has(toolName) && !WAPPTRACK_WRITE_TOOLS.has(toolName)) {
    throw new WapptrackError(`ferramenta "${toolName}" não está no inventário do WappTrack.`);
  }
  const { url, token } = wapptrackEnv();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: toolName, arguments: args } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const rawText = await res.text();
  if (!res.ok) throw new WapptrackError(`WappTrack respondeu HTTP ${res.status}: ${rawText.slice(0, 300)}`);
  const parsed = parseJsonRpcBody(rawText) as { result?: JsonRpcToolResult; error?: { message?: string } };
  if (parsed.error) throw new WapptrackError(`WappTrack: ${parsed.error.message ?? "erro desconhecido"}`);
  const result = parsed.result;
  if (!result) throw new WapptrackError("WappTrack: resposta sem resultado.");
  const text = (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").slice(0, MAX_RESULT_CHARS);
  if (result.isError) throw new WapptrackError(text || "WappTrack retornou erro.");
  return text;
}
