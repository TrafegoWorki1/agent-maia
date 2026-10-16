// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PlanningPanel} from "../src/features/collaboration/PlanningPanel";
import {CollaborationPage} from "../src/features/collaboration/CollaborationPage";
import {stateHours} from "../src/features/collaboration/TaskDetailPanel";
import {CollaborationApiError,fetchCollaboration,mutateCollaboration,type CollaborationData} from "../src/lib/collaborationApi";
vi.mock("../src/lib/supabaseBrowser",()=>({supabase:null}));
vi.mock("../src/lib/collaborationApi",async importOriginal=>({...await importOriginal<typeof import("../src/lib/collaborationApi")>(),fetchCollaboration:vi.fn(),mutateCollaboration:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root|undefined;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(mutateCollaboration).mockResolvedValue({id:"plan"});});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());document.body.innerHTML="";root=undefined;});
function fixture(title="Tarefa atual"){
 const task={id:1,title,responsible_person_id:"person",responsible_team_id:"team",workflow_status:"pending",priority:2,revision:1,committed_due_at:null,allowedActions:{update:true,review:false,approve:false,reassign:false,prioritize:false}};
 return {generatedAt:"2026-10-16T12:00:00Z",staleAfterMs:45000,identity:{personId:"person",owner:false,teams:[],roles:[],permissions:[],screens:["meu-dia"]},planningTeamIds:["team"],portfolioClientIds:[],baselines:[],portfolioHistory:[],tasks:[task],people:[{id:"person",name:"Ana",active:true}],teams:[{id:"team",name:"Criação",active:true}],teamMembers:[{team_id:"team",person_id:"person",active:true}],clients:[],contracts:[],projects:[],deliverables:[],dependencies:[],artifacts:[],history:[],reviews:[],plans:[{id:"plan",team_id:"team",period_kind:"weekly",period_start:"2026-10-12",period_end:"2026-10-18",objective:"Plano real",revision:3,status:"baselined",baseline_at:"2026-10-12T12:00:00Z"}],planItems:[{plan_id:"plan",work_task_id:1}],planChanges:[],capacity:[],load:[],metricCatalog:[],metrics:[],externalMetrics:[],dashboards:{myDay:{priorities:[task],dueSoon:[],blocked:[],reviews:[],approvals:[]},team:{tasks:[task],blocked:[]},coordination:{deadlineRisks:[],reviewQueue:[],approvalQueue:[],unplanned:[]},direction:null}} as unknown as CollaborationData;
}
function mount(){const host=document.createElement("div");document.body.append(host);root=createRoot(host);return host;}
describe("planejamento e sincronização da interface",()=>{
 it("editar plano preserva revisão e permite remover todos os compromissos com motivo",async()=>{
  const data=fixture(),reload=vi.fn().mockResolvedValue(undefined),host=mount();
  await act(async()=>root!.render(createElement(PlanningPanel,{data,reload})));
  await act(async()=>{[...host.querySelectorAll("button")].find(button=>button.textContent==="Editar plano")!.click();});
  expect((host.querySelector('input[type="date"]') as HTMLInputElement).disabled).toBe(true);
  await act(async()=>{(host.querySelector('fieldset input[type="checkbox"]') as HTMLInputElement).click();});
  const reason=[...host.querySelectorAll("label")].find(label=>label.textContent?.includes("Motivo e compromissos"))!.querySelector("textarea")!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(reason,"Urgência mudou o compromisso assumido");reason.dispatchEvent(new Event("input",{bubbles:true}));});
  const button=[...host.querySelectorAll("button")].find(button=>button.textContent==="Salvar plano")!;
  expect(button.disabled).toBe(false);
  await act(async()=>button.click());
  expect(mutateCollaboration).toHaveBeenCalledWith(expect.objectContaining({id:"plan",revision:3,taskIds:[],reason:"Urgência mudou o compromisso assumido"}));
  expect(reload).toHaveBeenCalled();
 });
 it("resposta antiga não substitui a reconexão e acesso revogado limpa a tarefa",async()=>{
  let finish!:(value:CollaborationData)=>void;
  vi.mocked(fetchCollaboration).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce(fixture("Leitura mais recente"));
  const host=mount();await act(async()=>root!.render(createElement(CollaborationPage,{mode:"meu-dia"})));
  await act(async()=>window.dispatchEvent(new Event("online")));
  expect(host.textContent).toContain("Leitura mais recente");
  await act(async()=>finish(fixture("Leitura antiga")));
  expect(host.textContent).not.toContain("Leitura antiga");
  vi.mocked(fetchCollaboration).mockRejectedValueOnce(new CollaborationApiError("Acesso revogado",403));
  await act(async()=>window.dispatchEvent(new Event("online")));
  expect(host.textContent).toContain("Acesso revogado");
  expect(host.textContent).not.toContain("Leitura mais recente");
 });
 it("espera por cliente é separada do tempo em execução",()=>{
  const totals=stateHours([{at:"2026-10-16T10:00:00Z",to_value:{workflow_status:"in_progress"}},{at:"2026-10-16T11:00:00Z",to_value:{workflow_status:"blocked",waiting_kind:"client"}}],new Date("2026-10-16T14:00:00Z"));
  expect(totals.in_progress).toBe(1);expect(totals.client).toBe(3);expect(totals.team).toBe(0);
 });
});
