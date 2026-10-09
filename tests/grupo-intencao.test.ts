import { describe, expect, it } from "vitest";
import { parseGroupIntent } from "../server/groups.ts";

const OWNER = "5585992494552";

describe("pedido natural de criar grupo", () => {
  it("entende 'criar grupo Nome e me coloca' e inclui o dono", () => {
    expect(parseGroupIntent("criar grupo Operacional Worki Digital e me coloca no grupo", OWNER)).toEqual({
      name: "Operacional Worki Digital",
      participants: [OWNER],
    });
  });

  it("entende 'criar grupo Nome com você'", () => {
    expect(parseGroupIntent("criar grupo Teste com você", OWNER)).toEqual({ name: "Teste", participants: [OWNER] });
  });

  it("sem o dono na frase, devolve o nome e nenhum participante", () => {
    expect(parseGroupIntent("criar grupo Operacional Worki Digital", OWNER)).toEqual({ name: "Operacional Worki Digital", participants: [] });
  });

  it("mantém o formato explícito com números", () => {
    expect(parseGroupIntent("criar grupo Teste | 5585986139044, 5585992494552", OWNER)).toEqual({
      name: "Teste",
      participants: ["5585986139044", "5585992494552"],
    });
  });

  it("não reconhece texto que não é pedido de grupo", () => {
    expect(parseGroupIntent("quero um relatório do grupo", OWNER)).toBeNull();
    expect(parseGroupIntent("criar grupo", OWNER)).toBeNull();
  });
});
