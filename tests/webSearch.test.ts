import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideAccess, decideBuiltin, type Requester } from "../server/access.ts";
import { CLI_DISALLOWED, CLI_OWNER_TOOLS, CLI_TOOLS } from "../server/ai/providers/claudeCli.ts";

const owner: Requester = { role: "owner", name: "H", number: "1", permissions: new Set() };
const member: Requester = { role: "member", name: "M", number: "2", permissions: new Set(["escrita.pedir", "mensagem.enviar"]) };
const ROOTS = { projectRoot: "/projeto", mediaDir: "/midia", memberMediaDir: "/midia-membros" };
const resolve = (p: string) => p;

const rules = JSON.parse(readFileSync("config/maia-rules.json", "utf8")) as { rules: Array<{ codigo: string; texto: string; ordem: number; ativa: boolean }> };
const limites = rules.rules.find((r) => r.codigo === "limites")!;
const migrationName = readdirSync("supabase/migrations").find((f) => f.endsWith("_maia_rules_limites_busca.sql"))!;
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8");

describe("busca na web só para o dono", () => {
  it("o dono pode usar WebSearch; quem não é dono não pode", () => {
    expect(decideBuiltin("WebSearch", { query: "estética" }, owner, ROOTS, resolve).decision).toBe("allow");
    expect(decideBuiltin("WebSearch", { query: "estética" }, member, ROOTS, resolve).decision).toBe("deny");
  });

  it("o CLI oferece WebSearch só na lista do dono e nunca na lista de bloqueio dos demais", () => {
    expect(CLI_OWNER_TOOLS).toContain("WebSearch");
    expect(CLI_TOOLS).not.toContain("WebSearch");
    expect(CLI_DISALLOWED).not.toContain("WebSearch");
  });

  it("WebFetch continua bloqueado em qualquer caso", () => {
    expect(CLI_DISALLOWED).toContain("WebFetch");
    expect(CLI_OWNER_TOOLS).not.toContain("WebFetch");
  });
});

describe("trava depois de busca na web", () => {
  const writeTool = "mcp__maia__grupo_enviar_texto";
  const readTool = "mcp__maia__operacao_resumo";

  it("sem busca, o dono age direto", () => {
    expect(decideAccess(writeTool, owner, { groupRegistered: true }, false).decision).toBe("allow");
  });

  it("depois de busca na web, ação de escrita pede OK mesmo do dono", () => {
    const d = decideAccess(writeTool, owner, { groupRegistered: true, webTainted: true }, false);
    expect(d.decision).toBe("approve");
    expect(d.reason).toMatch(/busca na web/);
  });

  it("depois de busca na web, leitura continua livre", () => {
    expect(decideAccess(readTool, owner, { webTainted: true }, true).decision).toBe("allow");
  });
});

describe("regra limites e migração", () => {
  it("a regra fala da busca, do OK depois da busca e da pergunta antes de passar ao Herickson", () => {
    expect(limites.texto).toMatch(/WebSearch/);
    expect(limites.texto).toMatch(/não precisa aprovar/);
    expect(limites.texto).toMatch(/pede OK, mesmo do dono/);
    expect(limites.texto).toMatch(/pergunte se quer que a demanda seja passada ao Herickson/);
    expect(limites.ordem).toBe(7);
    expect(limites.ativa).toBe(true);
  });

  it("o texto da migração é exatamente o do catálogo", () => {
    expect(migration).toContain(limites.texto);
  });

  it("a migração só troca o texto anterior aprovado (conferido por código)", () => {
    expect(migration).toContain("Se pedirem algo que você não faz, diga que não faz e avise o Herickson com a ferramenta avisar_dono");
    expect(migration).toMatch(/if found and v_current_texto is distinct from v_old_texto then/);
  });
});
