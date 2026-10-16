import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRoutingConfig } from "../server/ai/config.ts";
import { RULE_CATALOG } from "../server/ruleCatalog.ts";

describe("fonte única do limite de execução", () => {
  it("usa a configuração nos executores e a documentação não mantém o limite antigo", () => {
    const maxSteps = loadRoutingConfig(true).execution.maxSteps;
    const ownerAgent = readFileSync(new URL("../server/maiaOwnerAgent.ts", import.meta.url), "utf8");
    const human = readFileSync(new URL("../docs/regras-comportamento-maia.md", import.meta.url), "utf8");
    const rule = RULE_CATALOG.find((item) => item.codigo === "execucao")!;
    expect(maxSteps).toBe(30);
    expect(ownerAgent).not.toMatch(/maxTurns:\s*30/);
    expect(ownerAgent.match(/execution\.maxSteps/g)?.length).toBeGreaterThanOrEqual(2);
    expect(human).toContain(`**${maxSteps} passos observáveis**`);
    expect(rule.texto).toContain("execution.maxSteps");
    expect(rule.texto).not.toContain("12 passos");
  });
});
