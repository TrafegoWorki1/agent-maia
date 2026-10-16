import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./store.ts";
import { identityByNumber, hasPermission } from "./panelIdentity.ts";
import { canAccessTask, collaborationView, executeCollaborationCommand, scopedWorkTasksView, type CollaborativeTask } from "./collaborativeWork.ts";
import { consumeWorkToolPermit } from "./workToolPermit.ts";
import { departmentPayloadSchema, executeDepartmentCommand } from "./departmentWork.ts";

export const workStatus = z.enum(["pendente", "em_andamento", "concluida"]);
export const workTipo = z.enum(["melhoria", "bug", "conteudo", "operacional", "outro"]);
// Fuso explícito evita gravar horário local como UTC silenciosamente.
export const timestamp = z.string().refine((s) => /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)), "Use data ISO com fuso, ex.: 2026-10-11T09:00:00-03:00");
export const createWorkSchema = z.object({
  titulo: z.string().trim().min(1).max(200), responsavel: z.string().trim().min(1).max(100),
  prazo: timestamp.nullable().optional(), chave: z.string().min(1).max(200).optional(),
  tipo: workTipo.optional(),
  responsavel_pessoa_id:z.string().uuid().optional(),equipe_id:z.string().uuid().optional(),cliente_id:z.string().uuid().optional(),projeto_id:z.string().uuid().optional(),
  entregavel_id:z.string().uuid().optional(),area:z.string().max(80).optional(),revisor_id:z.string().uuid().optional(),aprovador_id:z.string().uuid().optional(),objetivo:z.string().max(2000).optional(),briefing:z.string().max(8000).optional(),criterios_aceite:z.string().max(4000).optional(),esforco_horas:z.number().min(0).max(10000).optional(),
});
export const updateWorkSchema = z.object({
  id: z.number().int().positive(), revisao: z.number().int().positive(),
  titulo: z.string().trim().min(1).max(200).optional(), responsavel: z.string().trim().min(1).max(100).optional(),
  status: workStatus.optional(), prazo: timestamp.nullable().optional(), evidencia: z.string().trim().min(1).max(2000).optional(),
  tipo: workTipo.nullable().optional(),
  estado:z.enum(["pending","in_progress","review","awaiting_approval","blocked","completed","cancelled"]).optional(),
  motivo:z.string().trim().min(1).max(2000).optional(),espera:z.enum(["team","owner","client","external"]).optional(),
  resultado_revisao:z.enum(["approved","returned"]).optional(),motivo_devolucao:z.enum(["error","quality","incomplete_brief","scope_change"]).optional(),
  aprovar:z.boolean().optional(),
  objetivo:z.string().max(2000).optional(),briefing:z.string().max(8000).optional(),criterios_aceite:z.string().max(4000).optional(),esforco_horas:z.number().min(0).max(10000).nullable().optional(),
  prioridade:z.number().int().min(1).max(5).optional(),responsavel_pessoa_id:z.string().uuid().optional(),equipe_id:z.string().uuid().optional(),
}).refine((a) => a.status !== "concluida" || !!a.evidencia, "Concluir exige evidência do trabalho entregue");
export const reminderSchema = z.object({ tarefa_id: z.number().int().positive(), horario: timestamp, chave: z.string().min(1).max(200).optional() });
export const editReminderSchema = z.object({ id: z.number().int().positive(), cancelar: z.boolean().optional(), horario: timestamp.optional() })
  .refine((a) => a.cancelar === true || !!a.horario, "Informe novo horário ou cancelar");

export interface WorkTask {
  id: number; title: string; responsible: string; status: "pendente" | "em_andamento" | "concluida";
  due_at: string | null; revision: number; completion_evidence: string | null; completed_at: string | null; updated_at: string;
  tipo: "melhoria" | "bug" | "conteudo" | "operacional" | "outro" | null;
}
export function isOverdue(t: Pick<WorkTask, "status" | "due_at">, now = new Date()): boolean {
  return t.status !== "concluida" && !!t.due_at && Date.parse(t.due_at) < now.getTime();
}
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
export function requestKey(prefix: string, input: unknown) {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
}
export async function createWorkTask(db: Db, input: unknown, sourceTaskId?: number) {
  const a = createWorkSchema.parse(input);
  const key = a.chave ?? requestKey(`exec:${sourceTaskId ?? 0}`, a);
  if (!a.chave && !sourceTaskId) throw new Error("Criação exige chave de idempotência");
  const row = { title: a.titulo, responsible: a.responsavel, due_at: a.prazo ?? null, request_key: key, source_task_id: sourceTaskId || null, ...(a.tipo ? { tipo: a.tipo } : {}) };
  const inserted = await db.from("work_tasks").upsert(row, { onConflict: "request_key", ignoreDuplicates: true }).select("*");
  check(inserted.error);
  const existing = inserted.data?.[0] ?? (await db.from("work_tasks").select("*").eq("request_key", key).single()).data;
  if (!existing) throw new Error("Não consegui conferir a tarefa criada");
  return existing as WorkTask;
}
export async function updateWorkTask(db: Db, input: unknown) {
  const a = updateWorkSchema.parse(input);
  const patch: Record<string, unknown> = {};
  for (const [from, to] of [["titulo","title"],["responsavel","responsible"],["status","status"],["prazo","due_at"],["evidencia","completion_evidence"],["tipo","tipo"]] as const) {
    if (a[from] !== undefined) patch[to] = a[from];
  }
  if (!Object.keys(patch).length) throw new Error("Nenhuma alteração informada");
  const r = await db.from("work_tasks").update(patch).eq("id", a.id).eq("revision", a.revisao).is("responsible_person_id",null).select("*").maybeSingle();
  check(r.error);
  if (!r.data) throw new Error("Tarefa inexistente, alterada por outra pessoa ou colaborativa; consulte Meu dia para usar o fluxo e a revisão atuais");
  return r.data as WorkTask;
}
export async function createReminder(db: Db, input: unknown, sourceTaskId?: number) {
  const a = reminderSchema.parse(input);
  if (Date.parse(a.horario) <= Date.now()) throw new Error("O lembrete precisa de um horário futuro");
  if (!a.chave && !sourceTaskId) throw new Error("Lembrete exige chave de idempotência");
  const t = await db.from("work_tasks").select("status").eq("id", a.tarefa_id).single();
  check(t.error);
  if (t.data?.status === "concluida") throw new Error("A tarefa já está concluída");
  const r = await db.from("task_reminders").upsert({ work_task_id: a.tarefa_id, run_at: a.horario, kind: "manual", request_key: a.chave ?? requestKey(`lembrete:${sourceTaskId}`, a) }, { onConflict: "request_key", ignoreDuplicates: true }).select("*");
  check(r.error);
  return r.data;
}
export async function editReminder(db: Db, input: unknown) {
  const a = editReminderSchema.parse(input);
  if (!a.cancelar && Date.parse(a.horario!) <= Date.now()) throw new Error("Use um horário futuro");
  const r = await db.from("task_reminders").update(a.cancelar ? { status: "cancelled", finished_at: new Date().toISOString() } : { run_at: a.horario })
    .eq("id", a.id).eq("status", "pending").select("*").maybeSingle();
  check(r.error);
  if (!r.data) throw new Error("Lembrete inexistente ou já em envio/encerrado; não repetido");
  return r.data;
}
export async function workTasksView(db: Db, now = new Date()) {
  const [tasks, reminders] = await Promise.all([
    db.from("work_tasks").select("*").order("id", { ascending: false }).limit(200),
    db.from("task_reminders").select("id,work_task_id,run_at,kind,status,message_id,error").order("run_at", { ascending: false }).limit(200),
  ]);
  check(tasks.error); check(reminders.error);
  return { tasks: (tasks.data as WorkTask[]).map((t) => ({ ...t, overdue: isOverdue(t, now) })), reminders: reminders.data ?? [], limit: 200 };
}

async function createAuthorizedTask(db:Db,input:unknown,sourceTaskId:number|undefined,requesterNumber:string,oneTimeApproval=false){
  const a=createWorkSchema.parse(input),identity=await identityByNumber(db,requesterNumber);
  if(!identity.owner&&identity.permissionModes.get("tarefas.criar")==="bloqueado")throw new Error("Criação bloqueada individualmente");
  // Esta função só é chamada pelo adaptador MCP depois da política do agente permitir
  // a chamada ou consumir o OK pontual vinculado a este payload.
  if(!identity.owner&&!hasPermission(identity,"tarefas.criar",a.cliente_id??null)&&!oneTimeApproval)throw new Error("Sem permissão para criar tarefa");
  const responsibleId=a.responsavel_pessoa_id??identity.personId;
  if(!identity.owner&&responsibleId!==identity.personId&&!identity.teams.some(team=>team.id===a.equipe_id&&team.membershipRole==="coordenador")&&!identity.roles.some((r)=>r.role==="coordenador"&&r.teamId===a.equipe_id))throw new Error("Responsável fora do escopo coordenado");
  if(!identity.owner&&a.equipe_id&&!identity.teams.some((team)=>team.id===a.equipe_id)&&!identity.roles.some((r)=>r.teamId===a.equipe_id))throw new Error("Equipe fora do escopo autorizado");
  if(a.equipe_id){
    const team=await db.from("work_teams").select("id,active").eq("id",a.equipe_id).maybeSingle();check(team.error);
    if(!team.data?.active)throw new Error("Equipe não encontrada ou inativa");
    if(!identity.owner&&responsibleId!==identity.personId){
      const member=await db.from("work_team_members").select("person_id").eq("team_id",a.equipe_id).eq("person_id",responsibleId).eq("active",true).maybeSingle();check(member.error);
      if(!member.data)throw new Error("Responsável não pertence à equipe escolhida");
    }
  }
  if(!identity.owner&&a.projeto_id){
    const project=await db.from("work_projects").select("id,client_id,responsible_team_id").eq("id",a.projeto_id).maybeSingle();check(project.error);
    if(!project.data)throw new Error("Projeto não encontrado");
    if(a.cliente_id&&String(project.data.client_id)!==a.cliente_id)throw new Error("Projeto e cliente informados não correspondem");
    if(!identity.roles.some((r)=>r.projectId===a.projeto_id||r.clientId===String(project.data!.client_id))
      &&!identity.groupPermissions.some((grant)=>grant.code==="tarefas.criar"&&(grant.clientId===null||grant.clientId===String(project.data!.client_id))))throw new Error("Projeto fora do escopo autorizado");
  }
  if(!identity.owner&&a.cliente_id&&!identity.roles.some((r)=>r.clientId===a.cliente_id||r.projectId===a.projeto_id)
    &&!identity.groupPermissions.some((grant)=>grant.code==="tarefas.criar"&&(grant.clientId===null||grant.clientId===a.cliente_id)))throw new Error("Cliente fora do escopo autorizado");
  const peopleIds=[...new Set([responsibleId,...[a.revisor_id,a.aprovador_id].filter((id):id is string=>!!id)])];
  const people=await db.from("people").select("id,name,active").in("id",peopleIds);check(people.error);
  const activePeople=new Map((people.data??[]).filter((row)=>row.active).map((row)=>[String(row.id),row]));
  const person=activePeople.get(responsibleId);
  if(!person)throw new Error("Responsável não corresponde a uma pessoa ativa");
  for(const reviewerId of [a.revisor_id,a.aprovador_id].filter((id):id is string=>!!id)){
    if(!activePeople.has(reviewerId))throw new Error("Revisor ou aprovador não corresponde a uma pessoa ativa");
    if(!identity.owner&&reviewerId!==identity.personId&&!identity.teams.some(team=>team.id===a.equipe_id&&team.membershipRole==="coordenador")&&!identity.roles.some(role=>role.role==="coordenador"&&role.teamId===a.equipe_id))throw new Error("Somente a coordenação pode designar revisor ou aprovador");
  }
  const key=a.chave??requestKey(`exec:${sourceTaskId??0}`,a);if(!a.chave&&!sourceTaskId)throw new Error("Criação exige chave de idempotência");
  const inserted=await db.from("work_tasks").upsert({title:a.titulo,responsible:String(person.name),responsible_person_id:responsibleId,responsible_team_id:a.equipe_id??null,reviewer_person_id:a.revisor_id??null,approver_person_id:a.aprovador_id??null,deliverable_id:a.entregavel_id??null,area:a.area??null,client_ref_id:a.cliente_id??null,project_ref_id:a.projeto_id??null,objective:a.objetivo??null,briefing:a.briefing??null,acceptance_criteria:a.criterios_aceite??null,estimated_effort_hours:a.esforco_horas??null,due_at:a.prazo??null,committed_due_at:a.prazo??null,request_key:key,source_task_id:sourceTaskId||null,origin_kind:"whatsapp",created_by_person_id:identity.personId,...(a.tipo?{tipo:a.tipo}:{})},{onConflict:"request_key",ignoreDuplicates:true}).select("*");check(inserted.error);
  const result=inserted.data?.[0]??(await db.from("work_tasks").select("*").eq("request_key",key).single()).data;
  if(!result)throw new Error("Não consegui conferir a tarefa criada");return result;
}

async function updateAuthorizedTask(db:Db,input:unknown,requesterNumber:string,oneTimeApproval=false){
  const a=updateWorkSchema.parse(input),identity=await identityByNumber(db,requesterNumber);
  const found=await db.from("work_tasks").select("*").eq("id",a.id).maybeSingle();check(found.error);if(!found.data)throw new Error("Tarefa não encontrada");
  const task=found.data as CollaborativeTask;
  if(identity.owner&&task.origin_kind==="legacy"&&!task.responsible_person_id&&!a.estado&&!a.resultado_revisao&&!a.aprovar&&!a.responsavel_pessoa_id&&!a.equipe_id&&!a.prioridade)return updateWorkTask(db,input);
  let operation:"status"|"review"|"approve"|"edit"|"reassign"|"prioritize"="status",payload:Record<string,unknown>={};
  if(a.responsavel!==undefined&&!a.responsavel_pessoa_id)throw new Error("Use o ID da pessoa cadastrada; nome não identifica responsável com segurança");
  if(a.aprovar){operation="approve";payload={evidence:a.evidencia};}
  else if(a.resultado_revisao){operation="review";payload={outcome:a.resultado_revisao,return_reason:a.motivo_devolucao,comment:a.evidencia??a.motivo};}
  else if(a.responsavel_pessoa_id||a.equipe_id){operation="reassign";payload={person_id:a.responsavel_pessoa_id,team_id:a.equipe_id,reason:a.motivo};}
  else if(a.prioridade!==undefined){operation="prioritize";payload={priority:a.prioridade,reason:a.motivo};}
  else if(a.titulo!==undefined||a.prazo!==undefined||a.objetivo!==undefined||a.briefing!==undefined||a.criterios_aceite!==undefined||a.esforco_horas!==undefined){operation="edit";payload=Object.fromEntries(Object.entries({title:a.titulo,committed_due_at:a.prazo,objective:a.objetivo,briefing:a.briefing,acceptance_criteria:a.criterios_aceite,estimated_effort_hours:a.esforco_horas,reason:a.motivo}).filter(([,value])=>value!==undefined));}
  else {const state=a.estado??(a.status==="em_andamento"?"in_progress":a.status==="concluida"?"completed":a.status==="pendente"?"pending":undefined);if(!state)throw new Error("Informe o estado colaborativo");payload={status:state,reason:a.motivo,waiting_kind:a.espera,evidence:a.evidencia};}
  const capability=operation==="review"?"trabalho.revisar":operation==="approve"?"trabalho.aprovar":operation==="reassign"?"trabalho.redistribuir":operation==="prioritize"?"trabalho.planejar":"trabalho.atualizar";
  if(identity.permissionModes.get(capability)==="bloqueado")throw new Error("Acesso bloqueado individualmente");
  if(!canAccessTask(identity,task,capability,oneTimeApproval))throw new Error("Tarefa fora do escopo autorizado");
  return executeCollaborationCommand(db,identity,{action:"task_action",taskId:a.id,revision:a.revisao,operation,payload},"whatsapp",oneTimeApproval);
}

// Os dois SDKs recebem os mesmos schemas e executores; nenhuma chave vai ao modelo.
export const workTools = [
  {name:"area_registro_salvar",description:"Cria pelo WhatsApp ou atualiza oportunidade comercial/combinado de CS com cliente e pessoa por IDs reais, próxima ação, origem e revisão. Consulte trabalho_contexto; não use memória como autorização. Não cria uma tarefa duplicada. Exige capacidade vigente, não aceita OK como concessão permanente.",schema:z.object({kind:z.enum(["opportunity","cs"]),id:z.string().uuid().optional(),revision:z.number().int().positive().optional(),payload:departmentPayloadSchema,reason:z.string().min(3).max(1000)}),run:async(db:Db,a:unknown,taskId?:number,requesterNumber?:string)=>{requireWorkPermit("area_registro_salvar",a,taskId,requesterNumber);const identity=await identityByNumber(db,requesterNumber!);return executeDepartmentCommand(db,identity,{...(a as object),action:"department_save"},"whatsapp",taskId);}},
  {name:"oportunidade_converter",description:"Converte oportunidade qualificada em projeto da mesma carteira, atomicamente e sem duplicar em retomadas. Exige competência de planejamento e escopo vigente; não publica nem contrata serviços externos.",schema:z.object({id:z.string().uuid(),revision:z.number().int().positive(),reason:z.string().min(3).max(1000)}),run:async(db:Db,a:unknown,taskId?:number,requesterNumber?:string)=>{requireWorkPermit("oportunidade_converter",a,taskId,requesterNumber);return executeDepartmentCommand(db,await identityByNumber(db,requesterNumber!),{...(a as object),action:"opportunity_convert"},"whatsapp",taskId);}},
  { name: "tarefas_listar", description: "Lista tarefas reais somente no escopo autorizado da pessoa, com próximas ações, prazo, revisão, bloqueios e evidências.", schema: z.object({}), run: async (db: Db,a:unknown,taskId?:number,requesterNumber?:string) => { const permit=requireWorkPermit("tarefas_listar",a,taskId,requesterNumber); return scopedWorkTasksView(db,await identityByNumber(db,requesterNumber!),permit.oneTimeApproval); } },
  { name:"trabalho_contexto",description:"Consulta trabalho autorizado com IDs de pessoas, clientes, equipes, projetos, entregáveis, oportunidades comerciais, combinados de CS, prioridades, compromissos e capacidade. Use para esclarecer o cadastro antes de alterar; memória ou nome parecido não concedem acesso.",schema:z.object({}),run:async(db:Db,a:unknown,taskId?:number,requesterNumber?:string)=>{requireWorkPermit("trabalho_contexto",a,taskId,requesterNumber);const identity=await identityByNumber(db,requesterNumber!);const view=await collaborationView(db,identity,new Date(),"maia");return {tasks:view.tasks,people:view.people,teams:view.teams,projects:view.projects,contracts:view.contracts,clients:view.clients,deliverables:view.deliverables,departmentRecords:view.departmentRecords,departmentHistory:view.departmentHistory,plans:view.plans,planItems:view.planItems,capacity:view.capacity,load:view.load};} },
  { name: "tarefa_criar", description: "Cria tarefa persistida pelo WhatsApp para pessoa/equipe cadastrada. Não associa por semelhança de nome; usa IDs ou o próprio solicitante.", schema: createWorkSchema, run: (db: Db, a: unknown, taskId?: number,requesterNumber?:string) => { const permit=requireWorkPermit("tarefa_criar",a,taskId,requesterNumber); return createAuthorizedTask(db,a,taskId,requesterNumber!,permit.oneTimeApproval); } },
  { name: "tarefa_atualizar", description: "Atualiza estado, bloqueio, revisão ou conclusão no escopo autorizado. Exige revisão atual e evidência para concluir; aprovar qualidade não autoriza publicação.", schema: updateWorkSchema, run: (db: Db, a: unknown,taskId?:number,requesterNumber?:string) => { const permit=requireWorkPermit("tarefa_atualizar",a,taskId,requesterNumber); return updateAuthorizedTask(db,a,requesterNumber!,permit.oneTimeApproval); } },
  { name: "lembrete_criar", description: "Agenda lembrete persistido de tarefa ao owner no WhatsApp, com horário ISO e fuso. Não envia a terceiros.", schema: reminderSchema, run: (db: Db, a: unknown, taskId?: number) => createReminder(db, a, taskId) },
  { name: "lembrete_editar", description: "Reagenda ou cancela lembrete ainda pendente. Envios incertos não são repetidos.", schema: editReminderSchema, run: (db: Db, a: unknown) => editReminder(db, a) },
] as const;

function requireWorkPermit(tool:string,args:unknown,taskId:number|undefined,requesterNumber:string|undefined){
  if(!requesterNumber||!taskId)throw new Error("Identidade autenticada e tarefa de execução são obrigatórias");
  const permit=consumeWorkToolPermit({number:requesterNumber,taskId,tool:`mcp__maia__${tool}`,args});
  if(!permit)throw new Error("Chamada da ferramenta sem autorização vigente ou já consumida");
  return permit;
}
