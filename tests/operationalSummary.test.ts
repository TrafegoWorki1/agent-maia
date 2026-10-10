import { beforeEach, describe, expect, it, vi } from "vitest";
import { pendingApprovals, readSnapshots, recentTasks, tasksBetween, type Db } from "../server/store.ts";
import { operationalSummary } from "../server/operationalSummary.ts";
import { workTasksView } from "../server/workTasks.ts";

vi.mock("../server/store.ts", () => ({ pendingApprovals: vi.fn(), readSnapshots: vi.fn(), recentTasks: vi.fn(), tasksBetween: vi.fn() }));
vi.mock("../server/workTasks.ts", () => ({ workTasksView: vi.fn() }));

describe("consulta operacional compartilhada pelos modelos", () => {
  const db = {} as Db;
  const now = new Date("2026-10-10T03:35:00Z");
  beforeEach(() => {
    vi.mocked(tasksBetween).mockResolvedValue([]);
    vi.mocked(recentTasks).mockResolvedValue([]);
    vi.mocked(pendingApprovals).mockResolvedValue([]);
    vi.mocked(readSnapshots).mockResolvedValue([]);
    vi.mocked(workTasksView).mockResolvedValue({ tasks: [], reminders: [], limit: 200 });
  });

  it("distingue trabalho persistido de registros de execução", async () => {
    const result = await operationalSummary(db, now);
    expect(result.registrosDeExecucao.total).toBe(0);
    expect(result.tarefasComPrazo).toBe(true);
    expect(result.lembretesDeTarefa).toBe(true);
    expect(result.trabalho.tasks).toEqual([]);
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
