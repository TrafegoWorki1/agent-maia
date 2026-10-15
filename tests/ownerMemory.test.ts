import { describe, expect, it } from "vitest";
import { rankOwnerMemories, type OwnerMemory } from "../server/ownerMemory.ts";

const row = (id: number, title: string, detail: string, updated_at = `2026-10-14T12:0${id}:00Z`): OwnerMemory => ({
  id, created_at: updated_at, updated_at, title, detail, kind: "compromisso", status: "active", due_at: null,
  source_task_id: null, created_by: "maia", completed_at: null, revision: 1,
});

describe("busca de memória durável", () => {
  const rows = [row(1, "Enviar proposta", "Revisar a campanha antes do envio"), row(2, "Reunião de equipe", "Confirmar o novo horário"), row(3, "Status proposta", "Proposta enviada, aguardando retorno")];
  it("ranqueia memórias por relevância sem diferenciar acentos ou caixa", () => {
    expect(rankOwnerMemories(rows, "PROPOSTÁ", 2).map((item) => item.id)).toEqual([3, 1]);
  });
  it("retorna só registros relevantes para o termo buscado", () => {
    expect(rankOwnerMemories(rows, "equipe").map((item) => item.id)).toEqual([2]);
  });
  it("sem termos úteis retorna as mais recentes dentro do limite", () => {
    expect(rankOwnerMemories(rows, "a", 1)).toHaveLength(1);
  });
});
