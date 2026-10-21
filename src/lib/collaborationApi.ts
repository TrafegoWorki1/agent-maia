import { supabase } from "./supabaseBrowser";
import type { DepartmentMetric } from "./departmentMetrics";

export type WorkflowStatus = "pending"|"in_progress"|"review"|"awaiting_approval"|"blocked"|"completed"|"cancelled";
export interface CollaborationTask {
  started_at?:string|null;completed_at?:string|null;blocked_at?:string|null;updated_at?:string;
  area?:string|null;
  objective:string|null;briefing:string|null;acceptance_criteria:string|null;deliverable_id:string|null;origin_kind:string;source_task_id:number|null;
  id:number; title:string; responsible:string; responsible_person_id:string|null; responsible_team_id:string|null;
  reviewer_person_id:string|null; approver_person_id:string|null; client_ref_id:string|null; project_ref_id:string|null;
  workflow_status:WorkflowStatus; priority:number; revision:number; committed_due_at:string|null; estimated_effort_hours:number|null;
  block_reason:string|null; waiting_kind:string|null; completion_evidence:string|null; added_after_baseline:boolean;
  allowedActions:{update:boolean;review:boolean;approve:boolean;reassign:boolean;prioritize:boolean};
}
export interface CollaborationData {
  readWindow?:{start:string;end:string;historyOnDemand:boolean};
  departmentRecords?:DepartmentRecord[];departmentHistory?:Array<Record<string,unknown>>;departmentMetrics?:DepartmentMetric[];
  planningTeamIds:string[];portfolioClientIds:string[];
  baselines:Array<{plan_id:string;created_at?:string;task_snapshots:Array<{id:number;priority:number;committed_due_at:string|null}>}>;
  portfolioHistory:Array<Record<string,unknown>>;
  generatedAt:string; staleAfterMs:number;
  identity:{accessVersion:string;personId:string;name:string;owner:boolean;screens:string[];permissions:string[];teams:Array<{id:string;name:string;membershipRole:string}>;roles:Array<{role:string;teamId:string|null;clientId:string|null;projectId:string|null}>};
  tasks:CollaborationTask[]; people:Array<{id:string;name:string;role:string;active:boolean}>; teams:Array<{id:string;name:string;active:boolean;revision:number;access_group_id?:string|null}>; teamMembers:Array<{team_id:string;person_id:string;membership_role:"membro"|"coordenador";active:boolean}>;
  clients:Array<{id:string;name:string;active:boolean}>;contracts:Array<Record<string,unknown>>;scopeRoles:Array<{id?:string;person_id?:string;role:string;team_id?:string|null;client_id?:string|null;project_id?:string|null;active?:boolean}>;projects:Array<Record<string,unknown>>; deliverables:Array<Record<string,unknown>>; dependencies:Array<Record<string,unknown>>; artifacts:Array<Record<string,unknown>>;
  history:Array<Record<string,unknown>>; reviews:Array<Record<string,unknown>>; plans:Array<Record<string,unknown>>; planItems:Array<Record<string,unknown>>;
  planChanges:Array<Record<string,unknown>>; capacity:Array<Record<string,unknown>>; load:Array<{personId:string;assigned:number;estimatedHours:number|null;availableHours:number|null;utilization:number|null;unavailableReason:string|null}>;
  dashboards:{myDay:{priorities:CollaborationTask[];dueSoon:CollaborationTask[];blocked:CollaborationTask[];reviews:CollaborationTask[];approvals:CollaborationTask[]};team:{tasks:CollaborationTask[];blocked:CollaborationTask[]};coordination:{deadlineRisks:CollaborationTask[];reviewQueue:CollaborationTask[];approvalQueue:CollaborationTask[];unplanned:CollaborationTask[]};direction:{tasks:CollaborationTask[];metrics:Metric[]} | null};
  metrics:Metric[]; metricCatalog:Array<Record<string,unknown>>; externalMetrics:Array<Record<string,unknown>>;
}
export interface DepartmentRecord {
 id:string;kind:"opportunity"|"cs";client_id:string;project_id:string|null;contract_id:string|null;work_task_id:number|null;
 responsible_person_id:string;responsible_team_id:string|null;title:string;details:string;status:string;
 next_action:string;next_action_at:string|null;waiting_kind:string|null;evidence:string|null;loss_reason:string|null;
 converted_project_id:string|null;origin:string;source_task_id:number|null;created_at:string;updated_at:string;revision:number;
 canUpdate:boolean;canConvert:boolean;canViewMetrics?:boolean;
}
export interface Metric {code:string;label:string;value:number|string|null;unit:string;available:boolean;unavailableReason:string|null;recordIds:number[]}

async function token(): Promise<string> {
  if (!supabase) throw new Error("Painel colaborativo exige login configurado.");
  const session = await supabase.auth.getSession();
  const value = session.data.session?.access_token;
  if (!value) throw new Error("Faça login para continuar.");
  return value;
}
export class CollaborationApiError extends Error { constructor(message:string,readonly status:number){super(message);this.name="CollaborationApiError";} }
async function request(method:"GET"|"POST",body?:unknown,signal?:AbortSignal,path="/api/collaboration") {
  const response=await fetch(path,{method,signal,headers:{Authorization:`Bearer ${await token()}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  const value=await response.json().catch(() => ({}));
  if (!response.ok) throw new CollaborationApiError(value.error ?? `Falha HTTP ${response.status}`,response.status);
  return value;
}
export async function fetchPanelIdentity(signal?:AbortSignal):Promise<CollaborationData["identity"]>{return request("GET",undefined,signal,"/api/collaboration?identity=1");}
export async function fetchCollaboration(signal?:AbortSignal,period?:{start:string;end:string}):Promise<CollaborationData>{return request("GET",undefined,signal,"/api/panel-collaboration"+(period?"?"+new URLSearchParams(period).toString():""));}
export async function fetchTaskHistory(taskId:number,page:number,signal?:AbortSignal):Promise<{history:Array<Record<string,unknown>>;hasMore:boolean}>{return request("GET",undefined,signal,`/api/panel-collaboration?task=${taskId}&page=${page}`);}
export async function panelReadRequest(path:string,signal?:AbortSignal){return request("GET",undefined,signal,path);}
export async function mutateCollaboration(command:unknown):Promise<unknown>{return (await request("POST",command)).result;}
