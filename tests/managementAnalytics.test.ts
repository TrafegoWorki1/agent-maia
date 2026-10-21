import {describe,it,expect} from "vitest";
import {buildManagementAnalytics,defaultAnalyticsFilters} from "../src/lib/managementAnalytics";
import type {CollaborationData,CollaborationTask} from "../src/lib/collaborationApi";
const now=new Date("2026-10-20T15:00:00Z"),filters=defaultAnalyticsFilters(now);
const task=(id:number,extra:Partial<CollaborationTask>={})=>({id,workflow_status:"pending",priority:2,committed_due_at:"2026-10-20T14:00:00Z",estimated_effort_hours:null,...extra} as CollaborationTask);
const data=(tasks:CollaborationTask[]=[])=>({tasks,plans:[],baselines:[],people:[],capacity:[],projects:[]} as unknown as CollaborationData);
const metric=(value:ReturnType<typeof buildManagementAnalytics>,code:string)=>value.metrics.find(m=>m.code===code)!;
describe("Indicadores gerenciais reproduzíveis",()=>{
 it("seleciona a semana em Brasília mesmo na virada UTC",()=>{expect(defaultAnalyticsFilters(new Date("2026-10-19T01:00:00Z"))).toMatchObject({start:"2026-10-12",end:"2026-10-18"});});
 it("não inventa pontualidade sem denominador",()=>expect(metric(buildManagementAnalytics(data(),filters,now),"on_time").value).toBeNull());
 it("usa o prazo original da baseline e exclui cancelados e concluídos sem data da taxa",()=>{
 const d=data([task(1,{workflow_status:"completed",completed_at:"2026-10-20T14:30:00Z",committed_due_at:"2026-10-20T16:00:00Z"}),task(2),task(3,{workflow_status:"cancelled"}),task(4,{workflow_status:"completed",completed_at:null}),task(5,{committed_due_at:"2026-10-21T15:00:00Z"})]);
 d.plans=[{id:"plan",period_kind:"weekly",period_start:"2026-10-19",period_end:"2026-10-25"}];d.baselines=[{plan_id:"plan",task_snapshots:[{id:1,priority:2,committed_due_at:"2026-10-20T14:00:00Z"}]}];
 const a=buildManagementAnalytics(d,filters,now);
 expect(metric(a,"commitments").ids).toEqual([1,2,3,4,5]);expect(metric(a,"on_time")).toMatchObject({value:0,ids:[1,2]});expect(a.cancelled).toBe(1);expect(a.planChart.reduce((s,r)=>s+(r.secondary??0),0)).toBe(0);
 });
 it("não mistura cliente filtrado ou converte tarefas em capacidade",()=>{
 const d=data([task(1,{client_ref_id:"a",responsible_person_id:"p",estimated_effort_hours:3}),task(2,{client_ref_id:"b"})]);
 d.capacity=[{person_id:"p",week_start:"2026-10-19",available_hours:40,absence_hours:8}];
 let a=buildManagementAnalytics(d,{...filters,client:"a"},now);expect(a.tasks.map(t=>t.id)).toEqual([1]);expect(metric(a,"capacity").value).toBeNull();expect(a.loadChart).toEqual([]);
 a=buildManagementAnalytics(d,filters,now);expect(metric(a,"capacity").value).toBe(32);expect(a.loadChart.find(r=>r.key==="p")).toMatchObject({primary:3,secondary:32});
 });
 it("identifica capacidade desconhecida e estimativas ausentes",()=>{const a=buildManagementAnalytics(data([task(1,{responsible_person_id:"p"})]),filters,now);expect(a.loadChart[0]).toMatchObject({primary:0,missingEstimates:1});expect(a.loadChart[0].secondary).toBeUndefined();});
 it("conta acréscimos pela semana selecionada em vez da marca da semana atual",()=>{
 const d=data([task(1,{added_after_baseline:true}),task(2,{added_after_baseline:false})]);d.plans=[{id:"selected",period_kind:"weekly",period_start:"2026-10-19",period_end:"2026-10-25"},{id:"old",period_kind:"weekly",period_start:"2026-10-05",period_end:"2026-10-11"}];d.planItems=[{plan_id:"old",work_task_id:1,added_after_baseline:true},{plan_id:"selected",work_task_id:2,added_after_baseline:true}];expect(buildManagementAnalytics(d,filters,now).addedAfterBaseline).toBe(1);
 });
 it("mantém estado atual separado do período e oferece os mesmos IDs",()=>{const a=buildManagementAnalytics(data([task(1,{workflow_status:"blocked",committed_due_at:"2026-09-01T15:00:00Z"}),task(2,{workflow_status:"review"})]),filters,now);expect(metric(a,"commitments").ids).toEqual([2]);expect(metric(a,"blocked").ids).toEqual([1]);expect(metric(a,"overdue").ids).toEqual([1,2]);expect(new Set(a.exceptions.map(t=>t.id))).toEqual(new Set([1,2]));});
 it("rejeita datas inexistentes e informa mediana com amostra",()=>{
 const d=data([task(1,{workflow_status:"completed",started_at:"2026-10-18T15:00:00Z",completed_at:"2026-10-20T15:00:00Z"}),task(2,{workflow_status:"completed",started_at:"2026-10-16T15:00:00Z",completed_at:"2026-10-20T15:00:00Z"})]);
 expect(buildManagementAnalytics(d,{...filters,start:"2026-02-30"},now).valid).toBe(false);
 expect(buildManagementAnalytics(d,filters,now)).toMatchObject({cycleMedianDays:3,cycleSample:2,cycleP85Days:null});
 });
});
