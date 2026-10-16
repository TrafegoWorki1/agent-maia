import { useState, type FormEvent } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { mutateCollaboration, type CollaborationData } from "../../lib/collaborationApi";

type Kind="contract"|"project"|"deliverable";
const names:Record<Kind,string>={contract:"Contrato",project:"Projeto",deliverable:"Entregável"};
const statuses:Record<Kind,string[]>={contract:["draft","active","paused","ended","cancelled"],project:["planned","active","on_hold","completed","cancelled"],deliverable:["pending","in_progress","review","awaiting_approval","completed","cancelled"]};
export function PortfolioPanel({data,reload}:{data:CollaborationData;reload:()=>Promise<void>}){
 const [kind,setKind]=useState<Kind>("project"),[id,setId]=useState(""),[revision,setRevision]=useState<number|undefined>();
 const [form,setForm]=useState<Record<string,string>>({status:"planned",reason:""}),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const rows=kind==="contract"?data.contracts:kind==="project"?data.projects:data.deliverables;
 const canCreate=kind==="deliverable"?data.projects.some(project=>project.canManage):data.portfolioClientIds.length>0;
 const canEdit=id?rows.some(row=>row.id===id&&row.canManage):canCreate;
 function select(nextKind:Kind,row?:Record<string,unknown>){
  setKind(nextKind);setId(row?String(row.id):"");setRevision(row?Number(row.revision):undefined);setError("");
  setForm(row?{...Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value===null?"":String(value)])),reason:"",evidence:""}:{status:statuses[nextKind][0],reason:"",client_id:"",project_id:"",name:"",title:"",objective:"",service_scope:"",acceptance_criteria:"",contract_id:"",responsible_person_id:"",responsible_team_id:"",starts_on:"",ends_on:"",due_on:"",due_at:""});
 }
 const field=(name:string,value:string)=>setForm(current=>({...current,[name]:value}));
 async function save(event:FormEvent){
  event.preventDefault();setBusy(true);setNotice("");setError("");
  const nullable=(key:string)=>form[key]||null;
  const common={reason:form.reason,responsible_person_id:nullable("responsible_person_id"),responsible_team_id:nullable("responsible_team_id")};
  const payload=kind==="contract"?{...common,client_id:form.client_id,name:form.name,service_scope:form.service_scope,status:form.status,starts_on:nullable("starts_on"),ends_on:nullable("ends_on")}:
   kind==="project"?{...common,client_id:form.client_id,contract_id:nullable("contract_id"),name:form.name,objective:form.objective??"",status:form.status,starts_on:nullable("starts_on"),due_on:nullable("due_on")}:
   {project_id:form.project_id,title:form.title,objective:form.objective??"",acceptance_criteria:form.acceptance_criteria??"",status:form.status,due_at:nullable("due_at"),evidence:form.evidence||undefined,reason:form.reason};
  try{await mutateCollaboration({action:"portfolio_save",kind,id:id||undefined,revision,payload});await reload();select(kind);setNotice(names[kind]+" salvo e conferido no banco.");}
  catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar.");}finally{setBusy(false);}
 }
 return <Panel title="Contratos, projetos e entregáveis" caption="Os vínculos usam IDs cadastrados. Alterar a qualidade de uma entrega não autoriza publicação.">
  <div className="collab-view-switch" role="group" aria-label="Tipo de registro">{(["contract","project","deliverable"] as Kind[]).map(value=><button key={value} aria-pressed={kind===value} onClick={()=>select(value)}>{names[value]}s</button>)}</div>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  {rows.length?<div className="table-wrap"><table><thead><tr><th>Registro</th><th>Cliente / projeto</th><th>Estado</th><th>Revisão</th><th>Ação</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td>{String(row.name??row.title)}</td><td>{kind==="deliverable"?String(data.projects.find(project=>project.id===row.project_id)?.name??"Projeto autorizado"):data.clients.find(client=>client.id===row.client_id)?.name??"Cliente autorizado"}</td><td>{String(row.status)}</td><td>{String(row.revision)}</td><td>{row.canManage?<button onClick={()=>select(kind,row)}>Editar {names[kind].toLowerCase()}</button>:"Consulta"}</td></tr>)}</tbody></table></div>:<EmptyState title={"Nenhum "+names[kind].toLowerCase()+" neste escopo"} detail="Os registros aparecerão após seu cadastro autorizado."/>}
  {(canEdit||canCreate)&&<form className="work-form" onSubmit={event=>void save(event)}>
   <h3>{id?"Editar":"Novo"} {names[kind].toLowerCase()}</h3>
   {kind!=="deliverable"?<label>Cliente<select required disabled={!!id} value={form.client_id??""} onChange={event=>{field("client_id",event.target.value);field("contract_id","");}}><option value="">Selecione pelo cadastro</option>{data.clients.filter(client=>!!id?client.id===form.client_id:data.portfolioClientIds.includes(client.id)).map(client=><option value={client.id} key={client.id}>{client.name}</option>)}</select></label>:<label>Projeto<select required disabled={!!id} value={form.project_id??""} onChange={event=>field("project_id",event.target.value)}><option value="">Selecione pelo cadastro</option>{data.projects.filter(project=>project.canManage).map(project=><option value={String(project.id)} key={String(project.id)}>{String(project.name)}</option>)}</select></label>}
   {kind==="project"&&<label>Contrato<select value={form.contract_id??""} onChange={event=>field("contract_id",event.target.value)}><option value="">Sem contrato associado</option>{data.contracts.filter(contract=>contract.client_id===form.client_id).map(contract=><option value={String(contract.id)} key={String(contract.id)}>{String(contract.name)}</option>)}</select></label>}
   <label>Nome<input required maxLength={kind==="deliverable"?200:160} value={form[kind==="deliverable"?"title":"name"]??""} onChange={event=>field(kind==="deliverable"?"title":"name",event.target.value)}/></label>
   {kind==="contract"?<label>Escopo contratado<textarea required maxLength={2000} value={form.service_scope??""} onChange={event=>field("service_scope",event.target.value)}/></label>:<label>Objetivo<textarea maxLength={2000} value={form.objective??""} onChange={event=>field("objective",event.target.value)}/></label>}
   {kind==="deliverable"&&<label>Critérios de aceite<textarea maxLength={4000} value={form.acceptance_criteria??""} onChange={event=>field("acceptance_criteria",event.target.value)}/></label>}
   <label>Estado<select value={form.status} onChange={event=>field("status",event.target.value)}>{statuses[kind].map(status=><option key={status} value={status}>{status}</option>)}</select></label>
   {kind==="deliverable"?<><label>Prazo ISO com fuso<input placeholder="2026-10-23T18:00:00-03:00" value={form.due_at??""} onChange={event=>field("due_at",event.target.value)}/></label>{form.status==="completed"&&<label>Evidência da conclusão<textarea required maxLength={2000} value={form.evidence??""} onChange={event=>field("evidence",event.target.value)}/></label>}</>:<>
    <label>Início<input type="date" value={form.starts_on??""} onChange={event=>field("starts_on",event.target.value)}/></label><label>Fim / prazo<input type="date" min={form.starts_on||undefined} value={form[kind==="contract"?"ends_on":"due_on"]??""} onChange={event=>field(kind==="contract"?"ends_on":"due_on",event.target.value)}/></label>
    <label>Responsável<select value={form.responsible_person_id??""} onChange={event=>field("responsible_person_id",event.target.value)}><option value="">Não atribuído</option>{data.people.filter(person=>person.active).map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
    <label>Equipe<select value={form.responsible_team_id??""} onChange={event=>field("responsible_team_id",event.target.value)}><option value="">Não atribuída</option>{data.teams.filter(team=>team.active).map(team=><option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
   </>}
   <label>Motivo da criação ou alteração<textarea required minLength={3} maxLength={1000} value={form.reason??""} onChange={event=>field("reason",event.target.value)}/></label>
   <div className="collab-actions"><button type="submit" disabled={busy||!canEdit}>Salvar {names[kind].toLowerCase()}</button>{id&&<button type="button" onClick={()=>select(kind)}>Cancelar edição</button>}</div>
  </form>}
  <details><summary>Histórico de alterações da carteira</summary><ul>{data.portfolioHistory.filter(row=>row.entity_kind===kind&&(!id||row.entity_id===id)).map(row=><li key={String(row.id)}>{new Date(String(row.at)).toLocaleString("pt-BR")} · {String(row.reason)} · {data.people.find(person=>person.id===row.actor_person_id)?.name??"Pessoa cadastrada"}</li>)}</ul></details>
 </Panel>;
}
