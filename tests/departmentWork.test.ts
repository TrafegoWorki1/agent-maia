import {describe,expect,it} from "vitest";
import {canAccessDepartment,departmentSaveSchema,scopedDepartmentRecords,type DepartmentRecord} from "../server/departmentWork.ts";
import {identityScreens,type PanelIdentity} from "../server/panelIdentity.ts";
import {decideAccess,neededPermission,type Requester} from "../server/access.ts";
import {isCollaborativeWorkTool} from "../server/workToolPermit.ts";

const identity=(patch:Partial<PanelIdentity>={}):PanelIdentity=>({personId:"ana",authUserId:null,name:"Ana",owner:false,directPermissions:new Set(["painel.ver","trabalho.ver","trabalho.atualizar"]),permissionModes:new Map(),groupPermissions:[],teams:[{id:"team-a",name:"A",membershipRole:"membro"}],roles:[],...patch});
const record=(patch:Partial<DepartmentRecord>={}):DepartmentRecord=>({id:"record",kind:"cs",client_id:"client-a",project_id:null,contract_id:null,work_task_id:null,responsible_person_id:"ana",responsible_team_id:"team-a",title:"Retorno",details:"Briefing",status:"pending",next_action:"Consultar cliente",next_action_at:null,waiting_kind:null,evidence:null,loss_reason:null,converted_project_id:null,origin:"whatsapp",source_task_id:1,revision:1,created_at:"2026-10-16T12:00:00Z",updated_at:"2026-10-16T12:00:00Z",...patch});

describe("áreas compartilham capacidades e escopos",()=>{
 it("membro consulta e atualiza atribuição sem abrir toda a equipe",()=>{
  expect(canAccessDepartment(identity(),record())).toBe(true);
  expect(canAccessDepartment(identity(),record(),"trabalho.atualizar")).toBe(true);
  expect(canAccessDepartment(identity(),record({responsible_person_id:"outra"}))).toBe(false);
 });
 it("coordenador é limitado à equipe; função financeira não abre combinados",()=>{
  const coordinator=identity({personId:"coord",teams:[{id:"team-a",name:"A",membershipRole:"coordenador"}]});
  expect(canAccessDepartment(coordinator,record())).toBe(true);
  expect(canAccessDepartment(coordinator,record({responsible_team_id:"team-b"}))).toBe(false);
  expect(canAccessDepartment(identity({personId:"finance",teams:[],roles:[{role:"financeiro",clientId:"client-a",projectId:null,teamId:null}]}),record())).toBe(false);
 });
 it("restrição individual vence herança de cliente e revogação retira a população",()=>{
  const inherited=identity({directPermissions:new Set(["painel.ver"]),groupPermissions:[{code:"trabalho.ver",clientId:"client-a"}]});
  expect(scopedDepartmentRecords(inherited,[record(),record({id:"b",client_id:"client-b",responsible_person_id:"outra"})])).toHaveLength(1);
  inherited.permissionModes.set("trabalho.ver","bloqueado");
  expect(scopedDepartmentRecords(inherited,[record()])).toEqual([]);
  expect(identityScreens(inherited)).not.toContain("acompanhamento");
 });
 it("libera áreas escopadas sem liberar cadastro global ou snapshots do owner",()=>{
  const screens=identityScreens(identity());
  expect(screens).toEqual(expect.arrayContaining(["acompanhamento","projetos-lista","trabalho-marketing","oportunidades"]));
  expect(screens).not.toContain("clientes");expect(screens).not.toContain("campanhas");expect(screens).not.toContain("pessoas");
 });
 it("financeiro escopado abre somente suas fontes, sem liberar áreas por causa da função",()=>{
  const finance=identity({directPermissions:new Set(["painel.ver"]),teams:[],groupPermissions:[{code:"financeiro.ver",clientId:"client-a"}],roles:[{role:"financeiro",clientId:"client-a",teamId:null,projectId:null}]});
  expect(identityScreens(finance)).toEqual(expect.arrayContaining(["receitas","custos","metricas"]));
  expect(identityScreens(finance)).not.toContain("oportunidades");
  finance.permissionModes.set("financeiro.ver","bloqueado");
  expect(identityScreens(finance)).not.toContain("receitas");
 });
 it("novas ferramentas passam pelo permit e não aceitam aprovação como acesso permanente",()=>{
  const who:Requester={role:"member",name:"Ana",number:"1",permissions:new Set(["trabalho.atualizar"])};
  expect(neededPermission("mcp__maia__area_registro_salvar",false,{id:"registro"})).toBe("trabalho.atualizar");
  expect(decideAccess("mcp__maia__area_registro_salvar",who,{toolInput:{id:"registro"}},false).decision).toBe("allow");
  expect(decideAccess("mcp__maia__oportunidade_converter",who,{},false).decision).toBe("deny");
  expect(isCollaborativeWorkTool("mcp__maia__area_registro_salvar")).toBe(true);
  expect(isCollaborativeWorkTool("mcp__maia__oportunidade_converter")).toBe(true);
 });
 it("valida revisão, perda, espera e evidência antes de chamar o banco",()=>{
  const id="11111111-1111-4111-8111-111111111111";
  const command={action:"department_save",id,revision:1,kind:"cs",reason:"Retorno acordado",payload:{client_id:id,responsible_person_id:id,title:"Retorno",next_action:"Responder",status:"pending"}};
  expect(departmentSaveSchema.safeParse(command).success).toBe(true);
  expect(departmentSaveSchema.safeParse({...command,revision:undefined}).success).toBe(false);
  for(const status of ["waiting","completed","won"]){expect(departmentSaveSchema.safeParse({...command,payload:{...command.payload,status}}).success).toBe(false);}
  expect(departmentSaveSchema.safeParse({...command,kind:"opportunity",payload:{...command.payload,status:"lost"}}).success).toBe(false);
 });
});
