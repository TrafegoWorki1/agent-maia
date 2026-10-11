import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createImageServer } from "../server/maiaImageTool.ts";

// Verificação offline: o servidor de ferramentas real da Maia (o mesmo que o SDK usa em processo) precisa funcionar
// pelo MCP HTTP local que o Claude Code CLI consome. Só LISTA as ferramentas; nenhuma é executada, sem banco nem rede externa.
//   node scripts/smoke-maia-tools-http.ts
const maia = createImageServer("whatsapp", 0, false, true, false);
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
await maia.instance.connect(transport as never);
const http = createServer((req, res) => { transport.handleRequest(req, res).catch(() => res.writeHead(500).end()); });
await new Promise<void>((ok) => http.listen(0, "127.0.0.1", ok));
const port = (http.address() as { port: number }).port;

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/`)));
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log(JSON.stringify({ total: names.length, comSchema: tools.filter((t) => t.inputSchema?.type === "object").length, amostra: names.slice(0, 6) }));

await client.close();
await maia.instance.close();
http.closeAllConnections();
http.close();
process.exit(names.length >= 40 && names.includes("grupo_alterar_foto") && names.includes("buscar_conhecimento") ? 0 : 1);
