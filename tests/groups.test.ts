import { describe, expect, it } from "vitest";
import { parseCreateGroup, parseOwnerTask } from "../server/groups.ts";

describe("comandos de grupo do dono", () => {
  it("lê o nome e os participantes de 'criar grupo'", () => {
    expect(parseCreateGroup("criar grupo Operação Julho | 5585998372658, 5585992494552")).toEqual({
      name: "Operação Julho",
      participants: ["5585998372658", "5585992494552"],
    });
  });

  it("ignora 'criar grupo' sem participantes válidos", () => {
    expect(parseCreateGroup("criar grupo Sem gente |")).toBeNull();
    expect(parseCreateGroup("criar grupo Nome | 123")).toBeNull();
  });

  it("lê tarefa com e sem grupo", () => {
    expect(parseOwnerTask("tarefa Revisar campanha grupo Tráfego pago")).toEqual({ title: "Revisar campanha", groupName: "Tráfego pago" });
    expect(parseOwnerTask("tarefa Ligar para fornecedor")).toEqual({ title: "Ligar para fornecedor", groupName: null });
  });

  it("não reconhece texto comum como comando", () => {
    expect(parseCreateGroup("oi, tudo bem?")).toBeNull();
    expect(parseOwnerTask("oi, tudo bem?")).toBeNull();
  });
});
