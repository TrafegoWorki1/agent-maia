import { describe, expect, it } from "vitest";
import { classifyByRules } from "../server/ai/rulesClassifier.ts";
import { claudeTierFor } from "../server/ai/capabilities.ts";

// Decisão do owner (13/10/2026): o modelo econômico (Haiku) só para pedido simples e curto. Pedido com várias etapas
// ou mensagem longa vai ao modelo principal, senão a Maia parece burra justamente nos pedidos difíceis.
const tierOf = (text: string) => {
  const c = classifyByRules(text);
  return claudeTierFor(c.category, c.complexity);
};

describe("escolha do modelo econômico", () => {
  it("resumo curto e de uma ação continua no econômico", () => {
    expect(tierOf("resume o grupo operacional de hoje")).toBe("economico");
  });

  it("pedido longo com 'resumo' e várias etapas não vai ao econômico", () => {
    expect(tierOf("resume a conversa com o João, depois cria o grupo Projeto Italo e manda o link pra ele no privado")).toBe("principal");
    expect(tierOf("primeiro resume as últimas mensagens do grupo e em seguida me manda um plano de ação para o cliente")).toBe("principal");
  });

  it("cumprimento curto continua no econômico", () => {
    expect(tierOf("oi")).toBe("economico");
    expect(tierOf("ok, valeu")).toBe("economico");
  });

  it("pergunta de consulta e pedido de ação nunca vão ao econômico", () => {
    expect(tierOf("quanto gastei em anúncio essa semana?")).toBe("principal");
    expect(tierOf("manda uma mensagem pro João pedindo o PDF")).toBe("principal");
  });
});
