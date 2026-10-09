import { describe, expect, it } from "vitest";
import { groupExists, parseCreateGroup, parseOwnerTask } from "../server/groups.ts";

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

describe("conferência do grupo criado", () => {
  it("acha o grupo ignorando acento, maiúsculas e espaços", () => {
    const groups = [{ subject: "Operacional Worki Digital" }, { subject: "Tráfego" }];
    expect(groupExists(groups, " operacional worki digital ")).toBe(true);
    expect(groupExists(groups, "Trafego")).toBe(true);
  });
  it("não confirma grupo que não está na lista", () => {
    expect(groupExists([{ subject: "Outro" }], "Operacional Worki Digital")).toBe(false);
    expect(groupExists([], "Qualquer")).toBe(false);
  });
});
