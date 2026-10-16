import { useState, type FormEvent } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { CapacityOverview } from "./WorkOverview";
import { mutateCollaboration, type CollaborationData } from "../../lib/collaborationApi";

type Props={data:CollaborationData;reload:()=>Promise<void>};
const dateInSaoPaulo=(date:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
function endOfPeriod(start:string,kind:string){if(!start)return "";const date=new Date(start+"T12:00:00Z");if(kind==="weekly")date.setUTCDate(date.getUTCDate()+6);if(kind==="monthly")date.setUTCMonth(date.getUTCMonth()+1,0);return date.toISOString().slice(0,10);}
export function PlanningPanel({data,reload}:Props){
 const now=new Date();const monday=new Date(dateInSaoPaulo(now)+"T12:00:00Z");monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));const today=monday.toISOString().slice(0,10);
 const [teamId,setTeamId]=useState(data.planningTeamIds[0]??"");
 const [planId,setPlanId]=useState(""),[revision,setRevision]=useState<number|undefined>();
 const [kind,setKind]=useState<"monthly"|"weekly"|"daily">("weekly"),[start,setStart]=useState(today),[end,setEnd]=useState(endOfPeriod(today,"weekly"));
 const [objective,setObjective]=useState(""),[selected,setSelected]=useState<number[]>([]),[reason,setReason]=useState("");
 const [capacityRevision,setCapacityRevision]=useState<number|undefined>(),[personId,setPersonId]=useState(""),[week,setWeek]=useState(today),[available,setAvailable]=useState(""),[absence,setAbsence]=useState("0"),[note,setNote]=useState("");
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const plans=data.plans.filter(plan=>plan.team_id===teamId),editing=data.plans.find(plan=>plan.id===planId);
 const canPlan=data.planningTeamIds.includes(teamId);
 const members=data.teamMembers.filter(member=>member.team_id===teamId&&member.active);
 const selectedTasks=data.tasks.filter(task=>task.responsible_team_id===teamId);
 function pickPlan(id:string){
  setPlanId(id);setReason("");setError("");const plan=data.plans.find(row=>row.id===id);
  if(!plan){setRevision(undefined);setObjective("");setSelected([]);return;}
  setTeamId(String(plan.team_id));setRevision(Number(plan.revision));setKind(plan.period_kind as typeof kind);setStart(String(plan.period_start));setEnd(String(plan.period_end));setObjective(String(plan.objective??""));
  setSelected(data.planItems.filter(item=>item.plan_id===id).map(item=>Number(item.work_task_id)));
 }
 function pickCapacity(person:string,date:string){setPersonId(person);setWeek(date);const row=data.capacity.find(row=>row.person_id===person&&row.team_id===teamId&&row.week_start===date);setCapacityRevision(row?Number(row.revision):undefined);setAvailable(row?String(row.available_hours):"");setAbsence(row?String(row.absence_hours):"0");setNote(String(row?.note??""));}
 async function savePlan(baseline:boolean){
  setBusy(true);setError("");setNotice("");
  try{await mutateCollaboration({action:"plan_save",id:planId||undefined,revision,teamId,periodKind:kind,periodStart:start,periodEnd:end,objective,taskIds:selected,baseline,reason:reason||undefined});await reload();pickPlan("");setNotice("Plano salvo. Compromissos, baseline e motivo foram conferidos no banco.");}
  catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setBusy(false);}
 }
 async function saveCapacity(event:FormEvent){
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try{const current=data.capacity.find(row=>row.person_id===personId&&row.team_id===teamId&&row.week_start===week);await mutateCollaboration({action:"capacity_save",personId,teamId,weekStart:week,availableHours:Number(available),absenceHours:Number(absence),note,revision:capacityRevision});await reload();setPersonId("");setCapacityRevision(undefined);setNotice("Capacidade atualizada.");}
  catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setBusy(false);}
 }
 const baseline=data.baselines.find(row=>row.plan_id===planId);
 return <>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <Panel title="Planejamento mensal, semanal e diário" caption="Selecione compromissos reais. Alterações posteriores preservam a baseline e registram seus impactos.">
   {data.planningTeamIds.length===0?<EmptyState title="Planejamento em consulta" detail="A edição exige a competência de planejamento da equipe."/>:<div className="work-form">
    <label>Equipe<select value={teamId} onChange={event=>{setTeamId(event.target.value);pickPlan("");setPersonId("");}}>{data.teams.filter(team=>data.planningTeamIds.includes(team.id)).map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
    <label>Plano<select value={planId} onChange={event=>pickPlan(event.target.value)}><option value="">Novo plano</option>{plans.map(plan=><option value={String(plan.id)} key={String(plan.id)}>{String(plan.period_kind)} · {String(plan.period_start)} · {String(plan.objective??"Sem objetivo")}</option>)}</select></label>
    <label>Horizonte<select value={kind} disabled={!!editing?.baseline_at} onChange={event=>{const value=event.target.value as typeof kind;setKind(value);setEnd(endOfPeriod(start,value));}}><option value="monthly">Mensal</option><option value="weekly">Semanal</option><option value="daily">Diário</option></select></label>
    <label>Início<input type="date" required disabled={!!editing?.baseline_at} value={start} onChange={event=>{setStart(event.target.value);setEnd(endOfPeriod(event.target.value,kind));}}/></label>
    <label>Fim<input type="date" required disabled={!!editing?.baseline_at} value={end} min={start} onChange={event=>setEnd(event.target.value)}/></label>
    <label>Objetivo<textarea value={objective} maxLength={1000} onChange={event=>setObjective(event.target.value)}/></label>
    <fieldset><legend>Compromissos do plano</legend>{selectedTasks.length?selectedTasks.map(task=><label key={task.id}><input type="checkbox" checked={selected.includes(task.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,task.id]:ids.filter(id=>id!==task.id))}/>#{task.id} · {task.title}</label>):<p>Nenhuma tarefa nesta equipe. A criação de tarefas é feita pela Maia.</p>}</fieldset>
    {planId&&<label>Motivo e compromissos afetados<textarea required minLength={3} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>}
    <div className="collab-actions"><button disabled={busy||!canPlan||!!planId&&reason.trim().length<3} onClick={()=>void savePlan(false)}>Salvar plano</button><button disabled={busy||!canPlan||kind!=="weekly"||!!planId&&reason.trim().length<3} onClick={()=>void savePlan(true)}>Registrar baseline semanal</button></div>
   </div>}
   {baseline&&<details><summary>Baseline original preservada</summary><ul>{(baseline.task_snapshots as Array<{id:number;priority:number;committed_due_at:string|null}>).map(item=><li key={item.id}>#{item.id} · P{item.priority} · prazo {item.committed_due_at??"não informado"}</li>)}</ul></details>}
  </Panel>
  <Panel title="Disponibilidade e ausências" caption="Horas disponíveis e esforço estimado usam a mesma unidade. A distribuição é informada pela coordenação.">
   <form className="work-form" onSubmit={event=>void saveCapacity(event)}>
    <label>Pessoa<select required value={personId} onChange={event=>pickCapacity(event.target.value,week)}><option value="">Selecione</option>{members.map(member=><option key={member.person_id} value={member.person_id}>{data.people.find(person=>person.id===member.person_id)?.name??member.person_id}</option>)}</select></label>
    <label>Semana iniciada em<input required type="date" value={week} onChange={event=>pickCapacity(personId,event.target.value)}/></label>
    <label>Disponibilidade (horas)<input required type="number" min="0" max="168" step="0.25" value={available} onChange={event=>setAvailable(event.target.value)}/></label>
    <label>Ausências (horas)<input required type="number" min="0" max={available||168} step="0.25" value={absence} onChange={event=>setAbsence(event.target.value)}/></label>
    <label>Observação<input maxLength={500} value={note} onChange={event=>setNote(event.target.value)}/></label>
    <button disabled={busy||!canPlan||!personId} type="submit">Salvar capacidade</button>
   </form>
  </Panel>
  <Panel title="Capacidade informada da semana" caption="Estimativas e disponibilidade líquida em horas, no escopo semanal autorizado."><CapacityOverview data={data}/></Panel>
  <Panel title="Planos e alterações registrados">
   {data.plans.length?<div className="table-wrap"><table><thead><tr><th>Plano / período</th><th>Objetivo</th><th>Estado</th><th>Revisão</th><th>Ação</th></tr></thead><tbody>{data.plans.map(plan=><tr key={String(plan.id)}><td>{String(plan.period_kind)} · {String(plan.period_start)} a {String(plan.period_end)}</td><td>{String(plan.objective??"—")}</td><td>{String(plan.status)}</td><td>{String(plan.revision)}</td><td>{data.planningTeamIds.includes(String(plan.team_id))&&<button onClick={()=>pickPlan(String(plan.id))}>Editar plano</button>}</td></tr>)}</tbody></table></div>:<EmptyState title="Nenhum plano neste escopo" detail="Os planos salvos aparecerão após a próxima leitura."/>}
   <ul>{data.planChanges.filter(change=>!planId||change.plan_id===planId).map(change=><li key={String(change.id)}>{new Date(String(change.changed_at)).toLocaleString("pt-BR")} · {String(change.change_kind)} · {String(change.reason)} · itens {(change.affected_task_ids as number[]).join(", ")} · {data.people.find(person=>person.id===change.changed_by)?.name??"Pessoa cadastrada"}</li>)}</ul>
  </Panel>
 </>;
}
