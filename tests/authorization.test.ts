import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorizeRequest, classifyRequest } from "../src/lib/authorization";
import { seedGroups, seedMembers } from "../src/data/seed";
import type { Member } from "../src/lib/types";

// Membro fictício de teste: existe só dentro deste arquivo, nunca aparece na aplicação.
const testMember: Member = {
  id: "membro-teste",
  name: "Membro de teste",
  initials: "MT",
  title: "Fixture de teste",
  color: "#000000",
  groupIds: ["principal", "trafego"],
  permissions: ["metrics.read", "ads.report"],
};

describe("política demonstrativa da Maia", () => {
  const owner = seedMembers.find((member) => member.id === "alex")!;

  beforeAll(() => {
    for (const group of seedGroups) {
      if (group.id === "principal" || group.id === "trafego") group.memberIds.push(testMember.id);
    }
  });

  afterAll(() => {
    for (const group of seedGroups) {
      group.memberIds = group.memberIds.filter((id) => id !== testMember.id);
    }
  });

  it("permite uma consulta de anúncios dentro da permissão do membro", () => {
    const action = classifyRequest("Gere o relatório de anúncios da semana");
    const decision = authorizeRequest(testMember, "trafego", action);
    expect(action.id).toBe("ads-report");
    expect(decision.status).toBe("permitido");
  });

  it("encaminha alteração de orçamento para aprovação pontual do owner", () => {
    const action = classifyRequest("Aumente o orçamento da campanha em 20%");
    const decision = authorizeRequest(testMember, "trafego", action);
    expect(action.id).toBe("ads-budget");
    expect(decision.status).toBe("aguardando_aprovacao");
    expect(decision.rule).toBe("aprovacao_owner_para_acao_sensivel");
  });

  it("não executa nem ignora permissão ausente", () => {
    const action = classifyRequest("Responda a mensagem no Instagram");
    const decision = authorizeRequest(testMember, "trafego", action);
    expect(decision.status).toBe("aguardando_aprovacao");
    expect(decision.rule).toContain("permissao_ausente");
  });

  it("permite ao owner revisar uma ação, sempre em modo simulado", () => {
    const action = classifyRequest("Alterar orçamento da campanha");
    const decision = authorizeRequest(owner, "trafego", action);
    expect(decision.status).toBe("permitido");
    expect(decision.explanation).toContain("apenas simulada");
  });

  it("não confunde palavras que apenas contêm uma palavra-chave, como 'dm' em 'admissões'", () => {
    const action = classifyRequest("Gere o relatório de admissões da semana");
    expect(action.id).not.toBe("instagram-reply");
  });

  it("não aceita integrante da equipe no canal privado de aprovação", () => {
    const action = classifyRequest("Gere um relatório");
    const decision = authorizeRequest(testMember, "aprovacao-alex", action);
    expect(decision.status).toBe("bloqueado");
    expect(decision.rule).toBe("canal_owner_restrito");
  });
});
