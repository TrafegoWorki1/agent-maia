import { describe, expect, it } from "vitest";
import { DAILY_CAP, hasOptOutLine, normalizeNumber, planBatch, remainingToday, startOfTodaySaoPaulo } from "../server/prospeccao.ts";
import { decideAccess, type Requester } from "../server/access.ts";
import { requiresApproval } from "../server/approvalPolicy.ts";

const owner: Requester = { role: "owner", name: "H", number: "1", permissions: new Set() };
const member: Requester = { role: "member", name: "M", number: "2", permissions: new Set(["escrita.pedir", "mensagem.enviar"]) };

describe("números e descadastro", () => {
  it("aceita só DDI+DDD+número, com 12 ou 13 dígitos", () => {
    expect(normalizeNumber("+55 (11) 98888-7777")).toBe("5511988887777");
    expect(normalizeNumber("5511988887777")).toBe("5511988887777");
    expect(normalizeNumber("998372658")).toBeNull();
    expect(normalizeNumber("12345678901234")).toBeNull();
  });

  it("a mensagem precisa ensinar como sair, com a palavra SAIR", () => {
    expect(hasOptOutLine("Oi! Para não receber mais, responda SAIR.")).toBe(true);
    expect(hasOptOutLine("Oi! Responda sair se não quiser mais.")).toBe(true);
    expect(hasOptOutLine("Oi, tudo bem? Quero te mostrar uma oferta.")).toBe(false);
  });
});

describe("teto diário", () => {
  it("o teto é de 30 e nunca fica negativo", () => {
    expect(DAILY_CAP).toBe(30);
    expect(remainingToday(0)).toBe(30);
    expect(remainingToday(29)).toBe(1);
    expect(remainingToday(30)).toBe(0);
    expect(remainingToday(45)).toBe(0);
  });

  it("o dia começa à meia-noite de São Paulo (UTC-3)", () => {
    const s = startOfTodaySaoPaulo(new Date("2026-10-12T02:30:00Z"));
    expect(s).toBe("2026-10-11T00:00:00-03:00");
  });
});

describe("planejamento do lote", () => {
  const onWhatsApp = new Set(["5511988887777", "5511988886666"]);
  it("aceita quem tem WhatsApp, e explica quem ficou de fora", () => {
    const plan = planBatch({
      items: [
        { numero: "+55 11 98888-7777", nome: "Ana" },
        { numero: "5511988886666", nome: "Bia" },
        { numero: "5585911110000", nome: "Sem zap" },
        { numero: "5511988887777", nome: "Repetida" },
        { numero: "12", nome: "Inválido" },
        { numero: "5585922220000", nome: "Saiu" },
        { numero: "5585933330000", nome: "Já falamos" },
      ],
      optouts: new Set(["5585922220000"]),
      contacted: new Set(["5585933330000"]),
      onWhatsApp: new Set([...onWhatsApp, "5585922220000", "5585933330000"]),
    });
    expect(plan.accepted).toEqual([{ number: "5511988887777", name: "Ana" }, { number: "5511988886666", name: "Bia" }]);
    const motivos = Object.fromEntries(plan.skipped.map((s) => [s.number, s.motivo]));
    expect(motivos["5585911110000"]).toBe("sem WhatsApp");
    expect(motivos["5511988887777"]).toBe("repetido na mesma lista");
    expect(motivos["12"]).toMatch(/inválido/);
    expect(motivos["5585922220000"]).toBe("pediu para sair");
    expect(motivos["5585933330000"]).toMatch(/já foi contatado/);
  });

  it("nome longo é cortado e vazio fica vazio", () => {
    const plan = planBatch({ items: [{ numero: "5511988887777", nome: "x".repeat(120) }], optouts: new Set(), contacted: new Set(), onWhatsApp });
    expect(plan.accepted[0].name).toHaveLength(80);
  });
});

describe("acesso às ferramentas de prospecção", () => {
  it("preparar, descadastrar e enviar são só do dono; o envio pede OK a cada uso, até do dono", () => {
    for (const tool of ["mcp__maia__prospeccao_preparar", "mcp__maia__prospeccao_descadastrar"]) {
      expect(decideAccess(tool, owner, {}, false).decision, tool).toBe("allow");
      expect(decideAccess(tool, member, {}, false).decision, tool).toBe("approve");
    }
    expect(requiresApproval("mcp__maia__prospeccao_enviar_proximo")).toBe(true);
    expect(decideAccess("mcp__maia__prospeccao_enviar_proximo", owner, {}, false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__prospeccao_enviar_proximo", member, {}, false).decision).toBe("approve");
  });
});
