import { useState, type FormEvent } from "react";
import { Panel } from "../../components/ui";
import { mutateCollaboration, type CollaborationData, type CollaborationTask } from "../../lib/collaborationApi";

export function stateHours(history:Array<Record<string,unknown>>,now:Date){
 const ordered=[...history].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
 const totals:Record<string,number>={in_progress:0,review:0,awaiting_approval:0,team:0,owner:0,client:0,external:0};
 ordered.forEach((event,index)=>{const state=event.to_value as Record<string,unknown>|null;if(!state)return;const start=Date.parse(String(event.at)),end=index+1<ordered.length?Date.parse(String(ordered[index+1].at)):now.getTime();const key=state.workflow_status==="blocked"?String(state.waiting_kind):String(state.workflow_status);if(key in totals)totals[key]+=Math.max(0,end-start)/3_600_000;});
 return totals;
}
export function TaskDetailPanel({task,data,reload,onClose}:{task:CollaborationTask;data:CollaborationData;reload:()=>Promise<void>;onClose:()=>void}){
 const [revision]=useState(task.revision);
 const [title,setTitle]=useState(task.title),[objective,setObjective]=useState(task.objective??""),[briefing,setBriefing]=useState(task.briefing??""),[criteria,setCriteria]=useState(task.acceptance_criteria??""),[effort,setEffort]=useState(task.estimated_effort_hours===null?"":String(task.estimated_effort_hours));
 const [projectId,setProjectId]=useState(task.project_ref_id??""),[deliverableId,setDeliverableId]=useState(task.deliverable_id??""),[reviewer,setReviewer]=useState(task.reviewer_person_id??""),[approver,setApprover]=useState(task.approver_person_id??"");
 const [reason,setReason]=useState(""),[comment,setComment]=useState(""),[label,setLabel]=useState(""),[uri,setUri]=useState(""),[dependency,setDependency]=useState("");
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const closed=["completed","cancelled"].includes(task.workflow_status);
 const history=data.history.filter(row=>Number(row.work_task_id)===task.id),artifacts=data.artifacts.filter(row=>Number(row.work_task_id)===task.id);
 const durations=stateHours(history,new Date(data.generatedAt));
 async function act(operation:string,payload:Record<string,unknown>){setBusy(true);setError("");try{await mutateCollaboration({action:"task_action",taskId:task.id,revision,operation,payload});await reload();onClose();}catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setBusy(false);}}
 async function save(event:FormEvent){event.preventDefault();await act("edit",{title,objective,briefing,acceptance_criteria:criteria,estimated_effort_hours:effort===""?null:Number(effort),reason,...(task.allowedActions.prioritize?{project_ref_id:projectId||null,deliverable_id:deliverableId||null,reviewer_person_id:reviewer||null,approver_person_id:approver||null}:{})});}
 return <Panel title={"#"+task.id+" · "+task.title} action={<button onClick={onClose}>Fechar detalhe</button>}>
  {error&&<p role="alert">{error}</p>}
  <p>{task.objective||"Objetivo não informado."}</p><p>{task.briefing||"Briefing não informado."}</p><p>Critérios de aceite: {task.acceptance_criteria||"não informados"}</p><p>Evidência: {task.completion_evidence||"ainda não registrada"}</p>
  <p>Cliente: {data.clients.find(client=>client.id===task.client_ref_id)?.name??"Não vinculado"} · Projeto: {String(data.projects.find(project=>project.id===task.project_ref_id)?.name??"Não vinculado")} · Origem: {task.origin_kind}{task.source_task_id?" · execução Maia #"+task.source_task_id:""}</p>
  <details><summary>Tempo nos estados</summary><p>Intervalos de calendário entre registros; não medem horas efetivamente trabalhadas.</p><ul>{Object.entries(durations).map(([state,hours])=><li key={state}>{({in_progress:"Em execução",review:"Aguardando revisão",awaiting_approval:"Aguardando aprovação",team:"Aguardando equipe",owner:"Aguardando proprietário",client:"Aguardando cliente",external:"Aguardando externo"} as Record<string,string>)[state]}: {hours.toFixed(1)} h</li>)}</ul></details>
  <details><summary>Histórico, autoria e valores anteriores</summary><ol>{history.map(event=><li key={String(event.id)}>{new Date(String(event.at)).toLocaleString("pt-BR")} · {String(event.event_type)} · {data.people.find(person=>person.id===event.actor_person_id)?.name??"Pessoa cadastrada"} · {String(event.reason??"")}<details><summary>Alteração registrada</summary><pre>{JSON.stringify({antes:event.from_value,depois:event.to_value},null,2)}</pre></details></li>)}</ol></details>
  <ul>{artifacts.map(artifact=><li key={String(artifact.id)}><a href={String(artifact.uri)} target="_blank" rel="noreferrer">{String(artifact.label)}</a> · {String(artifact.evidence_kind)}</li>)}</ul>
  <ul>{data.dependencies.filter(item=>Number(item.task_id)===task.id).map(item=><li key={Number(item.depends_on_task_id)}>Depende de #{Number(item.depends_on_task_id)} · {data.tasks.find(row=>row.id===Number(item.depends_on_task_id))?.title}{!closed&&task.allowedActions.prioritize&&<button disabled={busy||reason.trim().length<3} onClick={()=>void act("dependency",{depends_on:Number(item.depends_on_task_id),remove:true,reason})}>Remover dependência</button>}</li>)}</ul>
  {task.allowedActions.update&&!closed&&<details><summary>Editar briefing, esforço e vínculos</summary><form className="work-form" onSubmit={event=>void save(event)}>
   <label>Título<input required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)}/></label><label>Objetivo<textarea maxLength={2000} value={objective} onChange={event=>setObjective(event.target.value)}/></label><label>Briefing<textarea maxLength={8000} value={briefing} onChange={event=>setBriefing(event.target.value)}/></label><label>Critérios de aceite<textarea maxLength={4000} value={criteria} onChange={event=>setCriteria(event.target.value)}/></label><label>Esforço estimado (horas)<input type="number" min="0" max="10000" step="0.25" value={effort} onChange={event=>setEffort(event.target.value)}/></label>
   {task.allowedActions.prioritize&&<>
    <label>Projeto<select value={projectId} onChange={event=>{setProjectId(event.target.value);setDeliverableId("");}}><option value="">Não vinculado</option>{data.projects.filter(project=>project.canManage&&(!task.client_ref_id||project.client_id===task.client_ref_id)).map(project=><option key={String(project.id)} value={String(project.id)}>{String(project.name)}</option>)}</select></label>
    <label>Entregável<select value={deliverableId} onChange={event=>setDeliverableId(event.target.value)}><option value="">Não vinculado</option>{data.deliverables.filter(item=>item.project_id===projectId).map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.title)}</option>)}</select></label>
    <label>Revisor<select value={reviewer} onChange={event=>setReviewer(event.target.value)}><option value="">Não necessário</option>{data.people.filter(person=>person.active).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Aprovador de qualidade<select value={approver} onChange={event=>setApprover(event.target.value)}><option value="">Não necessário</option>{data.people.filter(person=>person.active).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
   </>}
   <label>Motivo<textarea required minLength={3} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><button disabled={busy}>Salvar alterações</button>
  </form></details>}
  {task.allowedActions.update&&!closed&&<>
   <form className="work-form" onSubmit={event=>{event.preventDefault();void act("comment",{reason:comment});}}><label>Comentário<textarea required maxLength={2000} value={comment} onChange={event=>setComment(event.target.value)}/></label><button disabled={busy}>Registrar comentário</button></form>
   <form className="work-form" onSubmit={event=>{event.preventDefault();void act("artifact",{label,uri,evidence_kind:"reference"});}}><label>Nome do arquivo ou evidência<input required maxLength={200} value={label} onChange={event=>setLabel(event.target.value)}/></label><label>Referência HTTPS<input type="url" required pattern="https://.*" value={uri} onChange={event=>setUri(event.target.value)}/></label><button disabled={busy}>Vincular artefato</button></form>
  </>}
  {task.allowedActions.prioritize&&!closed&&<form className="work-form" onSubmit={event=>{event.preventDefault();void act("dependency",{depends_on:Number(dependency),reason});}}><label>Depende de<select required value={dependency} onChange={event=>setDependency(event.target.value)}><option value="">Selecione</option>{data.tasks.filter(row=>row.id!==task.id).map(row=><option key={row.id} value={row.id}>#{row.id} · {row.title}</option>)}</select></label><label>Motivo da dependência<input required minLength={3} value={reason} onChange={event=>setReason(event.target.value)}/></label><button disabled={busy}>Adicionar dependência</button></form>}
 </Panel>;
}
