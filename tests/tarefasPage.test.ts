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
  it("encaminha trabalho à Central e preserva falha/incerteza e eficácia técnica", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue({ work:{ limit:200,tasks:[{ id:1,title:"Entregar planejamento",responsible:"Herickson",status:"pendente",due_at:"2026-10-09T12:00:00Z",revision:1,completion_evidence:null,overdue:true,tipo:null }],reminders:[{ id:1,work_task_id:1,run_at:"2026-10-09T12:00:00Z",status:"uncertain",kind:"prazo",message_id:null,error:"tempo limite" }] },effectiveness:{ sample:0,targetSample:20,sufficient:false,relevance:null,resolution:null,partial:0,candidates:[],reviews:[],deliveries:[],sampleScope:"Últimos 7 dias" },memories:[],receipts:[{messageId:"wamid-test",destination:"Contato: Bárbara",status:"read",updatedAt:"2026-10-14T18:00:00Z"}],creativeJobs:[{id:7,title:"Stories Worki",status:"running",created_at:"2026-10-15T12:00:00Z",updated_at:"2026-10-15T12:03:00Z",source_task_id:6,items:[{seq:1,format:"story",status:"ready_for_review",artifact_name:"story.png",error:null},{seq:2,format:"story",status:"queued",artifact_name:null,error:null}]}] });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.querySelector('a[href="#trabalho/minha-equipe"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Entregar planejamento");
    expect(host.textContent).toContain("Incerto · não repetido");
    expect(host.textContent).toContain("Relevância: Sem avaliação");
    expect(host.textContent).toContain("0/20 pedidos avaliados");
    expect(host.textContent).toContain("Lida");
    expect(host.textContent).toContain("Contato: Bárbara");
    expect(host.textContent).toContain("wamid-test");
    expect(host.textContent).toContain("Trabalhos criativos retomáveis");
    expect(host.textContent).toContain("#1 (story): Enviado para revisão");
    expect(host.textContent).toContain("#2 (story): Na fila");
    expect([...host.querySelectorAll("button")].some(button=>button.textContent==="Editar")).toBe(false);
    expect(host.textContent).not.toContain("Editar tarefa #1");
  });
  it("erro de permissão aparece como alerta, não dados fictícios", async () => {
    vi.mocked(workspaceRequest).mockRejectedValue(new Error("owner_only"));
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("owner_only");
  });
});
