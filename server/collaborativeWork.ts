import { z } from "zod";
import { createHash } from "node:crypto";
import { canManagePortfolio, portfolioCommandSchema, savePortfolio } from "./workPortfolio.ts";
import { departmentSaveSchema, opportunityConvertSchema, executeDepartmentCommand, scopedDepartmentRecords, type DepartmentRecord } from "./departmentWork.ts";
import { calculateDepartmentMetrics } from "../src/lib/departmentMetrics.ts";
import type { Db } from "./store.ts";
import { hasPermission, identityScreens, type PanelIdentity } from "./panelIdentity.ts";

export interface CollaborativeTask {
  id: number; title: string; responsible: string; responsible_person_id: string | null; responsible_team_id: string | null;
  reviewer_person_id: string | null; approver_person_id: string | null; client_ref_id: string | null; project_ref_id: string | null;
  deliverable_id: string | null; area: string | null; objective: string | null; briefing: string | null; acceptance_criteria: string | null;
  workflow_status: "pending" | "in_progress" | "review" | "awaiting_approval" | "blocked" | "completed" | "cancelled";
  priority: number; committed_due_at: string | null; due_at: string | null; started_at: string | null; completed_at: string | null;
  blocked_at: string | null; waiting_kind: string | null; block_reason: string | null; completion_evidence: string | null;
  estimated_effort_hours: number | null; origin_kind: string; source_task_id: number | null; revision: number; updated_at: string;
  planned_week: string | null; added_after_baseline: boolean;
}

type RoleScope = { role: string; teamId: string | null; clientId: string | null; projectId: string | null };

function check(error: { message: string } | null): void { if (error) throw new Error(error.message); }
function scopeMatches(role: RoleScope, task: CollaborativeTask): boolean {
  return (!!role.teamId && role.teamId === task.responsible_team_id) || (!!role.clientId && role.clientId === task.client_ref_id) || (!!role.projectId && role.projectId === task.project_ref_id);
}
function hasTaskScope(identity: PanelIdentity, task: CollaborativeTask): boolean {
  return identity.owner || task.responsible_person_id === identity.personId || identity.teams.some((team) => team.id === task.responsible_team_id && team.membershipRole === "coordenador")
    || identity.roles.some((role) => scopeMatches(role, task) && (role.role === "coordenador" || role.role === "responsavel_cliente" || (!!role.clientId || !!role.projectId) && role.role === "membro")) || task.reviewer_person_id === identity.personId || task.approver_person_id === identity.personId;
}
export function canAccessTask(identity: PanelIdentity, task: CollaborativeTask, capability: string, oneTimeApproval=false): boolean {
  if (identity.owner) return true;
  if (identity.permissionModes.get(capability)==="bloqueado") return false;
  if (!hasPermission(identity, capability, task.client_ref_id) && !oneTimeApproval) return false;
  if (capability === "trabalho.ver" || capability === "indicadores.ver") return hasTaskScope(identity, task);
  if (capability === "trabalho.atualizar") return task.responsible_person_id === identity.personId
    || identity.roles.some((role) => role.role === "coordenador" && scopeMatches(role, task))
    || identity.teams.some((team)=>team.membershipRole==="coordenador"&&team.id===task.responsible_team_id);
  if (capability === "trabalho.revisar") return task.reviewer_person_id === identity.personId
    || identity.roles.some((role) => role.role === "revisor" && scopeMatches(role, task));
  if (capability === "trabalho.aprovar") return task.approver_person_id === identity.personId
    || identity.roles.some((role) => role.role === "aprovador" && scopeMatches(role, task));
  if (capability === "trabalho.planejar" || capability === "trabalho.redistribuir") {
    return identity.roles.some((role) => role.role === "coordenador" && scopeMatches(role, task))
      || identity.teams.some((team)=>team.membershipRole==="coordenador"&&team.id===task.responsible_team_id);
  }
  return false;
}

async function allRows(db: Db, table: string, select: string, orderColumn = "id"): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    const result = await db.from(table).select(select).order(orderColumn, { ascending: true }).range(from, from + 999);
    check(result.error);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) return rows;
  }
}

const TASK_SELECT = "id,title,responsible,responsible_person_id,responsible_team_id,reviewer_person_id,approver_person_id,client_ref_id,project_ref_id,deliverable_id,area,objective,briefing,acceptance_criteria,workflow_status,priority,committed_due_at,due_at,started_at,completed_at,blocked_at,waiting_kind,block_reason,completion_evidence,estimated_effort_hours,origin_kind,source_task_id,revision,updated_at,planned_week,added_after_baseline";

export async function scopedWorkTasksView(db:Db,identity:PanelIdentity,oneTimeApproval=false){
  const tasks=(await allRows(db,"work_tasks",TASK_SELECT)) as CollaborativeTask[];
  return tasks.filter((task)=>canAccessTask(identity,task,"trabalho.ver",oneTimeApproval)).map((task)=>({
    ...task,
    allowedActions:{update:canAccessTask(identity,task,"trabalho.atualizar"),review:canAccessTask(identity,task,"trabalho.revisar"),approve:canAccessTask(identity,task,"trabalho.aprovar"),reassign:canAccessTask(identity,task,"trabalho.redistribuir"),prioritize:canAccessTask(identity,task,"trabalho.planejar")},
  }));
}

export function businessWeek(now:Date){const local=new Date(now.getTime()-3*3_600_000);local.setUTCHours(0,0,0,0);local.setUTCDate(local.getUTCDate()-((local.getUTCDay()+6)%7));const start=new Date(local.getTime()+3*3_600_000);return {start:start.toISOString(),end:new Date(start.getTime()+7*86_400_000-1).toISOString(),startDate:local.toISOString().slice(0,10),endDate:new Date(local.getTime()+6*86_400_000).toISOString().slice(0,10)};}

function hoursBetween(start: string, end: string): number { return Math.max(0, (Date.parse(end) - Date.parse(start)) / 3_600_000); }
function taskIds(tasks: CollaborativeTask[]): number[] { return tasks.map((task) => task.id); }
function metric(code: string, label: string, value: number | null, unit: string, reason: string | null, ids: number[]) {
  return { code, label, value, unit, available: value !== null, unavailableReason: value === null ? reason : null, recordIds: ids };
}

export function calculateMetrics(tasks: CollaborativeTask[], planItems: Array<Record<string, any>>, reviews: Array<Record<string, any>>, now = new Date(), personId?:string,baselineAvailable=planItems.length>0) {
  const monday=new Date(businessWeek(now).start);
  const periodTasks=tasks.filter((task)=>task.workflow_status==="completed"&&task.completed_at&&Date.parse(task.completed_at)>=monday.getTime()&&Date.parse(task.completed_at)<=now.getTime());
  const personal=personId?tasks.filter((task)=>task.responsible_person_id===personId):tasks;
  const closedWithDue = personal.filter((task) => task.workflow_status === "completed" && task.committed_due_at && task.completed_at && Date.parse(task.completed_at)>=monday.getTime());
  const onTime = closedWithDue.filter((task) => Date.parse(task.completed_at!) <= Date.parse(task.committed_due_at!));

  const completed = periodTasks;
  const cycleRows = completed.filter((task) => task.started_at && task.completed_at);
  const baselineIds = new Set(planItems.filter((item) => item.baseline_snapshot && !item.added_after_baseline).map((item) => Number(item.work_task_id)));
  const baselineTasks = tasks.filter((task) => baselineIds.has(task.id));
  const creativeIds=new Set(tasks.filter(task=>["criacao","criação","design","creative"].includes((task.area??"").toLowerCase())).map(task=>task.id));
  const periodReviews=reviews.filter((review)=>creativeIds.has(Number(review.work_task_id))&&Date.parse(String(review.created_at))>=monday.getTime()&&Date.parse(String(review.created_at))<=now.getTime());
  const periodReviewedIds=[...new Set(periodReviews.map((review)=>Number(review.work_task_id)))];
  const firstApproved = periodReviewedIds.filter((id) => {
    const first = reviews.filter((review) => Number(review.work_task_id) === id).sort((a,b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
    return first?.outcome === "approved";
  });
  const blockedAging=tasks.filter(task=>task.workflow_status==="blocked"&&task.blocked_at&&Date.parse(task.blocked_at)<=now.getTime()-48*3_600_000);
  const unplanned=tasks.filter(task=>task.added_after_baseline);
  return [
    metric("individual.commitment_rate","Compromissos cumpridos",closedWithDue.length ? Math.round(onTime.length / closedWithDue.length * 1000) / 10 : null,"%", "Sem compromissos concluídos com prazo no escopo.",taskIds(closedWithDue)),
    metric("individual.open_wip","Trabalho em andamento",personal.filter((task)=>["in_progress","review","awaiting_approval"].includes(task.workflow_status)).length,"itens",null,taskIds(personal.filter((task)=>["in_progress","review","awaiting_approval"].includes(task.workflow_status)))),
    metric("team.throughput","Entregas no período",completed.length,"entregas",null,taskIds(completed)),
    metric("team.cycle_time","Tempo de ciclo",cycleRows.length ? Math.round(cycleRows.reduce((sum,task) => sum + hoursBetween(task.started_at!,task.completed_at!),0) / cycleRows.length * 10) / 10 : null,"horas","Sem tarefas concluídas com início e conclusão registrados.",taskIds(cycleRows)),
    metric("team.predictability","Previsibilidade da baseline",baselineTasks.length ? Math.round(baselineTasks.filter((task) => task.workflow_status === "completed").length / baselineTasks.length * 1000) / 10 : null,"%","Nenhuma baseline semanal disponível.",taskIds(baselineTasks)),
    metric("creative.first_review","Aprovação na primeira revisão",periodReviewedIds.length ? Math.round(firstApproved.length / periodReviewedIds.length * 1000) / 10 : null,"%","Nenhuma revisão registrada no período.",periodReviewedIds),
    metric("team.blocked_aging","Bloqueios com mais de 48 horas",blockedAging.length,"itens",null,taskIds(blockedAging)),
    metric("team.unplanned_after_baseline","Trabalho acrescentado após baseline",baselineAvailable?unplanned.length:null,"itens","Nenhuma baseline semanal disponível.",taskIds(unplanned)),
  ];
}

export function serializeIdentity(identity: PanelIdentity) {
  const accessVersion=createHash("sha256").update(JSON.stringify({personId:identity.personId,owner:identity.owner,direct:[...identity.directPermissions].sort(),modes:[...identity.permissionModes].sort(),grants:identity.groupPermissions.map(row=>JSON.stringify(row)).sort(),teams:identity.teams.map(row=>JSON.stringify(row)).sort(),roles:identity.roles.map(row=>JSON.stringify(row)).sort()})).digest("hex");
  return { accessVersion,personId: identity.personId, name: identity.name, owner: identity.owner, teams: identity.teams, roles: identity.roles,
    screens: identityScreens(identity), permissions: [...new Set([...identity.directPermissions, ...identity.groupPermissions.map((grant) => grant.code)])]
      .filter((code) => identity.permissionModes.get(code) !== "bloqueado") };
}

export async function collaborationView(db: Db, identity: PanelIdentity, now = new Date(),purpose:"panel"|"maia"="panel") {
  if (purpose==="panel"&&!identity.owner && !hasPermission(identity, "painel.ver")) throw new Error("panel_access_denied");
  const [taskRows, people, teams, teamMembers, clients, contracts, projects, scopeRoles, deliverables, dependencies, artifacts, histories, reviews, plans, planItems, planChanges, capacities, metricCatalog, observations, baselines, portfolioHistory, departmentRows] = await Promise.all([
    allRows(db,"work_tasks",TASK_SELECT),
    allRows(db,"people","id,name,role,active","name"),
    allRows(db,"work_teams","id,name,active,revision,access_group_id","name"),
    allRows(db,"work_team_members","team_id,person_id,membership_role,active,created_at","created_at"),
    allRows(db,"maia_clients","id,name,active","name"),
    allRows(db,"work_contracts","id,client_id,name,service_scope,status,starts_on,ends_on,responsible_person_id,responsible_team_id,revision,updated_at","name"),
    allRows(db,"work_projects","id,client_id,contract_id,name,objective,status,responsible_person_id,responsible_team_id,starts_on,due_on,revision,updated_at","name"),
    allRows(db,"work_scope_roles","id,person_id,role,team_id,client_id,project_id,active,created_at","created_at"),
    allRows(db,"work_deliverables","id,project_id,title,objective,acceptance_criteria,status,due_at,completed_at,revision,updated_at","title"),
    allRows(db,"work_task_dependencies","task_id,depends_on_task_id,created_at","task_id"),
    allRows(db,"work_task_artifacts","id,work_task_id,added_by,label,uri,evidence_kind,created_at","created_at"),
    allRows(db,"work_task_history","id,work_task_id,at,actor_person_id,actor_origin,event_type,from_value,to_value,reason,evidence,revision","id"),
    allRows(db,"work_task_reviews","id,work_task_id,reviewer_person_id,outcome,return_reason,comment,created_at","created_at"),
    allRows(db,"work_plans","id,period_kind,period_start,period_end,team_id,client_id,project_id,objective,status,baseline_at,baseline_by,revision,updated_at","period_start"),
    allRows(db,"work_plan_items","plan_id,work_task_id,planned_priority,committed_effort_hours,baseline_snapshot,added_after_baseline,created_at","created_at"),
    allRows(db,"work_plan_changes","id,plan_id,changed_by,changed_at,change_kind,reason,affected_task_ids,prior_value,new_value","id"),
    allRows(db,"work_capacity","id,person_id,team_id,week_start,available_hours,absence_hours,note,revision,updated_at","week_start"),
    allRows(db,"metric_catalog","code,label,level,formula,population,period,source,unit,target,coverage_rule,financial,active","code"),
    allRows(db,"external_metric_observations","id,metric_code,client_id,project_id,period_start,period_end,value,unit,source_name,source_ref,last_attempt_at,last_success_at,unavailable_reason,created_at","created_at"),
    allRows(db,"work_plan_baselines","plan_id,task_snapshots,created_by,created_at","plan_id"),
    allRows(db,"work_portfolio_history","id,entity_kind,entity_id,actor_person_id,at,reason,prior_value,new_value","id"),
    allRows(db,"work_department_records","*"),
  ]);
  const departmentRecords=scopedDepartmentRecords(identity,departmentRows as DepartmentRecord[]);
  const departmentIds=new Set(departmentRecords.map(row=>row.id));
  const tasks = (taskRows as CollaborativeTask[]).filter((task) => canAccessTask(identity,task,"trabalho.ver")).map((task) => ({ ...task,
    allowedActions: {
      update: canAccessTask(identity,task,"trabalho.atualizar"), review: canAccessTask(identity,task,"trabalho.revisar"),
      approve: canAccessTask(identity,task,"trabalho.aprovar"), reassign: canAccessTask(identity,task,"trabalho.redistribuir"),
      prioritize: canAccessTask(identity,task,"trabalho.planejar"),
    },
  }));
  const ids = new Set(taskIds(tasks));
  const visibleHistories = histories.filter((row) => ids.has(Number(row.work_task_id)));
  const visibleReviews = reviews.filter((row) => ids.has(Number(row.work_task_id)));
  const planScope=(plan:Record<string,any>)=>identity.owner||identity.teams.some(team=>team.id===plan.team_id&&team.membershipRole==="coordenador")||identity.roles.some(role=>!!role.teamId&&role.teamId===plan.team_id&&role.role==="coordenador"||!!role.clientId&&role.clientId===plan.client_id&&role.role!=="financeiro"||!!role.projectId&&role.projectId===plan.project_id&&role.role!=="financeiro");
  const canPlanTeam=(teamId:string)=>identity.owner||hasPermission(identity,"trabalho.planejar")&&(identity.teams.some(team=>team.id===teamId&&team.membershipRole==="coordenador")||identity.roles.some(role=>role.role==="coordenador"&&role.teamId===teamId));
  const visiblePlans=plans.filter(plan=>planScope(plan)||planItems.some(item=>item.plan_id===plan.id&&ids.has(Number(item.work_task_id)))).map(plan=>planScope(plan)?plan:{...plan,objective:"Compromissos atribuídos",client_id:null,project_id:null});
  const visiblePlanIds=new Set(visiblePlans.map(plan=>String(plan.id)));
  const visiblePlanItems=planItems.filter(row=>visiblePlanIds.has(String(row.plan_id))&&ids.has(Number(row.work_task_id)));
  const week=businessWeek(now);
  const baselinePlanIds=new Set(visiblePlans.filter(plan=>plan.period_kind==="weekly"&&plan.baseline_at&&String(plan.period_start)<=week.endDate&&String(plan.period_end)>=week.startDate).map(plan=>String(plan.id)));
  const metricPlanItems=baselines.filter(b=>baselinePlanIds.has(String(b.plan_id))).flatMap(b=>(Array.isArray(b.task_snapshots)?b.task_snapshots:[]).filter((s:Record<string,any>)=>ids.has(Number(s.id))).map((s:Record<string,any>)=>({work_task_id:Number(s.id),baseline_snapshot:s,added_after_baseline:false})));
  for(const task of tasks)task.added_after_baseline=visiblePlanItems.some(item=>Number(item.work_task_id)===task.id&&item.added_after_baseline&&baselinePlanIds.has(String(item.plan_id)));
  const canViewMetrics=identity.owner||tasks.some(task=>canAccessTask(identity,task,"indicadores.ver"))||hasPermission(identity,"indicadores.ver")||departmentRecords.some(row=>row.canViewMetrics);
  const relevantPeople = new Set<string>([identity.personId]);
  for (const task of tasks) for (const value of [task.responsible_person_id,task.reviewer_person_id,task.approver_person_id]) if (value) relevantPeople.add(value);
  const teamIds = new Set(tasks.map((task) => task.responsible_team_id).filter(Boolean));
  for (const team of identity.teams) teamIds.add(team.id);
  for (const role of identity.roles) if(role.teamId) teamIds.add(role.teamId);
  for (const member of teamMembers) if (teamIds.has(String(member.team_id)) && member.active) relevantPeople.add(String(member.person_id));
  const explicitClientIds=new Set(identity.roles.filter(role=>role.clientId&&role.role!=="financeiro"&&hasPermission(identity,"trabalho.ver",role.clientId)).map(role=>role.clientId!));
  const explicitProjectIds=new Set(identity.roles.filter(role=>role.projectId&&role.role!=="financeiro").map(role=>role.projectId!));
  const visibleProjects=projects.filter(project=>identity.owner||hasPermission(identity,"trabalho.ver",String(project.client_id))&&(explicitClientIds.has(String(project.client_id))||explicitProjectIds.has(String(project.id))||tasks.some(task=>task.project_ref_id===project.id)||identity.teams.some(team=>team.id===project.responsible_team_id&&team.membershipRole==="coordenador")||identity.roles.some(role=>role.role==="coordenador"&&!!role.teamId&&role.teamId===project.responsible_team_id)));
  for(const project of projects)if(!visibleProjects.includes(project)&&departmentRecords.some(row=>row.project_id===project.id||row.converted_project_id===project.id))visibleProjects.push(project);
  const projectIds=new Set(visibleProjects.map(project=>String(project.id)));
  const clientIds=new Set([...explicitClientIds,...tasks.map(task=>task.client_ref_id).filter((id):id is string=>!!id),...visibleProjects.map(project=>String(project.client_id))]);
  for(const row of departmentRecords){clientIds.add(row.client_id);relevantPeople.add(row.responsible_person_id);if(row.responsible_team_id)teamIds.add(row.responsible_team_id);}
  const visibleContracts=contracts.filter(contract=>identity.owner||explicitClientIds.has(String(contract.client_id))||visibleProjects.some(project=>project.contract_id===contract.id));
  const visibleDeliverables=deliverables.filter(row=>identity.owner||explicitProjectIds.has(String(row.project_id))||visibleProjects.some(project=>project.id===row.project_id&&canManagePortfolio(identity,String(project.client_id),String(project.id),project.responsible_team_id?String(project.responsible_team_id):null))||tasks.some(task=>task.deliverable_id===row.id));
  const portfolioIds=new Set([...visibleContracts,...visibleProjects,...visibleDeliverables].map(row=>String(row.id)));
  const canReadFinancialCatalog=identity.owner||identity.roles.some(role=>role.role==="financeiro"&&(role.clientId||role.projectId)&&hasPermission(identity,"financeiro.ver",role.clientId??projects.find(project=>project.id===role.projectId)?.client_id??null));
  const visibleCatalog=metricCatalog.filter(row=>row.active&&(!row.financial||canReadFinancialCatalog));
  const metricTasks=tasks.filter(task=>identity.owner||canAccessTask(identity,task,"indicadores.ver"));
  const completeMetrics=(personId?:string)=>{const calculated=calculateMetrics(metricTasks,metricPlanItems,visibleReviews,now,personId,baselinePlanIds.size>0);const codes=new Set(calculated.map(row=>row.code));return [...calculated,...visibleCatalog.filter(row=>!codes.has(String(row.code))&&row.source!=="work_department_records").map(row=>metric(String(row.code),String(row.label),null,String(row.unit),String(row.coverage_rule),[]))];};
  const visibleObservations=observations.filter(row=>{if(identity.owner)return true;const catalog=visibleCatalog.find(item=>item.code===row.metric_code);if(!catalog)return false;const scope=identity.roles.some(role=>(!!role.clientId&&role.clientId===row.client_id||!!role.projectId&&role.projectId===row.project_id)&&(!catalog.financial||role.role==="financeiro"));return scope&&hasPermission(identity,catalog.financial?"financeiro.ver":"indicadores.ver",row.client_id?String(row.client_id):null);});
  const dueSoon = tasks.filter((task) => task.workflow_status !== "completed" && task.workflow_status !== "cancelled" && task.committed_due_at && Date.parse(task.committed_due_at) <= now.getTime()+7*86_400_000);
  const mine = tasks.filter((task) => task.responsible_person_id === identity.personId);
  const myDueSoon = dueSoon.filter((task) => task.responsible_person_id === identity.personId);
  const reviewQueue = tasks.filter((task) => task.workflow_status === "review" && canAccessTask(identity,task,"trabalho.revisar"));
  const approvalQueue = tasks.filter((task) => task.workflow_status === "awaiting_approval" && canAccessTask(identity,task,"trabalho.aprovar"));
  const weeklyPlanIds=new Set(visiblePlans.filter(plan=>plan.period_kind==="weekly"&&String(plan.period_start)<=week.endDate&&String(plan.period_end)>=week.startDate).map(plan=>String(plan.id)));
  const weeklyTaskIds=new Set(visiblePlanItems.filter(item=>weeklyPlanIds.has(String(item.plan_id))).map(item=>Number(item.work_task_id)));
  const load=[...relevantPeople].map(personId=>{
    const open=tasks.filter(task=>task.responsible_person_id===personId&&!["completed","cancelled"].includes(task.workflow_status));
    const assigned=open.filter(task=>weeklyTaskIds.has(task.id)||!!task.committed_due_at&&Date.parse(task.committed_due_at)>=Date.parse(week.start)&&Date.parse(task.committed_due_at)<=Date.parse(week.end));
    const unscheduled=open.filter(task=>!weeklyTaskIds.has(task.id)&&!task.committed_due_at);
    const estimated=assigned.filter(task=>task.estimated_effort_hours!==null);
    const requiredTeams=new Set(assigned.map(task=>task.responsible_team_id).filter(Boolean));
    const weekRows=capacities.filter(row=>row.person_id===personId&&teamIds.has(row.team_id)&&String(row.week_start)===week.startDate);
    const available=weekRows.length&&[...requiredTeams].every(id=>weekRows.some(row=>row.team_id===id))?weekRows.reduce((sum,row)=>sum+Number(row.available_hours)-Number(row.absence_hours),0):null;
    const effort=!unscheduled.length&&estimated.length===assigned.length?estimated.reduce((sum,task)=>sum+Number(task.estimated_effort_hours),0):null;
    return {personId,assigned:assigned.length,estimatedHours:effort,availableHours:available,utilization:effort!==null&&available!==null&&available>0?Math.round(effort/available*1000)/10:null,
     unavailableReason:unscheduled.length?"Há tarefas sem alocação semanal ou prazo.":effort===null?"Há compromissos sem esforço estimado.":available===null?"Disponibilidade da semana incompleta.":available===0?"Sem horas disponíveis nesta semana.":null};
  });

  return {
    generatedAt: now.toISOString(), staleAfterMs: 45_000, identity: serializeIdentity(identity),
    departmentRecords,
    departmentMetrics:canViewMetrics?calculateDepartmentMetrics(departmentRecords,now.toISOString()):[],
    departmentHistory:portfolioHistory.filter(row=>departmentIds.has(String(row.entity_id))&&["opportunity","cs"].includes(String(row.entity_kind))),
    tasks, people: people.filter((person) => relevantPeople.has(String(person.id)) || identity.owner), teamMembers: teamMembers.filter((member) => teamIds.has(String(member.team_id)) || identity.owner),
    teams: teams.filter((team) => teamIds.has(String(team.id)) || identity.teams.some((own) => own.id === team.id) || identity.owner),
    clients: clients.filter((client)=>clientIds.has(String(client.id))||identity.owner),
    scopeRoles: identity.owner?scopeRoles:[],
    contracts: visibleContracts.map(contract=>({...contract,id:String(contract.id),canManage:canManagePortfolio(identity,String(contract.client_id),null,contract.responsible_team_id?String(contract.responsible_team_id):null)})),
    projects: visibleProjects.map(project=>({...project,id:String(project.id),canManage:canManagePortfolio(identity,String(project.client_id),String(project.id),project.responsible_team_id?String(project.responsible_team_id):null)})),
    deliverables: visibleDeliverables.map(row=>({...row,id:String(row.id),canManage:visibleProjects.some(project=>project.id===row.project_id&&canManagePortfolio(identity,String(project.client_id),String(project.id),project.responsible_team_id?String(project.responsible_team_id):null))})),
    portfolioHistory:portfolioHistory.filter(row=>identity.owner||portfolioIds.has(String(row.entity_id))&&row.entity_kind!=="scope_role"),
    dependencies: dependencies.filter((row) => ids.has(Number(row.task_id)) && ids.has(Number(row.depends_on_task_id))),
    artifacts: artifacts.filter((row) => ids.has(Number(row.work_task_id))),
    history: visibleHistories, reviews: visibleReviews, plans: visiblePlans,
    planItems:visiblePlanItems,
    baselines:baselines.filter(row=>visiblePlanIds.has(String(row.plan_id))).map(row=>({...row,task_snapshots:(Array.isArray(row.task_snapshots)?row.task_snapshots:[]).filter((s:Record<string,any>)=>ids.has(Number(s.id)))})),
    planChanges:planChanges.filter(row=>visiblePlanIds.has(String(row.plan_id))).map(row=>({...row,reason:visiblePlans.some(plan=>plan.id===row.plan_id&&canPlanTeam(String(plan.team_id)))?row.reason:"Mudança nos compromissos atribuídos",prior_value:visiblePlans.some(plan=>plan.id===row.plan_id&&canPlanTeam(String(plan.team_id)))?row.prior_value:null,new_value:visiblePlans.some(plan=>plan.id===row.plan_id&&canPlanTeam(String(plan.team_id)))?row.new_value:null,affected_task_ids:(Array.isArray(row.affected_task_ids)?row.affected_task_ids:[]).filter((id:number)=>ids.has(Number(id)))})),
    capacity:capacities.filter(row=>identity.owner||row.person_id===identity.personId||canPlanTeam(String(row.team_id))).map(row=>({...row,note:identity.owner||row.person_id===identity.personId||canPlanTeam(String(row.team_id))?row.note:null})),load,
    dashboards: {
      myDay: { priorities: mine.filter((task) => !["completed","cancelled"].includes(task.workflow_status)).sort((a,b) => a.priority-b.priority), dueSoon:myDueSoon, blocked:mine.filter((task) => task.workflow_status === "blocked"), reviews:reviewQueue, approvals:approvalQueue },
      team: { tasks, blocked:tasks.filter((task) => task.workflow_status === "blocked"), load },
      coordination: { deadlineRisks:dueSoon, reviewQueue, approvalQueue, unplanned:tasks.filter((task) => task.added_after_baseline) },
      direction: identity.owner ? { tasks, metrics:completeMetrics() } : null,
    },
    metrics:canViewMetrics?completeMetrics(identity.personId):[],metricCatalog:canViewMetrics?visibleCatalog:visibleCatalog.filter(row=>row.financial),
    externalMetrics:visibleObservations,
    planningTeamIds:teams.filter(team=>team.active&&canPlanTeam(String(team.id))).map(team=>String(team.id)),
    portfolioClientIds:clients.filter(client=>canManagePortfolio(identity,String(client.id),null,null)).map(client=>String(client.id)),

  };
}

const taskActionSchema = z.object({ action:z.literal("task_action"), taskId:z.number().int().positive(), revision:z.number().int().positive(), operation:z.enum(["status","review","approve","reassign","prioritize","edit","comment","artifact","dependency"]), payload:z.record(z.string(),z.unknown()) });
const capacitySchema = z.object({ action:z.literal("capacity_save"), personId:z.string().uuid(), teamId:z.string().uuid(), weekStart:z.string().date(), availableHours:z.number().min(0).max(168), absenceHours:z.number().min(0).max(168).default(0), note:z.string().max(500).optional(), revision:z.number().int().positive().optional() });
const planSchema = z.object({ action:z.literal("plan_save"), id:z.string().uuid().optional(), revision:z.number().int().positive().optional(), periodKind:z.enum(["monthly","weekly","daily"]), periodStart:z.string().date(), periodEnd:z.string().date(), teamId:z.string().uuid(), objective:z.string().max(1000).optional(), taskIds:z.array(z.number().int().positive()).max(300), baseline:z.boolean().default(false),reason:z.string().trim().min(3).max(500).optional() }).refine((value) => !value.id || !!value.revision,"Edição de plano exige revisão");
const teamSchema = z.object({ action:z.literal("team_save"), id:z.string().uuid().optional(), revision:z.number().int().positive().optional(), name:z.string().trim().min(1).max(100), accessGroupId:z.string().uuid().nullable().optional(), active:z.boolean().default(true), members:z.array(z.object({ personId:z.string().uuid(), role:z.enum(["membro","coordenador"]) })).max(200) }).refine((value) => !value.id || !!value.revision,"Edição de equipe exige revisão");
const roleSchema = z.object({ action:z.literal("scope_role_save"), personId:z.string().uuid(), role:z.enum(["membro","coordenador","responsavel_cliente","revisor","aprovador","financeiro"]), teamId:z.string().uuid().nullable().optional(), clientId:z.string().uuid().nullable().optional(), projectId:z.string().uuid().nullable().optional(), active:z.boolean().default(true) });
export const collaborationCommandSchema = z.discriminatedUnion("action",[taskActionSchema,capacitySchema,planSchema,teamSchema,roleSchema,portfolioCommandSchema,departmentSaveSchema,opportunityConvertSchema]);

export async function executeCollaborationCommand(db: Db, identity: PanelIdentity, raw: unknown, origin:"panel"|"whatsapp"|"maia"="panel", oneTimeApproval=false) {
  if(origin==="panel"&&!identity.owner&&!hasPermission(identity,"painel.ver"))throw new Error("Acesso ao painel revogado");
  const command = collaborationCommandSchema.parse(raw);
  if(command.action==="department_save"||command.action==="opportunity_convert")return executeDepartmentCommand(db,identity,command,origin);
  if(command.action==="portfolio_save")return savePortfolio(db,identity,command);
  if (command.action === "task_action") {
    const taskResult = await db.from("work_tasks").select(TASK_SELECT).eq("id",command.taskId).maybeSingle(); check(taskResult.error);
    if (!taskResult.data) throw new Error("Tarefa não encontrada");
    const task = taskResult.data as CollaborativeTask;
    const capability = command.operation === "review" ? "trabalho.revisar" : command.operation === "approve" ? "trabalho.aprovar" : command.operation === "reassign" ? "trabalho.redistribuir" : ["prioritize","dependency"].includes(command.operation) ? "trabalho.planejar" : "trabalho.atualizar";
    if (!canAccessTask(identity,task,capability,oneTimeApproval)) throw new Error("Operação fora do escopo autorizado");
    const result = await db.rpc("update_collaborative_work_task",{ p_actor_person_id:identity.personId,p_task_id:command.taskId,p_revision:command.revision,p_action:command.operation,p_payload:command.payload,p_origin:origin,p_one_time_approval:oneTimeApproval });
    check(result.error); return result.data;
  }
  if (command.action === "team_save") {
    if (!identity.owner || !hasPermission(identity,"operacao.administrar")) throw new Error("Administração exclusiva do proprietário");
    const saved=await db.rpc("save_work_team",{p_actor:identity.personId,p_id:command.id ?? null,p_revision:command.revision ?? null,p_name:command.name,p_access_group_id:command.accessGroupId ?? null,p_active:command.active,p_members:command.members}); check(saved.error);
    return { id:saved.data };
  }
  if (command.action === "scope_role_save") {
    if (!identity.owner || !hasPermission(identity,"operacao.administrar")) throw new Error("Administração exclusiva do proprietário");
    if ([command.teamId,command.clientId,command.projectId].filter(Boolean).length !== 1) throw new Error("Informe exatamente um escopo");
    const result=await db.rpc("save_work_scope_role",{p_actor:identity.personId,p_person:command.personId,p_role:command.role,p_team:command.teamId??null,p_client:command.clientId??null,p_project:command.projectId??null,p_active:command.active});check(result.error);return {id:result.data};
  }
  if (command.action === "capacity_save") {
    const canPlan = identity.owner || (hasPermission(identity,"trabalho.planejar") && (identity.roles.some((role) => role.role === "coordenador" && role.teamId === command.teamId)||identity.teams.some(team=>team.id===command.teamId&&team.membershipRole==="coordenador")));
    if (!canPlan) throw new Error("Capacidade fora do escopo coordenado");
    if (command.absenceHours > command.availableHours) throw new Error("Ausência não pode superar disponibilidade");
    const saved=await db.rpc("save_work_capacity",{p_actor:identity.personId,p_person:command.personId,p_team:command.teamId,p_week:command.weekStart,p_available:command.availableHours,p_absence:command.absenceHours,p_note:command.note ?? null,p_revision:command.revision ?? null}); check(saved.error); return saved.data;
  }
  const canPlan = identity.owner || (hasPermission(identity,"trabalho.planejar") && (identity.roles.some((role) => role.role === "coordenador" && role.teamId === command.teamId)||identity.teams.some(team=>team.id===command.teamId&&team.membershipRole==="coordenador")));
  if (!canPlan) throw new Error("Plano fora do escopo coordenado");
  if (Date.parse(command.periodEnd) < Date.parse(command.periodStart)) throw new Error("Período inválido");
  const selected=await db.from("work_tasks").select(TASK_SELECT).in("id",command.taskIds); check(selected.error);
  if ((selected.data ?? []).length!==new Set(command.taskIds).size || (selected.data ?? []).some((task) => !canAccessTask(identity,task as CollaborativeTask,"trabalho.planejar")||task.responsible_team_id!==command.teamId)) throw new Error("Plano contém tarefa fora do escopo");
  const saved=await db.rpc("save_work_plan",{p_actor:identity.personId,p_id:command.id ?? null,p_revision:command.revision ?? null,p_period_kind:command.periodKind,p_start:command.periodStart,p_end:command.periodEnd,p_team:command.teamId,p_objective:command.objective ?? null,p_task_ids:command.taskIds,p_baseline:command.baseline,p_reason:command.reason ?? null}); check(saved.error);
  return { id:saved.data };
}
