import { describe, expect, it, vi } from "vitest";
import { recordActionEvidence } from "../server/actionEvidence.ts";
import type { Db } from "../server/store.ts";

describe("provas das ações do Codex", () => {
  it("registra efeito aceito sem inventar prova quando falta o ID", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = { from: () => ({ insert }) } as unknown as Db;
    await recordActionEvidence(db, 12, "enviar_arte", null, null);
    expect(insert.mock.calls.map(([row]) => row.type)).toEqual(["external_done"]);
  });

  it("guarda a mesma operação e o ID para conferir o resultado", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const db = { from: () => ({ insert }) } as unknown as Db;
    await recordActionEvidence(db, 12, "grupo_enviar_texto", "Operação", "mensagem abc");
    expect(insert.mock.calls.map(([row]) => ({ task: row.task_id, type: row.type, operation: row.operation, detail: row.detail }))).toEqual([
      { task: 12, type: "external_done", operation: "grupo_enviar_texto", detail: "Operação" },
      { task: 12, type: "task_verified", operation: "grupo_enviar_texto", detail: "mensagem abc" },
    ]);
  });

  it("falha de registro não reexecuta nem faz parecer que o envio falhou", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: { message: "banco indisponível" } });
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(recordActionEvidence({ from: () => ({ insert }) } as unknown as Db, 12, "enviar_arte", null, "abc")).resolves.toBeUndefined();
      expect(insert).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
