// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ManagementPage} from "../src/features/management/ManagementPage";
import type {CollaborationData} from "../src/lib/collaborationApi";
const state=vi.hoisted(()=>({data:null as CollaborationData|null}));
vi.mock("../src/features/collaboration/CollaborationPage",()=>({useCollaboration:()=>({data:state.data,error:"",loading:false,stale:false,reload:vi.fn()}),Tasks:({items}:{items:Array<{id:number;title:string}>})=>createElement("div",{"data-testid":"records"},items.map(t=>createElement("span",{key:t.id},t.title)))}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root;
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML="";});
describe("Panorama e detalhamento",()=>{
 it("oferece seis indicadores e abre exatamente as tarefas do grupo",async()=>{
 const now=new Date(),due=new Date(now.getTime()-3600000).toISOString();
 state.data={generatedAt:now.toISOString(),identity:{owner:true},tasks:[{id:1,title:"Trabalho atrasado",workflow_status:"pending",priority:1,committed_due_at:due,estimated_effort_hours:null},{id:2,title:"Trabalho concluído",workflow_status:"completed",priority:2,committed_due_at:due,completed_at:due,estimated_effort_hours:null}],plans:[],baselines:[],capacity:[],people:[],clients:[],teams:[],projects:[]} as unknown as CollaborationData;
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);await act(async()=>root.render(createElement(ManagementPage)));
 expect(node.querySelectorAll(".work-indicator")).toHaveLength(6);
 const button=[...node.querySelectorAll("button")].find(b=>b.textContent?.includes("Entregas atrasadas"))!;
 await act(async()=>button.click());
 const selection=node.querySelector('[data-testid="records"]')!;expect(selection.textContent).toContain("Trabalho atrasado");expect(selection.textContent).not.toContain("Trabalho concluído");
 expect(node.querySelectorAll(".management-chart-grid:first-of-type > .management-chart details table")).toHaveLength(4);
 });
 it("bloqueia o panorama consolidado a membros",async()=>{
 state.data={identity:{owner:false},tasks:[],plans:[],baselines:[],capacity:[],people:[],clients:[],teams:[],projects:[]} as unknown as CollaborationData;
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);await act(async()=>root.render(createElement(ManagementPage)));expect(node.textContent).toContain("exige acesso do proprietário");expect(node.querySelector(".work-indicator")).toBeNull();
 });
});
