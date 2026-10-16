// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { WorkOverview, CapacityOverview } from "../src/features/collaboration/WorkOverview";
import { MetricsPanel } from "../src/features/collaboration/MetricsPanel";
import type { CollaborationData, CollaborationTask } from "../src/lib/collaborationApi";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
function host() { const node = document.createElement("div"); document.body.append(node); root = createRoot(node); return node; }
function task(id: number, status = "pending", title = "Tarefa " + id) {
  return { id, title, workflow_status: status, committed_due_at: "2026-10-15T12:00:00Z", responsible_person_id: "person" } as CollaborationTask;
}
function fixture(): CollaborationData {
  return { generatedAt: "2026-10-16T12:00:00Z", identity: { personId: "person", accessVersion: "scope-1" },
    tasks: [], people: [{ id: "person", name: "Ana" }], plans: [], planItems: [], baselines: [], load: [], metrics: [], metricCatalog: [], externalMetrics: [], departmentMetrics: [] } as unknown as CollaborationData;
}
function button(node: HTMLElement, label: string) { return [...node.querySelectorAll<HTMLButtonElement>("button.work-indicator")].find(row => row.textContent?.includes(label))!; }
describe("indicadores vinculados ao recorte atual", () => {
  it("abre a população e acompanha recarga e remoção de registros sem conservar uma cópia antiga", async () => {
    const node = host(), data = fixture();
    const render = (tasks: CollaborationTask[]) => createElement(WorkOverview, { data, tasks, mode: "day", renderRecords: rows => rows.map(row => createElement("p", { key: row.id }, row.title)) });
    await act(async () => root!.render(render([task(1, "pending", "Registro anterior")])));
    await act(async () => button(node, "Prazos vencidos").click());
    expect(node.textContent).toContain("Registro anterior");
    await act(async () => root!.render(render([task(2, "pending", "Registro atual")])));
    expect(node.textContent).not.toContain("Registro anterior"); expect(node.textContent).toContain("Registro atual");
    await act(async () => root!.render(render([])));
    expect(node.textContent).not.toContain("Registro atual");
  });
  it("não usa baseline de outra equipe nem de outra semana e exclui urgências antigas", () => {
    const data = fixture();
    data.plans = [{ id: "other", team_id: "other-team", period_kind: "weekly", period_start: "2026-10-12", period_end: "2026-10-18" }];
    data.baselines = [{ plan_id: "other", task_snapshots: [{ id: 1, priority: 1, committed_due_at: null }] }];
    const props = { data, tasks: [task(1, "completed"), { ...task(2), added_after_baseline: true }], mode: "team" as const, teamId: "team", renderRecords: () => null };
    let html = renderToStaticMarkup(createElement(WorkOverview, props));
    expect(html).toContain("Nenhuma baseline semanal disponível"); expect(html).not.toContain("<progress");
    data.plans.push({ id: "current", team_id: "team", period_kind: "weekly", period_start: "2026-10-12", period_end: "2026-10-18" });
    data.baselines.push({ plan_id: "current", task_snapshots: [{ id: 1, priority: 1, committed_due_at: null }] });
    data.planItems = [{ plan_id: "old-week", work_task_id: 2, added_after_baseline: true }];
    html = renderToStaticMarkup(createElement(WorkOverview, props));
    expect(html).toContain("1 de 1 compromissos da baseline concluídos (100%)");
    expect(html).toContain('value="1"');
    expect(html).toMatch(/Acrescentados após baseline[\s\S]*?<strong>0<\/strong>/);
  });
  it("mantém utilização acima de 100% explícita e não desenha capacidade sem denominador", () => {
    const data = fixture();
    data.load = [{ personId: "person", assigned: 3, estimatedHours: 12, availableHours: 8, utilization: 150, unavailableReason: null }];
    let html = renderToStaticMarkup(createElement(CapacityOverview, { data }));
    expect(html).toContain("150%"); expect(html).toContain("acima da disponibilidade informada"); expect(html).toContain('max="8" value="8"');
    data.load[0] = { ...data.load[0], estimatedHours: null, utilization: null, unavailableReason: "Há compromissos sem esforço estimado." };
    html = renderToStaticMarkup(createElement(CapacityOverview, { data }));
    expect(html).not.toContain("<progress"); expect(html).toContain("Há compromissos sem esforço estimado.");
  });
  it("detalhe de KPI relê a população após mudança de escopo e zero continua disponível", async () => {
    const node = host(), data = fixture();
    data.tasks = [task(1, "in_progress", "Contexto anterior")];
    data.metrics = [{ code: "individual.open_wip", label: "Trabalho em andamento", value: 1, unit: "itens", available: true, unavailableReason: null, recordIds: [1] }];
    await act(async () => root!.render(createElement(MetricsPanel, { data })));
    await act(async () => button(node, "Trabalho em andamento").click()); expect(node.textContent).toContain("Contexto anterior");
    const next = { ...data, tasks: [], metrics: [{ ...data.metrics[0], value: 0, recordIds: [] }] };
    await act(async () => root!.render(createElement(MetricsPanel, { data: next })));
    expect(node.textContent).not.toContain("Contexto anterior"); expect(node.textContent).toContain("Nenhum registro nesta população");
    expect(button(node, "Trabalho em andamento").querySelector("strong")?.textContent).toBe("0");
    await act(async () => root!.render(createElement(MetricsPanel, { data: { ...next, metrics: [] } })));
    expect(node.textContent).not.toContain("registros do cálculo");
  });
});
