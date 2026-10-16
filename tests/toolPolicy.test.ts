import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAIA_TOOL_NAMES, isKnownMcpTool } from "../server/toolPolicy.ts";
import { organizationTools } from "../server/organization.ts";
import { memberAccessTools } from "../server/memberAccessTools.ts";
import { workTools } from "../server/workTasks.ts";

describe("inventário de ferramentas", () => {
  it("cobre todas as ferramentas estáticas e compostas expostas pelos dois executores", () => {
    const names = new Set<string>();
    for (const file of ["../server/maiaImageTool.ts", "../server/codexMaiaMcp.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      for (const pattern of [/registerTool\(\s*["']([^"']+)/g, /\btool\(\s*["']([^"']+)/g]) {
        for (const match of source.matchAll(pattern)) names.add(match[1]);
      }
    }
    for (const tool of [...organizationTools, ...memberAccessTools, ...workTools]) names.add(tool.name);
    expect([...names].filter((name) => !MAIA_TOOL_NAMES.has(name))).toEqual([]);
  });

  it("nega namespace ou ferramenta local desconhecida", () => {
    expect(isKnownMcpTool("mcp__maia__ler_tudo")).toBe(false);
    expect(isKnownMcpTool("mcp__conector_novo__read_all")).toBe(false);
    expect(isKnownMcpTool("mcp__claude_ai_Gmail__search_threads")).toBe(true);
  });
});
