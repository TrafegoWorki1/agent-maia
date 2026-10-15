import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createImageServer } from "../server/maiaImageTool.ts";
import { parseJsonObject, parseParams } from "../server/integrationCatalog.ts";

// Regressão de 12/10/2026: um z.record no esquema de uma ferramenta derrubou a listagem MCP inteira (nenhuma ferramenta
// mcp__maia__ chegou ao Claude). Aqui a lista é pedida pelo protocolo de verdade, como o Claude Code CLI faz.
describe("listagem MCP das ferramentas da Maia", () => {
  it("o servidor real lista todas as ferramentas, cada uma com esquema de objeto", async () => {
    const maia = createImageServer("whatsapp", undefined, false, true, false);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await maia.instance.connect(serverSide as never);
    const client = new Client({ name: "teste", version: "1.0.0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // Limite frouxo de propósito: a falha de 12/10 zerava a lista inteira, então basta garantir dezenas de ferramentas.
    expect(names.length).toBeGreaterThanOrEqual(40);
    for (const wanted of ["grupo_info", "grupo_enviar_texto", "integracao_listar", "integracao_chamar", "integracao_chamar_externa", "integracao_propor", "integracao_ativar"]) expect(names).toContain(wanted);
    expect(tools.every((t) => t.inputSchema?.type === "object")).toBe(true);
    await client.close();
    await maia.instance.close();
  });

  it("expõe memória só quando o chamador habilita contexto privado do owner", async () => {
    const privateServer = createImageServer("whatsapp", undefined, false, true, false, true);
    const groupServer = createImageServer("whatsapp", undefined, false, true, false, false);
    const list = async (server: ReturnType<typeof createImageServer>) => {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.instance.connect(serverSide as never);
      const client = new Client({ name: "teste", version: "1.0.0" });
      await client.connect(clientSide);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      await client.close(); await server.instance.close();
      return names;
    };
    const privateNames = await list(privateServer);
    const groupNames = await list(groupServer);
    expect(privateNames).toContain("memoria_buscar");
    expect(privateNames).toContain("memoria_registrar");
    expect(groupNames).not.toContain("memoria_buscar");
    expect(groupNames).not.toContain("memoria_registrar");
  });

  it("nenhuma ferramenta usa z.record no esquema (nem no servidor do Claude, nem na ponte do Codex)", () => {
    for (const file of ["server/maiaImageTool.ts", "server/codexMaiaMcp.ts"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/z\.record\(/);
    }
  });
});

describe("parâmetros recebidos como texto JSON", () => {
  it("aceita objeto plano e preserva tipos", () => {
    expect(parseParams('{"remoteJid":"1@g.us","fromMe":false,"ms":1200}')).toEqual({ ok: true, params: { remoteJid: "1@g.us", fromMe: false, ms: 1200 } });
    expect(parseParams(undefined)).toEqual({ ok: true, params: {} });
    expect(parseParams("")).toEqual({ ok: true, params: {} });
  });

  it("recusa texto inválido, lista, valor aninhado, nome estranho e excesso", () => {
    for (const bad of ["{", "[1,2]", "null", '{"a":{"b":1}}', '{"a b":"x"}', `{"a":"${"x".repeat(501)}"}`, JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "x"])))]) {
      expect(parseParams(bad), bad.slice(0, 30)).toMatchObject({ ok: false });
    }
  });

  it("o corpo da proposta aceita objeto aninhado", () => {
    expect(parseJsonObject('{"key":{"id":"{{id}}"}}')).toEqual({ ok: true, value: { key: { id: "{{id}}" } } });
    expect(parseJsonObject("[1]")).toMatchObject({ ok: false });
  });
});
