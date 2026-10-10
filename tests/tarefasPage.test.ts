// @vitest-environment jsdom
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";
import { TarefasPage } from "../src/features/operacao/TarefasPage";
import { workspaceRequest } from "../src/lib/workspaceApi";

vi.mock("../src/lib/workspaceApi", () => ({ workspaceRequest:vi.fn() }));
Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); document.body.innerHTML=""; root=undefined; });
describe("painel de tarefas e revisão humana", () => {
  it("mostra atraso, falha/incerteza e ausência de nota sem simular eficácia", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue({ work:{ limit:200,tasks:[{ id:1,title:"Entregar planejamento",responsible:"Herickson",status:"pendente",due_at:"2026-10-09T12:00:00Z",revision:1,completion_evidence:null,overdue:true }],reminders:[{ id:1,work_task_id:1,run_at:"2026-10-09T12:00:00Z",status:"uncertain",kind:"prazo",message_id:null,error:"tempo limite" }] },effectiveness:{ sample:0,targetSample:20,sufficient:false,relevance:null,resolution:null,partial:0,candidates:[],reviews:[],deliveries:[],sampleScope:"Últimos 7 dias" } });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.textContent).toContain("Pendente · Atrasada");
    expect(host.textContent).toContain("Incerto · não repetido");
    expect(host.textContent).toContain("Relevância: Sem avaliação");
    expect(host.textContent).toContain("0/20 pedidos avaliados");
    const edit=[...host.querySelectorAll("button")].find((b)=>b.textContent==="Editar")!;
    await act(async () => edit.click());
    expect(host.textContent).toContain("Editar tarefa #1");
    const statuses=[...host.querySelectorAll("select option")].map(o=>o.textContent);
    expect(statuses).toContain("Concluída");
  });
  it("erro de permissão aparece como alerta, não dados fictícios", async () => {
    vi.mocked(workspaceRequest).mockRejectedValue(new Error("owner_only"));
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("owner_only");
  });
});
