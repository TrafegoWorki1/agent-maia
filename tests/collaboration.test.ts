import { describe,expect,it } from "vitest";
import { calculateMetrics,canAccessTask,type CollaborativeTask } from "../server/collaborativeWork.ts";
import { decideAccess,type Requester } from "../server/access.ts";
import type { PanelIdentity } from "../server/panelIdentity.ts";

const task=(extra:Partial<CollaborativeTask>={}):CollaborativeTask=>({id:1,title:"Peça",responsible:"Ana",responsible_person_id:"p1",responsible_team_id:"t1",reviewer_person_id:"p2",approver_person_id:"p3",client_ref_id:"c1",project_ref_id:null,deliverable_id:null,area:"criação",objective:null,briefing:null,acceptance_criteria:null,workflow_status:"in_progress",priority:2,committed_due_at:"2026-10-16T18:00:00Z",due_at:null,started_at:"2026-10-16T10:00:00Z",completed_at:null,blocked_at:null,waiting_kind:null,block_reason:null,completion_evidence:null,estimated_effort_hours:2,origin_kind:"whatsapp",source_task_id:null,revision:1,updated_at:"2026-10-16T10:00:00Z",planned_week:null,added_after_baseline:false,...extra});
const identity=(extra:Partial<PanelIdentity>={}):PanelIdentity=>({personId:"p1",authUserId:null,name:"Ana",owner:false,directPermissions:new Set(["painel.ver","trabalho.ver","trabalho.atualizar"]),permissionModes:new Map(),groupPermissions:[],teams:[{id:"t1",name:"Criação",membershipRole:"membro"}],roles:[],...extra});

describe("autorização colaborativa",()=>{
  it("membro atualiza o próprio trabalho mas não revisa nem administra",()=>{
    expect(canAccessTask(identity(),task(),"trabalho.atualizar")).toBe(true);
    expect(canAccessTask(identity(),task(),"trabalho.revisar")).toBe(false);
    expect(canAccessTask(identity(),task({responsible_person_id:"outra",responsible_team_id:"outra"}),"trabalho.ver")).toBe(false);
  });
  it("restrição individual prevalece sobre equipe",()=>{
    const who=identity({directPermissions:new Set(),permissionModes:new Map([["trabalho.ver","bloqueado"]]),groupPermissions:[{code:"trabalho.ver",clientId:"c1"}]});
    expect(canAccessTask(who,task(),"trabalho.ver")).toBe(false);
  });
  it("revisor e coordenador ficam limitados ao papel e ao escopo",()=>{
    const reviewer=identity({personId:"p2",directPermissions:new Set(["trabalho.ver","trabalho.revisar"]),teams:[],roles:[{role:"revisor",teamId:"t1",clientId:null,projectId:null}]});
    expect(canAccessTask(reviewer,task(),"trabalho.revisar")).toBe(true);
    expect(canAccessTask(reviewer,task(),"trabalho.redistribuir")).toBe(false);
    const coordinator=identity({personId:"pc",directPermissions:new Set(["trabalho.ver","trabalho.redistribuir"]),teams:[],roles:[{role:"coordenador",teamId:"t1",clientId:null,projectId:null}]});
    expect(canAccessTask(coordinator,task(),"trabalho.redistribuir")).toBe(true);
    expect(canAccessTask(coordinator,task({responsible_team_id:"t2"}),"trabalho.redistribuir")).toBe(false);
  });
  it("ferramentas de trabalho usam permissões específicas",()=>{
    const member:Requester={role:"member",name:"Ana",number:"1",permissions:new Set(["trabalho.ver","trabalho.atualizar"])};
    expect(decideAccess("mcp__maia__tarefas_listar",member,{},true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__tarefa_atualizar",member,{},false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__tarefa_criar",member,{},false).decision).toBe("approve");
  });
  it("revisão pelo WhatsApp usa a capacidade do revisor sem pedir competência de atualização",()=>{
    const reviewer:Requester={role:"member",name:"Revisor",number:"1",permissions:new Set(["trabalho.revisar"])};
    expect(decideAccess("mcp__maia__tarefa_atualizar",reviewer,{toolInput:{resultado_revisao:"approved"}},false).decision).toBe("allow");
    expect(decideAccess("mcp__maia__tarefa_atualizar",reviewer,{toolInput:{estado:"completed"}},false).decision).toBe("approve");
    expect(decideAccess("mcp__maia__trabalho_contexto",{...reviewer,permissions:new Set(["trabalho.ver"])},{},true).decision).toBe("allow");
  });
});

describe("indicadores auditáveis",()=>{
  it("não transforma denominador ausente em zero e expõe os registros",()=>{
    const metrics=calculateMetrics([task()],[],[]);
    expect(metrics.find(m=>m.code==="individual.commitment_rate")).toMatchObject({available:false,value:null});
    expect(metrics.find(m=>m.code==="individual.open_wip")?.recordIds).toEqual([1]);
  });
  it("abre os registros que compõem bloqueios antigos e itens fora da baseline",()=>{
    const now=new Date("2026-10-16T12:00:00Z");
    const metrics=calculateMetrics([task({workflow_status:"blocked",blocked_at:"2026-10-13T00:00:00Z",added_after_baseline:true})],[],[],now,undefined,true);
    expect(metrics.find(m=>m.code==="team.blocked_aging")).toMatchObject({available:true,value:1,recordIds:[1]});
    expect(metrics.find(m=>m.code==="team.unplanned_after_baseline")).toMatchObject({available:true,value:1,recordIds:[1]});
  });
});
