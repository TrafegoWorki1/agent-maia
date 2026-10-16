import { z } from "zod";
import type { Db } from "./store.ts";
import { hasPermission, type PanelIdentity } from "./panelIdentity.ts";

const optionalId = z.string().uuid().nullable().optional();
const common = { responsible_person_id: optionalId, responsible_team_id: optionalId, reason: z.string().trim().min(3).max(1000) };
const contract = z.object({ client_id:z.string().uuid(), name:z.string().trim().min(1).max(160),service_scope:z.string().trim().min(1).max(2000),status:z.enum(["draft","active","paused","ended","cancelled"]),starts_on:z.string().date().nullable(),ends_on:z.string().date().nullable(),...common });
const project = z.object({ client_id:z.string().uuid(),contract_id:optionalId,name:z.string().trim().min(1).max(160),objective:z.string().max(2000),status:z.enum(["planned","active","on_hold","completed","cancelled"]),starts_on:z.string().date().nullable(),due_on:z.string().date().nullable(),...common });
const deliverable = z.object({ project_id:z.string().uuid(),title:z.string().trim().min(1).max(200),objective:z.string().max(2000),acceptance_criteria:z.string().max(4000),status:z.enum(["pending","in_progress","review","awaiting_approval","completed","cancelled"]),due_at:z.iso.datetime({offset:true}).nullable(),evidence:z.string().max(2000).optional(),reason:common.reason });
export const portfolioCommandSchema=z.object({action:z.literal("portfolio_save"),kind:z.enum(["contract","project","deliverable"]),id:z.string().uuid().optional(),revision:z.number().int().positive().optional(),payload:z.record(z.string(),z.unknown())}).refine(value=>!value.id||!!value.revision,"Edição exige a revisão atual");

export function canManagePortfolio(identity:PanelIdentity,clientId:string,projectId:string|null,teamId:string|null):boolean{
 if(identity.owner)return true;
 if(!hasPermission(identity,"trabalho.planejar",clientId))return false;
 return identity.roles.some(role=>(role.clientId===clientId&&["coordenador","responsavel_cliente"].includes(role.role))||(!!projectId&&role.projectId===projectId&&role.role==="coordenador"))
  || (!!projectId&&!!teamId&&(identity.teams.some(team=>team.id===teamId&&team.membershipRole==="coordenador")||identity.roles.some(role=>role.teamId===teamId&&role.role==="coordenador")));
}
export async function savePortfolio(db:Db,identity:PanelIdentity,raw:unknown){
 const command=portfolioCommandSchema.parse(raw);
 const payload=(command.kind==="contract"?contract:command.kind==="project"?project:deliverable).parse(command.payload);
 // A RPC confere os valores persistidos, mantém o cliente/projeto e impede edição concorrente.
 const result=await db.rpc("save_work_portfolio",{p_actor:identity.personId,p_kind:command.kind,p_id:command.id??null,p_revision:command.revision??null,p_payload:payload,p_reason:payload.reason});
 if(result.error)throw new Error(result.error.message);
 return result.data;
}
