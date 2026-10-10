import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingApprovals, readSnapshots, recentTasks, tasksBetween, type Db } from "../server/store.ts";
import { operationalSummary } from "../server/operationalSummary.ts";

vi.mock("../server/store.ts", () => ({ pendingApprovals: vi.fn(), readSnapshots: vi.fn(), recentTasks: vi.fn(), tasksBetween: vi.fn() }));

describe("consulta operacional compartilhada pelos modelos", () => {
  const db = {} as Db;
  const now = new Date("2026-10-10T03:35:00Z");
  beforeEach(() => {
    vi.mocked(tasksBetween).mockResolvedValue([]);
    vi.mocked(recentTasks).mockResolvedValue([]);
    vi.mocked(pendingApprovals).mockResolvedValue([]);
    vi.mocked(readSnapshots).mockResolvedValue([]);
  });

  it("informa ausência de dados e não promete prazos ou lembretes inexistentes", async () => {
    const result = await operationalSummary(db, now);
    expect(result.registrosDeExecucao.total).toBe(0);
    expect(result.tarefasComPrazo).toBe(false);
    expect(result.lembretesDeTarefa).toBe(false);
    expect(tasksBetween).toHaveBeenCalledWith(db, "2026-10-03T03:35:00.000Z", "2026-10-10T03:35:00.001Z");
  });

  it("não devolve o conteúdo pessoal coletado pelas conexões", async () => {
    vi.mocked(readSnapshots).mockResolvedValue([{ source: "gmail", fetched_at: now.toISOString(), status: "error", data: { textoPrivado: "não retornar" }, error: "erro da fonte" }]);
    const result = await operationalSummary(db, now);
    expect(result.conexoes).toEqual([{ fonte: "gmail", status: "error", coletadoEm: now.toISOString() }]);
    expect(JSON.stringify(result)).not.toContain("não retornar");
  });

  it("falha de consulta não vira resposta com dados vazios de sucesso", async () => {
    vi.mocked(tasksBetween).mockRejectedValueOnce(new Error("banco indisponível"));
    await expect(operationalSummary(db, now)).rejects.toThrow("banco indisponível");
  });
});
