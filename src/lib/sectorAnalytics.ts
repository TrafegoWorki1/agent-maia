import type {CollaborationData,CollaborationTask,DepartmentRecord} from "./collaborationApi";
import {brtDate,matchingTasks,type AnalyticsFilters,type ChartRow} from "./managementAnalytics";
import {validDay} from "./panelSourceModel";
const day=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))?brtDate(new Date(v)):null;
const open=(t:CollaborationTask)=>!["completed","cancelled"].includes(t.workflow_status);
export function inAnalyticsPeriod(v:unknown,f:Pick<AnalyticsFilters,"start"|"end">){const d=day(v);return validDay(f.start)&&validDay(f.end)&&f.start<=f.end&&!!d&&d>=f.start&&d<=f.end;}
export function weekStart(d:string){const v=new Date(d+"T12:00:00Z");v.setUTCDate(v.getUTCDate()-(v.getUTCDay()+6)%7);return v.toISOString().slice(0,10);}
const labelDay=(d:string)=>d.slice(8)+"/"+d.slice(5,7);
export function filterPortfolio(data:CollaborationData,f:AnalyticsFilters,tasks=matchingTasks(data.tasks,f)):CollaborationData{
 const projects=data.projects.filter(p=>(!f.client||p.client_id===f.client)&&(!f.project||p.id===f.project)&&(!f.team||p.responsible_team_id===f.team||tasks.some(t=>t.project_ref_id===p.id))&&(!f.person||p.responsible_person_id===f.person||tasks.some(t=>t.project_ref_id===p.id))&&(!f.area||tasks.some(t=>t.project_ref_id===p.id)));
 const projectIds=new Set(projects.map(p=>p.id));
 return{...data,projects,clients:data.clients.filter(c=>!f.client||c.id===f.client),contracts:data.contracts.filter(c=>!f.client||c.client_id===f.client),deliverables:data.deliverables.filter(d=>projectIds.has(d.project_id)&&(!f.team&&!f.person&&!f.area||tasks.some(t=>t.deliverable_id===d.id)))};
}
export function buildSectorAnalytics(data:CollaborationData,f:AnalyticsFilters,now=new Date(data.generatedAt)){
 const tasks=matchingTasks(data.tasks,f),ids=(rows:CollaborationTask[])=>rows.map(t=>t.id);
 const completed=tasks.filter(t=>t.workflow_status==="completed"&&inAnalyticsPeriod(t.completed_at,f));
 const weekly=new Map<string,CollaborationTask[]>();
 if(validDay(f.start)&&validDay(f.end)&&f.start<=f.end&&Date.parse(f.end)-Date.parse(f.start)<=366*86400000){
  for(let v=new Date(weekStart(f.start)+"T12:00:00Z");v.toISOString().slice(0,10)<=f.end;v.setUTCDate(v.getUTCDate()+7))weekly.set(v.toISOString().slice(0,10),[]);
 }
 for(const t of completed){const key=weekStart(day(t.completed_at)!);weekly.get(key)?.push(t);}
 const throughput:ChartRow[]=[...weekly].map(([d,rows])=>({key:d,label:labelDay(d),primary:rows.length,ids:ids(rows)}));
 const active=tasks.filter(open),aged=active.map(t=>({task:t,days:t.started_at&&Date.parse(t.started_at)<=now.getTime()?(now.getTime()-Date.parse(t.started_at))/86400000:null})).sort((a,b)=>(b.days??-1)-(a.days??-1));
 const aging:ChartRow[]=[{label:"Menos de 7 dias",min:0,max:7},{label:"7 a menos de 14 dias",min:7,max:14},{label:"14 a menos de 30 dias",min:14,max:30},{label:"30 dias ou mais",min:30,max:Infinity}].map(b=>{const rows=aged.filter(a=>a.days!==null&&a.days>=b.min&&(b.max===Infinity||a.days<b.max));return{key:b.label,label:b.label,primary:rows.length,ids:rows.map(a=>a.task.id)};});
 const states:Record<string,string>={pending:"Pendente",in_progress:"Em execução",review:"Em revisão",awaiting_approval:"Em aprovação",blocked:"Bloqueado",completed:"Concluído",cancelled:"Cancelado"};
 const areas=[...new Set(tasks.map(t=>t.area??"Sem área"))].sort();
 const composition:ChartRow[]=areas.map(area=>{const rows=tasks.filter(t=>(t.area??"Sem área")===area);return{key:area,label:area,primary:rows.length,ids:ids(rows),segments:Object.entries(states).map(([key,label])=>{const selected=rows.filter(t=>t.workflow_status===key);return{label,value:selected.length,ids:ids(selected)};})};});
 const reviews=(data.reviews??[]).filter(r=>tasks.some(t=>t.id===Number(r.work_task_id))&&r.outcome==="returned"&&inAnalyticsPeriod(r.created_at,f));
 const reasons:Record<string,string>={error:"Erro",quality:"Qualidade",incomplete_brief:"Briefing incompleto",scope_change:"Mudança de escopo"};
 const returns:ChartRow[]=[...new Set(reviews.map(r=>String(r.return_reason??"unknown")))].map(reason=>{const rows=reviews.filter(r=>String(r.return_reason??"unknown")===reason);return{key:reason,label:reasons[reason]??"Sem classificação",primary:rows.length,ids:[...new Set(rows.map(r=>Number(r.work_task_id)))]};});
 // O conjunto é a população do prazo; uma conclusão posterior não cria outro compromisso.
 const deliverables=(data.deliverables??[]).filter(d=>(!f.project||d.project_id===f.project)&&data.projects.some(p=>p.id===d.project_id&&(!f.client||p.client_id===f.client))&&(!f.team&&!f.person&&!f.area||tasks.some(t=>t.deliverable_id===d.id)));
 const milestones=deliverables.filter(d=>inAnalyticsPeriod(d.due_at,f)).sort((a,b)=>Date.parse(String(a.due_at))-Date.parse(String(b.due_at))||String(a.id).localeCompare(String(b.id)));
 const measurable=milestones.filter(d=>d.status!=="cancelled"&&Date.parse(String(d.due_at))<=now.getTime()&&(d.status!=="completed"||day(d.completed_at)));
 const onTime=measurable.filter(d=>d.status==="completed"&&Date.parse(String(d.completed_at))<=Date.parse(String(d.due_at)));
 const projectPlan:ChartRow[]=[...new Set(milestones.map(d=>String(d.project_id)))].map(id=>{const rows=milestones.filter(d=>d.project_id===id);return{key:id,label:String(data.projects.find(p=>p.id===id)?.name??"Projeto"),primary:rows.length,secondary:rows.filter(d=>d.status==="completed"&&day(d.completed_at)&&Date.parse(String(d.completed_at))<=Date.parse(String(d.due_at))).length,ids:ids(tasks.filter(t=>rows.some(d=>d.id===t.deliverable_id)))};});
 return{tasks,completed,throughput,aging,aged,unknownStart:aged.filter(a=>a.days===null).length,composition,returns,returnEvents:reviews.length,milestones,measurableMilestones:measurable.length,onTimeMilestones:measurable.length?onTime.length/measurable.length*100:null,projectPlan};
}

export function buildRelationshipAnalytics(data:CollaborationData,records:DepartmentRecord[],f:AnalyticsFilters,kind:"opportunity"|"cs"){
 const rows=records.filter(r=>r.kind===kind&&r.canViewMetrics&&(!f.client||r.client_id===f.client)&&(!f.project||r.project_id===f.project||r.converted_project_id===f.project)&&(!f.team||r.responsible_team_id===f.team)&&(!f.person||r.responsible_person_id===f.person));
 const now=Date.parse(data.generatedAt),terminal=kind==="opportunity"?["won","lost","cancelled"]:["completed","cancelled"];
 const pending=rows.filter(r=>!terminal.includes(r.status)),overdue=pending.filter(r=>r.next_action_at&&Date.parse(r.next_action_at)<now),due=pending.filter(r=>inAnalyticsPeriod(r.next_action_at,f));
 // Usa eventos de transição, sem tratar updated_at como data de ganho ou conclusão.
 const events=(data.departmentHistory??[]).filter(e=>rows.some(r=>r.id===e.entity_id)&&e.entity_kind===kind&&inAnalyticsPeriod(e.at,f)).filter(e=>{
  const before=e.prior_value as Record<string,unknown>|null,after=e.new_value as Record<string,unknown>|null;
  return after&&before?.status!==after.status&&(kind==="opportunity"?["won","lost"].includes(String(after.status)):after.status==="completed");
 });
 const buckets=new Map<string,{primary:number;secondary:number;recordIds:Set<string>}>();
 for(const e of events){const key=weekStart(day(e.at)!);if(!buckets.has(key))buckets.set(key,{primary:0,secondary:0,recordIds:new Set()});const b=buckets.get(key)!,after=e.new_value as Record<string,unknown>;if(after.status==="lost")b.secondary++;else b.primary++;b.recordIds.add(String(e.entity_id));}
 const trend=[...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>({key,label:labelDay(key),primary:v.primary,...(kind==="opportunity"?{secondary:v.secondary}:{}),ids:[],recordIds:[...v.recordIds]}));
 const won=events.filter(e=>(e.new_value as Record<string,unknown>).status==="won").length,lost=events.filter(e=>(e.new_value as Record<string,unknown>).status==="lost").length;
 return{rows,pending,overdue,due,waiting:pending.filter(r=>r.waiting_kind==="client"),trend,events,winRate:won+lost?won/(won+lost)*100:null,won,lost};
}
