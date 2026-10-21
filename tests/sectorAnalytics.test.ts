import {describe,it,expect} from "vitest";
import type {CollaborationData,CollaborationTask,DepartmentRecord} from "../src/lib/collaborationApi";
import {buildSectorAnalytics,buildRelationshipAnalytics,filterPortfolio} from "../src/lib/sectorAnalytics";
import {defaultAnalyticsFilters} from "../src/lib/managementAnalytics";
const now=new Date("2026-10-20T15:00:00Z"),f={...defaultAnalyticsFilters(now),start:"2026-10-05",end:"2026-10-25"};
const task=(id:number,extra:Partial<CollaborationTask>={})=>({id,workflow_status:"in_progress",priority:2,started_at:null,completed_at:null,...extra} as CollaborationTask);
const data=(tasks:CollaborationTask[]=[])=>({generatedAt:now.toISOString(),tasks,reviews:[],departmentHistory:[],projects:[],deliverables:[],clients:[],contracts:[]} as unknown as CollaborationData);
describe("Fluxo e resultados gerenciais",()=>{
 it("agrupa conclusões pela data de Brasília, inclui semanas vazias e respeita o intervalo parcial",()=>{
  const d=data([task(1,{workflow_status:"completed",completed_at:"2026-10-12T01:00:00Z"}),task(2,{workflow_status:"completed",completed_at:"2026-10-19T03:00:00Z"}),task(3,{workflow_status:"completed",completed_at:"2026-10-01T12:00:00Z"})]);
  const a=buildSectorAnalytics(d,f);expect(a.throughput.map(r=>[r.key,r.primary])).toEqual([["2026-10-05",1],["2026-10-12",0],["2026-10-19",1]]);expect(a.throughput[0].ids).toEqual([1]);
 });
 it("idade não usa updated_at e não converte início ausente em zero",()=>{
  const d=data([task(1,{started_at:"2026-10-13T15:00:00Z"}),task(2,{updated_at:"2026-09-01T12:00:00Z"}),task(3,{started_at:"2026-09-01T12:00:00Z",workflow_status:"completed"})]);
  const a=buildSectorAnalytics(d,f);expect(a.unknownStart).toBe(1);expect(a.aging[1]).toMatchObject({primary:1,ids:[1]});expect(a.aging.reduce((s,r)=>s+r.primary,0)).toBe(1);
 });
 it("composição e devoluções abrem a mesma população autorizada e filtrada",()=>{
  const d=data([task(1,{client_ref_id:"a",area:"design"}),task(2,{client_ref_id:"b",area:"design"})]);d.reviews=[{work_task_id:1,outcome:"returned",return_reason:"quality",created_at:"2026-10-19T12:00:00Z"},{work_task_id:1,outcome:"returned",return_reason:"quality",created_at:"2026-10-20T12:00:00Z"},{work_task_id:2,outcome:"returned",return_reason:"error",created_at:"2026-10-19T12:00:00Z"}];
  const a=buildSectorAnalytics(d,{...f,client:"a"});expect(a.returns).toMatchObject([{primary:2,ids:[1]}]);expect(a.composition[0].segments?.find(s=>s.label==="Em execução")).toMatchObject({value:1,ids:[1]});
 });
 it("pontualidade dos entregáveis exclui cancelados, futuros e conclusões sem data do denominador",()=>{
  const d=data();d.projects=[{id:"p",client_id:"a",name:"Projeto"}];d.deliverables=[{id:"1",project_id:"p",status:"completed",due_at:"2026-10-19T15:00:00Z",completed_at:"2026-10-19T14:00:00Z"},{id:"2",project_id:"p",status:"pending",due_at:"2026-10-19T15:00:00Z"},{id:"3",project_id:"p",status:"cancelled",due_at:"2026-10-19T15:00:00Z"},{id:"4",project_id:"p",status:"completed",due_at:"2026-10-19T15:00:00Z"},{id:"5",project_id:"p",status:"pending",due_at:"2026-10-25T15:00:00Z"}];
  expect(buildSectorAnalytics(d,f)).toMatchObject({measurableMilestones:2,onTimeMilestones:50,projectPlan:[{primary:5,secondary:1}]});
 });
 it("um filtro de pessoa limita carteira e entregáveis pelos vínculos reais",()=>{
  const d=data([task(1,{responsible_person_id:"ana",project_ref_id:"p1",deliverable_id:"d1"}),task(2,{responsible_person_id:"bia",project_ref_id:"p2",deliverable_id:"d2"})]);d.projects=[{id:"p1"},{id:"p2"}];d.deliverables=[{id:"d1",project_id:"p1"},{id:"d2",project_id:"p2"}];
  const v=filterPortfolio(d,{...f,person:"ana"});expect(v.projects.map(p=>p.id)).toEqual(["p1"]);expect(v.deliverables.map(p=>p.id)).toEqual(["d1"]);
 });
 it("não usa updated_at como data de ganho e respeita histórico, fuso e permissão de métricas",()=>{
  const d=data(),records=[{id:"r1",kind:"opportunity",status:"won",updated_at:"2026-10-19T12:00:00Z",canViewMetrics:true},{id:"r2",kind:"opportunity",status:"lost",canViewMetrics:true},{id:"private",kind:"opportunity",status:"won",canViewMetrics:false}] as DepartmentRecord[];
  d.departmentHistory=[{id:1,entity_id:"r1",entity_kind:"opportunity",at:"2026-10-19T01:00:00Z",prior_value:{status:"negotiation"},new_value:{status:"won"}},{id:2,entity_id:"r1",entity_kind:"opportunity",at:"2026-10-19T02:00:00Z",prior_value:{status:"won"},new_value:{status:"won"}},{id:3,entity_id:"private",entity_kind:"opportunity",at:"2026-10-19T12:00:00Z",new_value:{status:"won"}}];
  const a=buildRelationshipAnalytics(d,records,f,"opportunity");expect(a).toMatchObject({won:1,lost:0,winRate:100,trend:[{key:"2026-10-12",primary:1,secondary:0,recordIds:["r1"]}]});expect(a.events).toHaveLength(1);
  expect(buildRelationshipAnalytics({...d,departmentHistory:[]},records,f,"opportunity").winRate).toBeNull();
 });
});
