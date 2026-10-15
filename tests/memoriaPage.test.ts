// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoriaPage } from "../src/features/operacao/MemoriaPage";
import { workspaceRequest, type WorkspaceData } from "../src/lib/workspaceApi";

vi.mock("../src/lib/workspaceApi", () => ({ workspaceRequest: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); document.body.innerHTML = ""; root = undefined; vi.clearAllMocks(); });

const data: WorkspaceData = {
  work: { tasks: [], reminders: [], limit: 200 },
  effectiveness: { sample: 0, targetSample: 20, sufficient: false, relevance: null, resolution: null, partial: 0, candidates: [], reviews: [], sampleScope: "", deliveries: [] },
  memories: [{ id: 4, created_at: "2026-10-14T12:00:00Z", updated_at: "2026-10-14T12:00:00Z", title: "Enviar proposta", detail: "Revisar antes do envio", kind: "compromisso", status: "active", due_at: null, source_task_id: 18, created_by: "maia", completed_at: null, revision: 1 }],
  receipts: [],
};

describe("painel de memória sincronizada", () => {
  it("exibe origem e conclui o mesmo registro com revisão concorrente", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(data);
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root!.render(createElement(MemoriaPage)));
    expect(host.textContent).toContain("Enviar proposta");
    expect(host.textContent).toContain("Maia · tarefa #18");
    const complete = [...host.querySelectorAll("button")].find((button) => button.textContent === "Marcar concluído")!;
    await act(async () => complete.click());
    expect(workspaceRequest).toHaveBeenCalledWith("memory_update", { id: 4, revision: 1, status: "completed" });
  });
});
