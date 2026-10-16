import { z } from "zod";
import { createHash } from "node:crypto";
import type { Db } from "./store.ts";
import { hasPermission, type PanelIdentity } from "./panelIdentity.ts";
import { canManagePortfolio } from "./workPortfolio.ts";

export interface DepartmentRecord {
 id:string;kind:"opportunity"|"cs";client_id:string;project_id:string|null;contract_id:string|null;work_task_id:number|null;
 responsible_person_id:string;responsible_team_id:string|null;title:string;details:string;status:string;
 next_action:string;next_action_at:string|null;waiting_kind:string|null;evidence:string|null;loss_reason:string|null;
 converted_project_id:string|null;origin:string;source_task_id:number|null;created_at:string;updated_at:string;revision:number;
}
// Sem defaults/transformações no contrato MCP: o permit deve conferir exatamente o payload autorizado.
const nullableId=z.string().uuid().nullable().optional();
export const departmentPayloadSchema=z.object({
 client_id:z.string().uuid(),project_id:nullableId,contract_id:nullableId,work_task_id:z.number().int().positive().nullable().optional(),
 responsible_person_id:z.string().uuid(),responsible_team_id:nullableId,title:z.string().min(1).max(200),details:z.string().max(4000).optional(),
 status:z.string().max(30),next_action:z.string().min(1).max(1000),next_action_at:z.iso.datetime({offset:true}).nullable().optional(),
 waiting_kind:z.enum(["team","owner","client","external"]).nullable().optional(),evidence:z.string().max(2000).nullable().optional(),loss_reason:z.string().max(1000).nullable().optional(),request_key:z.string().min(1).max(200).optional(),
});
export const departmentSaveSchema=z.object({action:z.literal("department_save"),kind:z.enum(["opportunity","cs"]),id:z.string().uuid().optional(),revision:z.number().int().positive().optional(),payload:departmentPayloadSchema,reason:z.string().trim().min(3).max(1000)})
 .refine(v=>!v.id||!!v.revision,"Edição exige revisão")
 .refine(v=>(v.kind==="opportunity"?["prospecting","qualified","proposal","negotiation","lost","cancelled"]:["pending","in_progress","waiting","completed","cancelled"]).includes(v.payload.status),"Estado inválido para a área")
 .refine(v=>v.payload.status!=="completed"||!!v.payload.evidence?.trim(),"Conclusão exige evidência")
 .refine(v=>v.payload.status!=="lost"||!!v.payload.loss_reason?.trim(),"Perda exige motivo")
 .refine(v=>v.payload.status!=="waiting"||!!v.payload.waiting_kind,"Espera exige classificação");
export const opportunityConvertSchema=z.object({action:z.literal("opportunity_convert"),id:z.string().uuid(),revision:z.number().int().positive(),reason:z.string().trim().min(3).max(1000)});

export function canAccessDepartment(identity:PanelIdentity,row:DepartmentRecord,capability="trabalho.ver"):boolean {
 if(identity.owner)return true;
 if(!hasPermission(identity,capability,row.client_id))return false;
 if(row.responsible_person_id===identity.personId&&["trabalho.ver","indicadores.ver","trabalho.atualizar","tarefas.criar"].includes(capability))return true;
 if(identity.teams.some(t=>t.id===row.responsible_team_id&&t.membershipRole==="coordenador"))return true;
 return identity.roles.some(r=>
  ((!!r.clientId&&r.clientId===row.client_id||!!r.projectId&&r.projectId===row.project_id)&&["coordenador","responsavel_cliente"].includes(r.role))||
  (!!r.teamId&&r.teamId===row.responsible_team_id&&r.role==="coordenador")||
  (["trabalho.ver","indicadores.ver"].includes(capability)&&r.role==="membro"&&(!!r.clientId&&r.clientId===row.client_id||!!r.projectId&&r.projectId===row.project_id)));
}
export function scopedDepartmentRecords(identity:PanelIdentity,rows:DepartmentRecord[]) {
 return rows.filter(row=>canAccessDepartment(identity,row)).map(row=>({...row,
  canUpdate:!row.converted_project_id&&canAccessDepartment(identity,row,"trabalho.atualizar"),
  canViewMetrics:canAccessDepartment(identity,row,"indicadores.ver"),
  canConvert:row.kind==="opportunity"&&canAccessDepartment(identity,row,"trabalho.planejar")&&canManagePortfolio(identity,row.client_id,row.project_id,row.responsible_team_id),
 }));
}
export async function executeDepartmentCommand(db:Db,identity:PanelIdentity,raw:unknown,origin:"panel"|"whatsapp"|"maia",sourceTaskId?:number){
 const candidate=raw as {action?:string};
 if(candidate.action==="opportunity_convert"){
  const command=opportunityConvertSchema.parse(raw);
  const result=await db.rpc("convert_work_opportunity",{p_actor:identity.personId,p_id:command.id,p_revision:command.revision,p_reason:command.reason,p_origin:origin});
  if(result.error)throw new Error(result.error.message);return result.data;
 }
 const command=departmentSaveSchema.parse(raw);
 if(!command.id&&origin==="panel")throw new Error("Criação somente pela Maia no WhatsApp");
 if(!command.id&&!command.payload.request_key&&sourceTaskId)command.payload.request_key=`department:${sourceTaskId}:${command.kind}:${createHash("sha256").update(JSON.stringify(command.payload)).digest("hex")}`;
 if(!command.id&&!command.payload.request_key)throw new Error("Criação exige chave de idempotência");
 const result=await db.rpc("save_work_department_record",{p_actor:identity.personId,p_id:command.id??null,p_revision:command.revision??null,p_kind:command.kind,p_payload:command.payload,p_reason:command.reason,p_origin:origin,p_source_task_id:sourceTaskId??null});
 if(result.error)throw new Error(result.error.message);return result.data;
}
