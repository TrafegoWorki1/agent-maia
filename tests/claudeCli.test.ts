import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildCliArgs, claudeExecutor, cliAddDirs, cliEnv, readStreamLine, runClaudeCli, ClaudeCliUnavailable, CLI_DENY_READ, CLI_DISALLOWED, CLI_TOOLS, PERMISSION_TOOL } from "../server/ai/providers/claudeCli.ts";
import { DEFAULT_CONFIG } from "../server/ai/config.ts";
import { classifyError } from "../server/ai/errorClassifier.ts";
import { decideBuiltin, ownerRequester } from "../server/access.ts";
import { fakeSpawn } from "./helpers/fakeClaude.ts";

const ok = (result = "pronto") => JSON.stringify({ type: "result", subtype: "success", is_error: false, result, total_cost_usd: 0.01, usage: { input_tokens: 10, output_tokens: 5 } });
const maia = () => new McpServer({ name: "maia", version: "1.0.0" });
const base = { prompt: "oi", systemPrompt: "regras", model: "haiku", maxBudgetUsd: 0.5, maxTurns: 12, timeoutMs: 5000, permission: async () => ({ behavior: "deny" as const, message: "x" }), onToolUse: async () => {} };

describe("escolha do executor do Claude", () => {
  it("usa o CLI por padrão e volta ao SDK pela config ou pela variável de ambiente", () => {
    expect(claudeExecutor(DEFAULT_CONFIG, {})).toBe("cli");
    const sdk = { ...DEFAULT_CONFIG, providers: { ...DEFAULT_CONFIG.providers, claude: { ...DEFAULT_CONFIG.providers.claude, executor: "sdk" as const } } };
    expect(claudeExecutor(sdk, {})).toBe("sdk");
    expect(claudeExecutor(DEFAULT_CONFIG, { MAIA_CLAUDE_EXECUTOR: "sdk" })).toBe("sdk");
    expect(claudeExecutor(sdk, { MAIA_CLAUDE_EXECUTOR: "cli" })).toBe("cli");
    expect(claudeExecutor(DEFAULT_CONFIG, { MAIA_CLAUDE_EXECUTOR: "qualquer" })).toBe("cli");
  });
  it("o config/ai-routing.json versionado aponta para o CLI", () => {
    const cfg = JSON.parse(readFileSync("config/ai-routing.json", "utf8"));
    expect(cfg.providers.claude.executor).toBe("cli");
  });
});

describe("argumentos e ambiente do CLI", () => {
  const args = buildCliArgs({ model: "haiku", maxBudgetUsd: 0.5, maxTurns: 12, systemPromptFile: "s.txt", mcpConfigFile: "m.json", settingsFile: "c.json", addDirs: ["/srv/repos/a", "/srv/repos/b"] });
  it("mantém o agente operacional restrito: só leitura, sem shell, escrita nem web", () => {
    expect(args).toContain("--restricted");
    expect(args[args.indexOf("--tools") + 1]).toBe(CLI_TOOLS.join(","));
    for (const blocked of ["Bash", "PowerShell", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"]) {
      expect(CLI_TOOLS).not.toContain(blocked);
      expect(CLI_DISALLOWED).toContain(blocked);
    }
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("bypassPermissions");
  });
  it("toda ferramenta passa pelo verificador do servidor e o modelo não chama o verificador", () => {
    expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe(PERMISSION_TOOL);
    expect(args.slice(args.indexOf("--disallowedTools"))).toContain(PERMISSION_TOOL);
  });
  it("aplica orçamento, passos, modelo e pastas extras", () => {
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("0.5");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("12");
    expect(args[args.indexOf("--model") + 1]).toBe("haiku");
    expect(args.slice(args.indexOf("--add-dir") + 1)).toEqual(["/srv/repos/a", "/srv/repos/b"]);
    expect(buildCliArgs({ maxBudgetUsd: 1, maxTurns: 1, systemPromptFile: "s", mcpConfigFile: "m", settingsFile: "c", addDirs: [] })).not.toContain("--add-dir");
  });
  it("segredos de leitura ficam negados dentro da pasta de trabalho", () => {
    expect(CLI_DENY_READ).toEqual(expect.arrayContaining(["Read(**/.env)", "Read(**/.env.*)", "Read(**/.git/**)", "Read(**/.ssh/**)"]));
  });
  it("não repassa segredos do projeto ao processo do CLI", () => {
    const env = cliEnv({ PATH: "/bin", HOME: "/home/maia", ANTHROPIC_API_KEY: "sk-ant", SUPABASE_SERVICE_ROLE_KEY: "segredo", EVOLUTION_API_KEY: "segredo", OPENAI_API_KEY: "segredo", ZERNIO_API_KEY: "segredo" });
    expect(env.PATH).toBe("/bin");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(Object.keys(env).filter((k) => /SUPABASE|EVOLUTION|OPENAI|ZERNIO/.test(k))).toEqual([]);
  });
  it("lê as pastas extras da VPS", () => {
    expect(cliAddDirs({})).toEqual([]);
    expect(cliAddDirs({ MAIA_CLAUDE_ADD_DIRS: ["/srv/a", " /srv/b ", ""].join(process.platform === "win32" ? ";" : ":") })).toEqual(["/srv/a", "/srv/b"]);
  });
});

describe("leitura do stream-json", () => {
  it("registra as ferramentas usadas e devolve o resultado", () => {
    const state = { usedTools: [] as string[], result: null as never };
    expect(readStreamLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "x" }, { type: "tool_use", name: "mcp__maia__buscar_conhecimento" }] } }), state)).toEqual(["mcp__maia__buscar_conhecimento"]);
    readStreamLine(ok("feito"), state);
    expect(state.result).toEqual({ reply: "feito", costUsd: 0.01, tokensIn: 10, tokensOut: 5 });
    expect(readStreamLine("linha que não é json", state)).toEqual([]);
  });
  it("erro do resultado sobe com o texto original para o classificador (limite de uso aciona o Codex)", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "You've hit your weekly limit · resets 5am" });
    expect(() => readStreamLine(line, { usedTools: [], result: null })).toThrow(/Claude CLI falhou/);
    try { readStreamLine(line, { usedTools: [], result: null }); } catch (error) { expect(classifyError(error)).toMatchObject({ kind: "quota", fallbackAllowed: true }); }
    expect(() => readStreamLine(JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true }), { usedTools: [], result: null })).toThrow(/error_max_budget/);
  });
});

describe("execução do CLI", () => {
  it("envia o pedido por stdin, não deixa segredos nos argumentos e devolve resposta, custo e ferramentas", async () => {
    const tools: string[] = [];
    const spawned = fakeSpawn([JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__maia__operacao_resumo" }] } }), ok("tudo certo")]);
    const out = await runClaudeCli({ ...base, prompt: "Pedido secreto do dono", systemPrompt: "SYSTEM-LONGO", maia: maia() as never, onToolUse: async (n) => { tools.push(n); }, spawnImpl: spawned.impl }, { MAIA_CLAUDE_BIN: "claude-test", MAIA_CLAUDE_WORKDIR: process.cwd(), SUPABASE_SERVICE_ROLE_KEY: "segredo", PATH: process.env.PATH });
    expect(out).toEqual({ reply: "tudo certo", costUsd: 0.01, tokensIn: 10, tokensOut: 5 });
    expect(tools).toEqual(["mcp__maia__operacao_resumo"]);
    const [call] = spawned.calls;
    expect(call.cmd).toBe("claude-test");
    expect(call.stdin).toBe("Pedido secreto do dono");
    expect(call.args.join(" ")).not.toContain("Pedido secreto");
    expect(call.args.join(" ")).not.toContain("SYSTEM-LONGO");
    expect((call.options.env as Record<string, string>).SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
  it("CLI inexistente vira ClaudeCliUnavailable (o worker então usa o SDK, antes de qualquer ação)", async () => {
    const impl = vi.fn(() => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); }) as never;
    await expect(runClaudeCli({ ...base, maia: maia() as never, spawnImpl: impl })).rejects.toBeInstanceOf(ClaudeCliUnavailable);
  });
  it("opção não suportada pela versão instalada também cai no SDK", async () => {
    const spawned = fakeSpawn([], { code: 1, stderr: "error: unknown option '--restricted'" });
    await expect(runClaudeCli({ ...base, maia: maia() as never, spawnImpl: spawned.impl })).rejects.toBeInstanceOf(ClaudeCliUnavailable);
  });
  it("saída sem resultado é erro comum, que não aciona o SDK", async () => {
    const spawned = fakeSpawn([], { code: 1, stderr: "falha qualquer" });
    const error = await runClaudeCli({ ...base, maia: maia() as never, spawnImpl: spawned.impl }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ClaudeCliUnavailable);
    expect(String(error.message)).toContain("encerrou sem resultado");
  });
  it("estourar o tempo encerra o processo e sobe 'tempo esgotado'", async () => {
    const spawned = fakeSpawn([], { hang: true });
    await expect(runClaudeCli({ ...base, timeoutMs: 50, maia: maia() as never, spawnImpl: spawned.impl })).rejects.toThrow("tempo esgotado no Claude");
  });
});

describe("leitura de repositórios extras (VPS)", () => {
  const roots = { projectRoot: "/srv/maia", mediaDir: "/srv/maia/data/midia", extraRoots: ["/srv/repos/site"] };
  const resolvePath = (p: string) => p;
  it("o dono lê as pastas extras, menos segredos, e continua sem ler fora delas", () => {
    const owner = ownerRequester();
    expect(decideBuiltin("Read", { file_path: "/srv/repos/site/src/app.ts" }, owner, roots, resolvePath).decision).toBe("allow");
    expect(decideBuiltin("Read", { file_path: "/srv/repos/site/.env" }, owner, roots, resolvePath).decision).toBe("deny");
    expect(decideBuiltin("Read", { file_path: "/srv/repos/site/.git/config" }, owner, roots, resolvePath).decision).toBe("deny");
    expect(decideBuiltin("Read", { file_path: "/etc/passwd" }, owner, roots, resolvePath).decision).toBe("deny");
  });
  it("membro não lê as pastas extras", () => {
    const member = { role: "member" as const, name: "M", number: "1", permissions: new Set(["conversa.maia"]) };
    expect(decideBuiltin("Read", { file_path: "/srv/repos/site/src/app.ts" }, member, roots, resolvePath).decision).toBe("deny");
  });
});

describe("paridade de ferramentas entre Claude e Codex", () => {
  const names = (file: string, re: RegExp) => new Set([...readFileSync(file, "utf8").matchAll(re)].map((m) => m[1]));
  const claude = names("server/maiaImageTool.ts", /\btool\(\s*"([a-z_]+)"/g);
  const codex = names("server/codexMaiaMcp.ts", /registerTool\(\s*"([a-z_]+)"/g);
  // Só depende do conector Meta Ads do Claude: o Codex não tem como usar o link temporário.
  const CLAUDE_ONLY = new Set(["anuncio_midia_url_temporaria"]);
  it("o Codex tem todas as ferramentas da Maia que não dependem de conectores do Claude", () => {
    expect([...claude].filter((n) => !codex.has(n) && !CLAUDE_ONLY.has(n))).toEqual([]);
  });
  it("a ponte do Codex não inventa ferramenta sem equivalente no Claude (exceto grupo_criar, que tem fluxo próprio)", () => {
    expect([...codex].filter((n) => !claude.has(n) && n !== "grupo_criar")).toEqual([]);
  });
});
