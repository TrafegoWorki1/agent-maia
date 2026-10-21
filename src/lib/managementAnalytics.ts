import {validDay} from "./panelSourceModel";
import type {CollaborationData,CollaborationTask} from "./collaborationApi";
export interface AnalyticsFilters{start:string;end:string;client:string;project:string;team:string;person:string;area:string}
export interface AnalyticalMetric{code:string;label:string;value:number|null;unit:string;ids:number[];description:string;coverage:string}
export interface ChartRow{key:string;label:string;primary:number;secondary?:number;ids:number[]}
const terminal=(t:CollaborationTask)=>["completed","cancelled"].includes(t.workflow_status);
const timestamp=(s:unknown)=>typeof s==="string"&&Number.isFinite(Date.parse(s))?Date.parse(s):null;
export const brtDate=(date:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const addDays=(day:string,n:number)=>{const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
export function defaultAnalyticsFilters(now=new Date()):AnalyticsFilters{
 const day=brtDate(now),d=new Date(day+"T12:00:00Z"),start=addDays(day,-((d.getUTCDay()+6)%7));
 return{start,end:addDays(start,6),client:"",project:"",team:"",person:"",area:""};
}
export function matchingTasks(tasks:CollaborationTask[],f:AnalyticsFilters){
 return tasks.filter(t=>(!f.client||t.client_ref_id===f.client)&&(!f.project||t.project_ref_id===f.project)&&(!f.team||t.responsible_team_id===f.team)&&(!f.person||t.responsible_person_id===f.person)&&(!f.area||t.area===f.area));
}
function dayOf(value:unknown){const ms=timestamp(value);return ms===null?null:brtDate(new Date(ms));}
function quantile(values:number[],p:number){if(!values.length)return null;const list=[...values].sort((a,b)=>a-b);const i=(list.length-1)*p,lo=Math.floor(i);return list[lo]+(list[Math.ceil(i)]-list[lo])*(i-lo);}
export function buildManagementAnalytics(data:CollaborationData,f:AnalyticsFilters,now=new Date()){
 const valid=validDay(f.start)&&validDay(f.end)&&f.start<=f.end;
 const tasks=matchingTasks(data.tasks,f),ids=(rows:CollaborationTask[])=>rows.map(t=>t.id);
 const inPeriod=(v:unknown)=>{const d=dayOf(v);return valid&&!!d&&d>=f.start&&d<=f.end;};
 // Baselines congeladas são usadas somente quando disponíveis para o compromisso do período.
 const originals=new Map<number,string>();
 const plans=new Set(data.plans.filter(p=>p.period_kind==="weekly"&&String(p.period_start)<=f.end&&String(p.period_end)>=f.start).map(p=>String(p.id)));
 for(const b of data.baselines.filter(b=>plans.has(b.plan_id)).sort((a,b)=>(a.created_at??"").localeCompare(b.created_at??"")||a.plan_id.localeCompare(b.plan_id)))for(const s of b.task_snapshots){if(s.committed_due_at&&!originals.has(s.id))originals.set(s.id,s.committed_due_at);}
 const due=(t:CollaborationTask)=>originals.get(t.id)??t.committed_due_at;
 const commitments=tasks.filter(t=>inPeriod(due(t)));
 const matured=commitments.filter(t=>timestamp(due(t))!<=now.getTime()&&t.workflow_status!=="cancelled");
 const measurable=matured.filter(t=>t.workflow_status!=="completed"||timestamp(t.completed_at)!==null);
 const onTime=measurable.filter(t=>t.workflow_status==="completed"&&timestamp(t.completed_at)!<=timestamp(due(t))!);
 const overdue=tasks.filter(t=>!terminal(t)&&timestamp(t.committed_due_at)!==null&&timestamp(t.committed_due_at)!<now.getTime());
 const blocked=tasks.filter(t=>t.workflow_status==="blocked"),decisions=tasks.filter(t=>["review","awaiting_approval"].includes(t.workflow_status));
 const completed=tasks.filter(t=>t.workflow_status==="completed"&&inPeriod(t.completed_at));
 const cycle=completed.flatMap(t=>{const a=timestamp(t.started_at),b=timestamp(t.completed_at);return a!==null&&b!==null&&b>=a?[(b-a)/86400000]:[];});
 const snapshots=commitments.filter(t=>originals.has(t.id)).length;
 const metric=(code:string,label:string,rows:CollaborationTask[],value:number|null,unit:string,description:string,coverage:string):AnalyticalMetric=>({code,label,ids:ids(rows),value,unit,description,coverage});
 const capacityAllowed=valid&&!f.client&&!f.project&&!f.area;
 const capacities=data.capacity.filter(c=>(!f.team||c.team_id===f.team)&&(!f.person||c.person_id===f.person)&&String(c.week_start)<=f.end&&addDays(String(c.week_start),6)>=f.start);
 const capacity=capacityAllowed&&capacities.length?capacities.reduce((sum,c)=>sum+Math.max(0,Number(c.available_hours)-Number(c.absence_hours)),0):null;
 const metrics=[
  metric("commitments","Compromissos do período",commitments,valid?commitments.length:null,"entregas","Tarefas com vencimento no período selecionado; cancelamentos permanecem identificados no detalhamento.",`${snapshots} de ${commitments.length} compromissos com baseline; demais usam prazo atual.`),
  metric("on_time","Pontualidade",measurable,measurable.length?Math.round(onTime.length/measurable.length*1000)/10:null,"%","Concluídas até o prazo ÷ compromissos já vencidos e mensuráveis do período. Canceladas ficam fora da taxa.",`${onTime.length} de ${measurable.length}; ${matured.length-measurable.length} concluídas sem data não entram na taxa.`),
  metric("overdue","Entregas atrasadas",overdue,overdue.length,"itens","Estado atual: trabalho aberto com prazo atual anterior à leitura. O período não reconstrói um estado passado.","Todos os atrasos atuais no recorte de cliente, projeto, equipe, pessoa e área."),
  metric("blocked","Bloqueios",blocked,blocked.length,"itens","Estado atual: tarefas bloqueadas, com a espera registrada no detalhamento.","Tempo de bloqueio disponível somente quando há data de início."),
  metric("capacity","Capacidade informada",[],capacity,"h", "Horas disponíveis menos ausências nas semanas selecionadas. Não é uma estimativa por quantidade de tarefas.",!capacityAllowed?"Remova cliente, projeto e área para consultar capacidade pessoal/equipe.":capacities.length?`${capacities.length} registros semanais informados; sem rateio por cliente.`:"Disponibilidade semanal ainda não cadastrada."),
  metric("decisions","Decisões pendentes",decisions,decisions.length,"itens","Estado atual: revisões e aprovações pendentes, conforme atribuições registradas.","Revisar qualidade não autoriza publicar.")
 ];
 const dayGroups=new Map<string,CollaborationTask[]>();
 for(const t of commitments){const d=dayOf(due(t))!;dayGroups.set(d,[...(dayGroups.get(d)??[]),t]);}
 const planChart:ChartRow[]=[...dayGroups].sort(([a],[b])=>a.localeCompare(b)).map(([day,rows])=>({key:day,label:day.slice(8)+"/"+day.slice(5,7),primary:rows.length,secondary:rows.filter(t=>t.workflow_status==="completed"&&timestamp(t.completed_at)!==null&&timestamp(t.completed_at)!<=timestamp(due(t))!).length,ids:ids(rows)}));
 function group(rows:CollaborationTask[],key:(t:CollaborationTask)=>string,label:(id:string)=>string):ChartRow[]{
 const map=new Map<string,CollaborationTask[]>();for(const t of rows){const k=key(t);map.set(k,[...(map.get(k)??[]),t]);}
 return [...map].map(([k,list])=>({key:k,label:label(k),primary:list.length,ids:ids(list)})).sort((a,b)=>b.primary-a.primary);
 }
 const projectChart=group(overdue,t=>t.project_ref_id??"",id=>String(data.projects.find(p=>p.id===id)?.name??(id?"Projeto autorizado":"Sem projeto vinculado")));
 const stateNames:Record<string,string>={pending:"Pendente",in_progress:"Em execução",review:"Em revisão",awaiting_approval:"Aguardando aprovação",blocked:"Bloqueado",completed:"Concluído",cancelled:"Cancelado"};
 const stateChart=group(tasks,t=>t.workflow_status,id=>stateNames[id]??id);
 const waitingChart=group(blocked,t=>t.waiting_kind??"",id=>(({team:"Equipe",owner:"Proprietário",client:"Cliente",external:"Externo"} as Record<string,string>)[id]??"Motivo não classificado"));
 const weeks=new Map<string,{planned:number;done:number;known:number;capacityKnown:boolean}>();
 for(const c of capacities){const person=String(c.person_id);if(!weeks.has(person))weeks.set(person,{planned:0,done:0,known:0,capacityKnown:false});weeks.get(person)!.capacityKnown=true;weeks.get(person)!.known+=Math.max(0,Number(c.available_hours)-Number(c.absence_hours));}
 const work=tasks.filter(t=>!terminal(t)&&inPeriod(t.committed_due_at));
 for(const t of work){const person=t.responsible_person_id??"";if(!weeks.has(person))weeks.set(person,{planned:0,done:0,known:0,capacityKnown:false});const row=weeks.get(person)!;if(typeof t.estimated_effort_hours==="number"&&Number.isFinite(t.estimated_effort_hours))row.planned+=t.estimated_effort_hours;else row.done++;}
 const loadChart=capacityAllowed?[...weeks].map(([person,v])=>({key:person,label:data.people.find(p=>p.id===person)?.name??"Sem pessoa vinculada",primary:v.planned,secondary:v.capacityKnown?v.known:undefined,ids:ids(work.filter(t=>(t.responsible_person_id??"")===person)),missingEstimates:v.done})): [];
 const exceptionRows=[...new Set([...overdue,...blocked,...decisions].map(t=>t.id))].map(id=>tasks.find(t=>t.id===id)!).sort((a,b)=>a.priority-b.priority);
 return {valid,tasks,metrics,planChart,projectChart,stateChart,waitingChart,loadChart,exceptions:exceptionRows,completed:completed.length,cycleMedianDays:quantile(cycle,.5),cycleP85Days:cycle.length>=7?quantile(cycle,.85):null,cycleSample:cycle.length,cancelled:commitments.filter(t=>t.workflow_status==="cancelled").length,addedAfterBaseline:tasks.filter(t=>t.added_after_baseline).length};
}
