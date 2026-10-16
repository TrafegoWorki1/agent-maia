import { useMemo, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { mutateCollaboration, type CollaborationData, type DepartmentRecord } from "../../lib/collaborationApi";
import { Tasks, useCollaboration } from "../collaboration/CollaborationPage";
import { PortfolioPanel } from "../collaboration/PortfolioPanel";
import { TaskDetailPanel } from "../collaboration/TaskDetailPanel";
import { WorkCalendar } from "../collaboration/WorkCalendar";
import { DepartmentMetricsPanel } from "../collaboration/DepartmentMetricsPanel";
import { calculateDepartmentMetrics } from "../../lib/departmentMetrics";

export type DepartmentMode="projects"|"implementations"|"marketing"|"opportunities"|"funnel"|"cs";
const titles:Record<DepartmentMode,[string,string]>={projects:["Clientes e projetos","Carteira, entregáveis e trabalho na mesma base da Central."],implementations:["Implementações","Entregáveis, critérios de aceite e tarefas dos projetos autorizados."],marketing:["Trabalho de Marketing","Conteúdo, criação e calendário sobre as mesmas tarefas; aprovação de qualidade não autoriza publicar."],opportunities:["Oportunidades","Registro comercial interno com próxima ação e conversão rastreável em projeto. Não é um CRM externo conectado."],funnel:["Funil comercial","Etapas calculadas sobre as oportunidades reais do seu escopo, sem valores financeiros implícitos."],cs:["Atendimento e CS","Clientes autorizados, combinados, próximos retornos e trabalho vinculado, sem duplicar tarefas."]};
const stages:Record<string,string>={prospecting:"Prospecção",qualified:"Qualificada",proposal:"Proposta",negotiation:"Negociação",won:"Ganha / projeto",lost:"Perdida",cancelled:"Cancelada",pending:"Pendente",in_progress:"Em execução",waiting:"Aguardando",completed:"Concluída"};
const marketingAreas=new Set(["marketing","conteudo","conteúdo","criacao","criação","design","creative"]);
export function departmentTasks(data:CollaborationData,mode:DepartmentMode,clientId="",projectId=""){
 return data.tasks.filter(task=>(!clientId||task.client_ref_id===clientId)&&(!projectId||task.project_ref_id===projectId)&&
  (mode!=="marketing"||marketingAreas.has((task.area??"").toLowerCase()))&&
  (!["projects","implementations"].includes(mode)||!!task.project_ref_id));
}

export function DepartmentWorkspace({mode}:{mode:DepartmentMode}){
 const {data,error,loading,stale,reload}=useCollaboration();
 const [clientId,setClientId]=useState(""),[projectId,setProjectId]=useState(()=>new URLSearchParams(window.location.hash.split("?")[1]??"").get("project")??""),[view,setView]=useState<"list"|"calendar">("list");
 const [title,subtitle]=titles[mode];
 const items=useMemo(()=>data?departmentTasks(data,mode,clientId,projectId):[],[data,mode,clientId,projectId]);
 if(loading&&!data)return <p role="status">Carregando registros autorizados…</p>;
 const portfolio=data?{...data,clients:data.clients.filter(row=>!clientId||row.id===clientId),contracts:data.contracts.filter(row=>!clientId||row.client_id===clientId),projects:data.projects.filter(row=>(!clientId||row.client_id===clientId)&&(!projectId||row.id===projectId)),deliverables:data.deliverables.filter(row=>data.projects.some(project=>project.id===row.project_id&&(!clientId||project.client_id===clientId)&&(!projectId||project.id===projectId)))}:null;
 const kind=mode==="cs"?"cs":"opportunity";
 const records=(data?.departmentRecords??[]).filter(row=>row.kind===kind&&(!clientId||row.client_id===clientId)&&(!projectId||row.project_id===projectId||row.converted_project_id===projectId));
 const marketingMetrics=(data?.externalMetrics??[]).filter(row=>["marketing.","content.","traffic."].some(prefix=>String(row.metric_code).startsWith(prefix))&&(!clientId||row.client_id===clientId)&&(!projectId||row.project_id===projectId));
 return <><PageHeader eyebrow="OPERAÇÃO COMPARTILHADA" title={title} subtitle={subtitle}/>
  {error&&<p role="alert">{error} <button onClick={()=>void reload()}>Tentar novamente</button></p>}
  {stale&&data&&<p role="status">Leitura desatualizada. Não confunda atualizar esta tela com coletar uma fonte externa.</p>}
  {data&&portfolio&&<>
   <p>Fonte: banco da Maia · leitura em {new Date(data.generatedAt).toLocaleString("pt-BR")}. <a href="#trabalho/meu-dia">Ir para Meu dia</a> · <a href="#trabalho/planejamento">Planejamento autorizado</a></p>
   <div className="work-form"><label>Cliente<select value={clientId} onChange={event=>{setClientId(event.target.value);setProjectId("");}}><option value="">Todos autorizados</option>{data.clients.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Projeto<select value={projectId} onChange={event=>setProjectId(event.target.value)}><option value="">Todos autorizados</option>{data.projects.filter(row=>!clientId||row.client_id===clientId).map(row=><option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label></div>
   {["projects","implementations"].includes(mode)&&<PortfolioPanel key={data.identity.accessVersion+mode+clientId+projectId} data={portfolio} reload={reload} initialKind={mode==="implementations"?"deliverable":"project"} onOpenProject={setProjectId}/>}
   {["opportunities","funnel","cs"].includes(mode)&&<DepartmentRecordsPanel key={data.identity.accessVersion+mode+clientId+projectId} data={data} rows={records} kind={kind} reload={reload} board={mode==="funnel"}/>}
   {mode==="marketing"&&<Panel title="Fontes de resultados e publicação" caption="Produção, revisão, aprovação e publicação são fatos distintos."><p>Este calendário mostra prazos comprometidos de trabalho, não confirma publicação. Resultados de campanhas só ficam disponíveis com fonte e vínculo explícito por IDs.</p>{marketingMetrics.length?<ul>{marketingMetrics.map(row=><li key={String(row.id)}>{String(row.metric_code)} · {row.value===null?String(row.unavailable_reason??"Indisponível"):String(row.value)+" "+String(row.unit)} · Fonte: {String(row.source_name)} · Período: {String(row.period_start)} a {String(row.period_end)} · Última tentativa: {String(row.last_attempt_at??"Não informada")} · Último sucesso: {String(row.last_success_at??"Não informado")}</li>)}</ul>:<p>Sem observações externas autorizadas disponíveis. Nenhuma conta foi associada por semelhança de nome.</p>}{data.identity.owner&&<a href="#marketing/campanhas">Consultar snapshot geral Meta, separado da carteira de clientes</a>}</Panel>}
   {mode==="cs"&&<Panel title="Clientes no seu escopo">{portfolio.clients.length?<ul>{portfolio.clients.map(client=><li key={client.id}><button onClick={()=>{setClientId(client.id);setProjectId("");}}>{client.name}</button> · {data.projects.filter(row=>row.client_id===client.id).length} projetos autorizados</li>)}</ul>:<EmptyState title="Nenhum cliente autorizado" detail="Cadastros e acessos são administrados pelo proprietário."/>}</Panel>}
   <div role="group" aria-label="Visualização do trabalho" className="collab-view-switch"><button aria-pressed={view==="list"} onClick={()=>setView("list")}>Lista</button><button aria-pressed={view==="calendar"} onClick={()=>setView("calendar")}>Calendário de prazos</button></div>
   <Panel title="Tarefas compartilhadas" caption="Mesmos IDs, detalhe, permissões e transições da Central. Criação pela Maia no WhatsApp.">{view==="calendar"?<WorkCalendar items={items} data={data} reload={reload}/>:<Tasks items={items} data={data} people={data.people} reload={reload}/>}</Panel>
  </>}
 </>;
}

function DepartmentRecordsPanel({data,rows,kind,reload,board}:{data:CollaborationData;rows:DepartmentRecord[];kind:"opportunity"|"cs";reload:()=>Promise<void>;board:boolean}){
 const [editing,setEditing]=useState<DepartmentRecord|null>(null),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState(""),[taskId,setTaskId]=useState<number|null>(null),[stage,setStage]=useState("");
 const currentTask=data.tasks.find(task=>task.id===taskId);
 const filtered=stage?rows.filter(row=>row.status===stage):rows;
 async function save(event:FormEvent){event.preventDefault();if(!editing)return;setBusy(true);setError("");setNotice("");try{await mutateCollaboration({action:"department_save",kind,id:editing.id,revision:editing.revision,payload:editing,reason});setEditing(null);setNotice("Alteração persistida. Atualizando a leitura compartilhada.");await reload();}catch(err){setError(err instanceof Error?err.message:"Falha ao salvar");}finally{setBusy(false);}}
 async function convert(row:DepartmentRecord){const reason=window.prompt("Motivo da conversão em projeto");if(!reason)return;setBusy(true);setError("");try{await mutateCollaboration({action:"opportunity_convert",id:row.id,revision:row.revision,reason});setNotice("Projeto persistido e vinculado à oportunidade. Nenhuma publicação foi autorizada.");await reload();}catch(err){setError(err instanceof Error?err.message:"Falha na conversão");}finally{setBusy(false);}}
 const field=(name:string,value:unknown)=>setEditing(row=>row?{...row,[name]:value}:row);
 const availableStages=kind==="opportunity"?["prospecting","qualified","proposal","negotiation","won","lost","cancelled"]:["pending","in_progress","waiting","completed","cancelled"];
 return <Panel title={kind==="cs"?"Combinados e retornos":"Oportunidades internas"} caption="Criação pela Maia no WhatsApp. Não depende de CRM; alterações exigem motivo e revisão atual.">
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  {board&&<div className="collab-view-switch" role="group" aria-label="Etapas do funil"><button onClick={()=>setStage("")}>Todas ({rows.length})</button>{availableStages.map(status=><button key={status} aria-pressed={stage===status} onClick={()=>setStage(status)}>{stages[status]} ({rows.filter(row=>row.status===status).length})</button>)}</div>}
  {!!data.departmentMetrics?.length&&<DepartmentMetricsPanel metrics={calculateDepartmentMetrics(filtered,data.generatedAt).filter(metric=>metric.code.startsWith(kind==="cs"?"cs.":"commercial."))} records={filtered}/>}
  {!filtered.length?<EmptyState title="Nenhum registro neste recorte" detail="Consulta real ao banco. Peça à Maia para registrar uma oportunidade ou combinado para um cliente cadastrado."/>:<div className="table-wrap"><table><thead><tr><th>Registro / cliente</th><th>Responsável / estado</th><th>Próxima ação</th><th>Vínculos e ações</th></tr></thead><tbody>{filtered.map(row=><tr key={row.id}><td><details><summary>{row.title} · {data.clients.find(client=>client.id===row.client_id)?.name??"Cliente autorizado"}</summary><p>{row.details}</p><p>Origem: {row.origin} · {new Date(row.created_at).toLocaleString("pt-BR")} · revisão {row.revision}</p>{row.waiting_kind&&<p>Aguardando: {row.waiting_kind}</p>}{row.evidence&&<p>Evidência: {row.evidence}</p>}{row.loss_reason&&<p>Perda: {row.loss_reason}</p>}</details></td><td>{data.people.find(person=>person.id===row.responsible_person_id)?.name??"Pessoa cadastrada"} · {stages[row.status]}</td><td>{row.next_action}<br/>{row.next_action_at?new Date(row.next_action_at).toLocaleString("pt-BR"):"Prazo não informado"}</td><td>{row.work_task_id&&data.tasks.some(task=>task.id===row.work_task_id)&&<button onClick={()=>setTaskId(row.work_task_id)}>Abrir tarefa #{row.work_task_id}</button>}{row.converted_project_id&&<a href={`#projetos/projetos-lista?project=${row.converted_project_id}`}>Projeto: {String(data.projects.find(project=>project.id===row.converted_project_id)?.name??row.converted_project_id)}</a>}{row.canUpdate&&<button disabled={busy} onClick={()=>{setEditing({...row});setReason("");setError("");}}>Editar registro</button>}{row.canConvert&&!row.converted_project_id&&["qualified","proposal","negotiation"].includes(row.status)&&<button disabled={busy} onClick={()=>void convert(row)}>Converter em projeto</button>}</td></tr>)}</tbody></table></div>}
  {editing&&<form className="work-form" onSubmit={event=>void save(event)}><h3>Editar {editing.title} · revisão {editing.revision}</h3>
   <label>Título<input required maxLength={200} value={editing.title} onChange={event=>field("title",event.target.value)}/></label>
   <label>Contexto<textarea maxLength={4000} value={editing.details} onChange={event=>field("details",event.target.value)}/></label>
   <label>Estado<select value={editing.status} onChange={event=>field("status",event.target.value)}>{availableStages.filter(status=>status!=="won").map(status=><option key={status} value={status}>{stages[status]}</option>)}</select></label>
   <label>Próxima ação<textarea required maxLength={1000} value={editing.next_action} onChange={event=>field("next_action",event.target.value)}/></label>
   <label>Prazo ISO com fuso<input placeholder="2026-10-23T18:00:00-03:00" value={editing.next_action_at??""} onChange={event=>field("next_action_at",event.target.value||null)}/></label>
   <label>Espera<select value={editing.waiting_kind??""} onChange={event=>field("waiting_kind",event.target.value||null)}><option value="">Sem espera</option><option value="team">Equipe</option><option value="owner">Proprietário</option><option value="client">Cliente</option><option value="external">Fonte externa</option></select></label>
   <label>Tarefa vinculada<select value={editing.work_task_id??""} onChange={event=>field("work_task_id",event.target.value?Number(event.target.value):null)}><option value="">Sem tarefa</option>{data.tasks.filter(task=>task.client_ref_id===editing.client_id&&(!editing.project_id||task.project_ref_id===editing.project_id)).map(task=><option key={task.id} value={task.id}>#{task.id} · {task.title}</option>)}</select></label>
   <label>Evidência<textarea required={editing.status==="completed"} maxLength={2000} value={editing.evidence??""} onChange={event=>field("evidence",event.target.value||null)}/></label>
   {editing.status==="lost"&&<label>Motivo da perda<textarea required maxLength={1000} value={editing.loss_reason??""} onChange={event=>field("loss_reason",event.target.value||null)}/></label>}
   <label>Motivo da alteração<textarea required minLength={3} maxLength={1000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
   <button disabled={busy} type="submit">Salvar registro</button><button disabled={busy} type="button" onClick={()=>setEditing(null)}>Cancelar edição</button>
  </form>}
  {currentTask&&<TaskDetailPanel key={currentTask.id} task={currentTask} data={data} reload={reload} onClose={()=>setTaskId(null)}/>}
  <details><summary>Histórico de alterações</summary><ul>{(data.departmentHistory??[]).filter(event=>rows.some(row=>row.id===event.entity_id)).map(event=><li key={String(event.id)}>{new Date(String(event.at)).toLocaleString("pt-BR")} · {data.people.find(person=>person.id===event.actor_person_id)?.name??"Pessoa cadastrada"} · {String(event.reason)}<details><summary>Antes e depois</summary><pre>{JSON.stringify({antes:event.prior_value,depois:event.new_value},null,2)}</pre></details></li>)}</ul></details>
 </Panel>;
}
