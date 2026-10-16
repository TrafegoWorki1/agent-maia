// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {DepartmentWorkspace,departmentTasks} from "../src/features/departments/DepartmentWorkspace";
import {fetchCollaboration,mutateCollaboration,CollaborationApiError,type CollaborationData} from "../src/lib/collaborationApi";
import {calculateDepartmentMetrics} from "../src/lib/departmentMetrics";

vi.mock("../src/lib/supabaseBrowser",()=>({supabase:null}));
vi.mock("../src/lib/collaborationApi",async original=>({...await original<typeof import("../src/lib/collaborationApi")>(),fetchCollaboration:vi.fn(),mutateCollaboration:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root|undefined;
beforeEach(()=>vi.clearAllMocks());
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML="";});
function fixture(){
 const task={id:42,title:"Arte do projeto real",area:"marketing",client_ref_id:"client",project_ref_id:"project",responsible_person_id:"person",workflow_status:"pending",priority:2,revision:4,committed_due_at:null,allowedActions:{update:false,review:false,approve:false,reassign:false,prioritize:false}};
 const record={id:"record",kind:"cs",client_id:"client",project_id:"project",work_task_id:42,responsible_person_id:"person",title:"Retorno real de CS",status:"pending",details:"Briefing real",next_action:"Pedir revisão",next_action_at:null,canUpdate:true,canConvert:false,revision:7,created_at:"2026-10-16T12:00:00Z",origin:"whatsapp"};
 return {generatedAt:"2026-10-16T12:00:00Z",identity:{owner:false,name:"Ana",personId:"person",accessVersion:"scope-a",permissions:[],screens:[],teams:[],roles:[]},tasks:[task],people:[{id:"person",name:"Ana",active:true}],clients:[{id:"client",name:"Cliente real",active:true}],teams:[],teamMembers:[],contracts:[],projects:[{id:"project",client_id:"client",name:"Projeto real",status:"active",revision:3,canManage:false}],deliverables:[{id:"delivery",project_id:"project",title:"Entregável real",status:"pending",revision:2}],portfolioClientIds:[],portfolioHistory:[],departmentRecords:[record],departmentHistory:[],departmentMetrics:[],externalMetrics:[],history:[],reviews:[],artifacts:[],dependencies:[],load:[],plans:[],baselines:[],planChanges:[],planItems:[],capacity:[],metrics:[],metricCatalog:[]} as unknown as CollaborationData;
}
function host(){const node=document.createElement("div");document.body.append(node);root=createRoot(node);return node;}
describe("áreas são visões da Central",()=>{
 it("funil abre colunas reais sem alterar a taxa de ganho ao filtrar uma etapa",async()=>{
  const data=fixture();
  data.departmentRecords=[{...data.departmentRecords![0],id:"won",kind:"opportunity",title:"Ganha real",status:"won",canViewMetrics:true},{...data.departmentRecords![0],id:"lost",kind:"opportunity",title:"Perdida real",status:"lost",canViewMetrics:true}];
  data.departmentMetrics=calculateDepartmentMetrics(data.departmentRecords,data.generatedAt);
  vi.mocked(fetchCollaboration).mockResolvedValue(data);const node=host();
  await act(async()=>root!.render(createElement(DepartmentWorkspace,{mode:"funnel"})));
  expect(node.querySelector('[aria-label="Oportunidades por etapa"]')?.querySelectorAll(".work-opportunity-card")).toHaveLength(2);
  const rate=()=>[...node.querySelectorAll("button.work-indicator")].find(button=>button.textContent?.includes("Ganho entre oportunidades encerradas"))!;
  expect(rate().querySelector("strong")?.textContent).toBe("50");
  await act(async()=>[...node.querySelectorAll("button")].find(button=>button.textContent==="Ganha / projeto (1)")!.click());
  expect(node.querySelector('[aria-label="Oportunidades por etapa"]')?.querySelectorAll(".work-opportunity-card")).toHaveLength(1);
  expect(rate().querySelector("strong")?.textContent).toBe("50");
  await act(async()=>(rate() as HTMLButtonElement).click());
  expect(node.querySelector(".work-indicator-detail")?.textContent).toContain("Perdida real");
 });
 it("Projetos consulta a carteira real e abre o mesmo ID de tarefa",async()=>{
  vi.mocked(fetchCollaboration).mockResolvedValue(fixture());const node=host();
  await act(async()=>root!.render(createElement(DepartmentWorkspace,{mode:"projects"})));
  expect(node.textContent).toContain("Projeto real");expect(node.textContent).toContain("#42 · Arte do projeto real");
  expect(node.textContent).not.toContain("Nenhum projeto cadastrado ainda");
  await act(async()=>[...node.querySelectorAll("button")].find(button=>button.textContent?.includes("#42 ·"))!.click());
  expect(node.textContent).toContain("Arte do projeto real");
  expect(node.textContent).toContain("Critérios");
 });
 it("Implementações mostra os entregáveis persistidos e Marketing usa a mesma tarefa",async()=>{
  const data=fixture();vi.mocked(fetchCollaboration).mockResolvedValue(data);const node=host();
  await act(async()=>root!.render(createElement(DepartmentWorkspace,{mode:"implementations"})));
  expect(node.textContent).toContain("Entregável real");
  expect(departmentTasks(data,"marketing").map(task=>task.id)).toEqual([42]);
  expect(departmentTasks({...data,tasks:[{...data.tasks[0],area:"financeiro"}]},"marketing")).toEqual([]);
 });
 it("CS edita com a revisão capturada e recarrega a base compartilhada",async()=>{
  vi.mocked(fetchCollaboration).mockResolvedValue(fixture());vi.mocked(mutateCollaboration).mockResolvedValue({id:"record",revision:8});const node=host();
  await act(async()=>root!.render(createElement(DepartmentWorkspace,{mode:"cs"})));
  await act(async()=>[...node.querySelectorAll("button")].find(button=>button.textContent==="Editar registro")!.click());
  const reason=[...node.querySelectorAll("label")].find(label=>label.textContent?.includes("Motivo da alteração"))!.querySelector("textarea")!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(reason,"Atualização confirmada pelo cliente");reason.dispatchEvent(new Event("input",{bubbles:true}));});
  await act(async()=>{node.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
  expect(mutateCollaboration).toHaveBeenCalledWith(expect.objectContaining({action:"department_save",kind:"cs",id:"record",revision:7,reason:"Atualização confirmada pelo cliente"}));
  expect(fetchCollaboration).toHaveBeenCalledTimes(2);
 });
 it("revogação durante a sessão remove registros e formulário",async()=>{
  vi.mocked(fetchCollaboration).mockResolvedValueOnce(fixture());const node=host();
  await act(async()=>root!.render(createElement(DepartmentWorkspace,{mode:"cs"})));
  await act(async()=>[...node.querySelectorAll("button")].find(button=>button.textContent==="Editar registro")!.click());
  vi.mocked(fetchCollaboration).mockRejectedValueOnce(new CollaborationApiError("Acesso revogado",403));
  await act(async()=>window.dispatchEvent(new Event("online")));
  expect(node.textContent).toContain("Acesso revogado");expect(node.textContent).not.toContain("Retorno real de CS");expect(node.querySelector("form")).toBeNull();
 });
 it("ganho não inventa denominador e métricas conferem com os IDs completos",()=>{
  const records=Array.from({length:1005},(_,index)=>({id:String(index),kind:"opportunity" as const,status:index===1004?"lost":"won",next_action_at:null,canViewMetrics:true}));
  const metrics=calculateDepartmentMetrics(records,"2026-10-16T12:00:00Z");
  expect(metrics.find(metric=>metric.code==="commercial.win_rate")).toMatchObject({value:99.9,recordIds:records.map(record=>record.id)});
  expect(calculateDepartmentMetrics([],"2026-10-16T12:00:00Z").find(metric=>metric.code==="commercial.win_rate")).toMatchObject({value:null,recordIds:[]});
  expect(calculateDepartmentMetrics([{id:"private",kind:"cs",status:"pending",next_action_at:null,canViewMetrics:false}],"2026-10-16T12:00:00Z").find(metric=>metric.code==="cs.open")?.recordIds).toEqual([]);
 });
});
