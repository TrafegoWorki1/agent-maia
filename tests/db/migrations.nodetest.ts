// Testes de banco com o executor nativo do Node (node --test), não com o Vitest: o PGlite (Postgres em WebAssembly)
// derruba os workers do Vitest no Windows quando a memória livre é pouca; no Node puro roda sempre.
// As migrações são aplicadas do zero num Postgres temporário. Nada aqui toca em banco remoto.
//   pnpm test:db
import assert from "node:assert/strict";
import { temporarySupabase } from "../helpers/temporarySupabase.ts";
import { collaborationView,executeCollaborationCommand,scopedWorkTasksView } from "../../server/collaborativeWork.ts";
import { identityByAuthUser } from "../../server/panelIdentity.ts";
import { after, before, describe, it } from "node:test";
import { buildLocalDb, listMigrations, type LocalDb } from "../../scripts/db/local.ts";
import { checkEssentials, checkNames, findDestructive, hasApprovalMark } from "../../scripts/db/rules.ts";
import { diffSnapshots, formatDiff, hasDrift } from "../../scripts/db/snapshot.ts";
import { assertReadOnly } from "../../scripts/db/remote.ts";
import { RULE_CATALOG, validateRules } from "../../server/ruleCatalog.ts";
import { readFileSync } from "node:fs";
import { missingStructures, scanSource, scanUsage } from "../../scripts/db/usage.ts";
import {executeDepartmentCommand} from "../../server/departmentWork.ts";
import { registerMissionTests } from "./missions.integration.ts";

let local: LocalDb;
before(async () => {
  local = await buildLocalDb();
});
after(async () => {
  await local?.close();
});

const q = async (sql: string, params: unknown[] = []) => (await local.db.query<Record<string, unknown>>(sql, params)).rows;
const rejects = (promise: Promise<unknown>, pattern: RegExp) => assert.rejects(promise, pattern);
registerMissionTests(() => local);

describe("integração departamental: mesma carteira, autorização e auditoria",()=>{
 let owner:string,member:string,other:string,clientA:string,clientB:string,team:string,authId:string;
 let db:ReturnType<typeof temporarySupabase>;
 const payload=(extra:Record<string,unknown>={})=>({client_id:clientA,project_id:null,contract_id:null,work_task_id:null,responsible_person_id:member,responsible_team_id:team,title:"Retorno do cliente",details:"Briefing confirmado",status:"pending",next_action:"Revisar briefing",next_action_at:"2026-10-20T15:00:00-03:00",...extra});
 const save=async(actor:string,data:Record<string,unknown>,id:string|null=null,revision:number|null=null,kind="cs",origin="whatsapp")=>(await q("select save_work_department_record($1,$2,$3,$4,$5::jsonb,'Teste de integração',$6,null) as result",[actor,id,revision,kind,JSON.stringify(data),origin]))[0].result as Record<string,any>;
 before(async()=>{
  db=temporarySupabase(local);
  owner=String((await q("insert into people(name,role) values('Owner departamentos','proprietario') returning id"))[0].id);
  authId=String((await q("insert into auth.users(email) values('departments@example.test') returning id"))[0].id);
  member=String((await q("insert into people(name,role,auth_user_id) values('Membro departamentos','equipe',$1) returning id",[authId]))[0].id);
  other=String((await q("insert into people(name,role) values('Outra pessoa departamentos','equipe') returning id"))[0].id);
  clientA=String((await q("insert into maia_clients(name) values('Cliente departamentos A') returning id"))[0].id);
  clientB=String((await q("insert into maia_clients(name) values('Cliente departamentos B') returning id"))[0].id);
  team=String((await q("insert into work_teams(name) values('Equipe departamentos') returning id"))[0].id);
  await q("insert into work_team_members(team_id,person_id) values($1,$2)",[team,member]);
  await q("insert into work_scope_roles(person_id,role,client_id) values($1,'membro',$2)",[member,clientA]);
  await q("insert into person_permissions(person_id,permission_code) values($1,'painel.ver'),($1,'trabalho.ver'),($1,'trabalho.atualizar'),($1,'tarefas.criar')",[member]);
 });
 it("WhatsApp grava, painel lê e alteração do painel aparece na próxima consulta da Maia",async()=>{
  const row=await save(member,payload({request_key:"dept:sync"}));
  const identity=await identityByAuthUser(db,authId);
  const panel=await collaborationView(db,identity);
  assert.equal(panel.departmentRecords.find(record=>record.id===row.id)?.next_action,"Revisar briefing");
  await executeCollaborationCommand(db,identity,{action:"department_save",kind:"cs",id:row.id,revision:1,reason:"Retorno atualizado no painel",payload:payload({next_action:"Conferir arte",status:"in_progress"})});
  const next=await collaborationView(db,await identityByAuthUser(db,authId),new Date(),"maia");
  assert.equal(next.departmentRecords.find(record=>record.id===row.id)?.next_action,"Conferir arte");
  assert.equal(next.departmentHistory.filter(event=>event.entity_id===row.id).length,2);
  await rejects(save(member,payload({next_action:"Escrita antiga"}),String(row.id),1),/outra sessão/);
  assert.equal((await q("select count(*)::int as n from work_department_records where request_key='dept:sync'"))[0].n,1);
 });
 it("restrição herdada e revogação durante trabalho pendente bloqueiam novas leituras/escritas",async()=>{
  const row=await save(member,payload({request_key:"dept:revoked"}));
  const group=String((await q("insert into maia_access_groups(name,client_id) values('Herança departamentos',$1) returning id",[clientA]))[0].id);
  await q("insert into maia_access_group_members(access_group_id,person_id) values($1,$2)",[group,member]);
  await q("insert into maia_access_group_permissions(access_group_id,permission_code) values($1,'trabalho.atualizar')",[group]);
  await q("delete from person_permissions where person_id=$1 and permission_code='trabalho.atualizar'",[member]);
  assert.equal((await q("select maia_department_scope($1,$2,null,$3,$1,'trabalho.atualizar') as ok",[member,clientA,team]))[0].ok,true);
  await q("insert into maia_member_access_modes(person_id,permission_code,mode,updated_by) values($1,'trabalho.atualizar','bloqueado','teste')",[member]);
  await rejects(save(member,payload(),String(row.id),1),/fora do escopo/);
  await q("delete from maia_member_access_modes where person_id=$1 and permission_code='trabalho.atualizar'",[member]);
  await q("update people set active=false where id=$1",[member]);
  await rejects(save(member,payload(),String(row.id),1),/fora do escopo/);
  await rejects(identityByAuthUser(db,authId),/revogado/);
  await q("update people set active=true where id=$1",[member]);
 });
 it("não cruza cliente/projeto/tarefa nem dá administração por pertencer à equipe",async()=>{
  await rejects(save(member,payload({client_id:clientB,request_key:"dept:other-client"})),/fora do escopo/);
  await rejects(save(member,payload({responsible_person_id:other,request_key:"dept:other-member"})),/fora do escopo/);
  const project=String((await q("insert into work_projects(client_id,name) values($1,'Outro projeto') returning id",[clientB]))[0].id);
  await rejects(save(owner,payload({project_id:project,request_key:"dept:cross-project"})),/não pertence/);
  await rejects(save(owner,payload({request_key:"dept:manual"}),null,null,"cs","panel"),/somente pela Maia/);
  const identity=await identityByAuthUser(db,authId);
  await rejects(executeDepartmentCommand(db,identity,{action:"department_save",kind:"cs",reason:"Teste manual",payload:payload()},"panel"),/somente pela Maia/);
 });
 it("converte uma vez e preserva origem, cliente, revisão e histórico",async()=>{
  const opportunity=await save(owner,payload({status:"qualified",request_key:"dept:convert"}),null,null,"opportunity");
  const concurrent=await Promise.all([q("select convert_work_opportunity($1,$2,1,'Proposta aceita','whatsapp') as result",[owner,opportunity.id]),q("select convert_work_opportunity($1,$2,1,'Evento repetido','whatsapp') as result",[owner,opportunity.id])]);
  const project=concurrent[0][0].result as Record<string,unknown>;
  assert.equal((concurrent[1][0].result as Record<string,unknown>).id,project.id);
  const retry=(await q("select convert_work_opportunity($1,$2,1,'Retomada segura','whatsapp') as result",[owner,opportunity.id]))[0].result as Record<string,unknown>;
  assert.equal(retry.id,project.id);assert.equal(retry.alreadyConverted,true);
  assert.equal((await q("select client_id from work_projects where id=$1",[project.id]))[0].client_id,clientA);
  assert.equal((await q("select count(*)::int as n from work_portfolio_history where entity_id=$1",[opportunity.id]))[0].n,2);
  await rejects(save(owner,payload({status:"lost",loss_reason:"Mudou escopo"}),String(opportunity.id),2,"opportunity"),/já convertida/);
  await rejects(q("select convert_work_opportunity($1,$2,1,'Sem competência','panel')",[member,opportunity.id]),/fora do escopo/);
 });
 it("idempotência de criação não duplica e CS não conclui trabalho vinculado ainda aberto",async()=>{
  const task=String((await q("insert into work_tasks(title,responsible,request_key,client_ref_id,responsible_person_id,origin_kind) values('Execução vinculada','Membro','dept:linked-task',$1,$2,'whatsapp') returning id",[clientA,member]))[0].id);
  const input=payload({work_task_id:Number(task),request_key:"dept:once"});
  const first=await save(member,input),second=await save(member,input);assert.equal(first.id,second.id);
  await rejects(save(member,{...input,status:"completed",evidence:"Texto não prova execução"},String(first.id),1),/tarefa vinculada encerrada/);
  assert.equal((await q("select workflow_status from work_tasks where id=$1",[task]))[0].workflow_status,"pending");
  await rejects(save(member,{...input,status:"waiting"},String(first.id),1),/check constraint/);
  assert.equal((await q("select revision from work_department_records where id=$1",[first.id]))[0].revision,1);
 });
 it("banco recusa acesso direto a dados e RPCs por roles públicas",async()=>{
  for(const role of ["anon","authenticated"]){
   await local.db.exec("set role "+role);
   try{
    await rejects(q("select * from work_department_records"),/permission denied/);
    await rejects(q("select convert_work_opportunity($1,gen_random_uuid(),1,'Ataque direto','panel')",[owner]),/permission denied/);
    await rejects(q("select save_work_department_record($1,null,null,'cs','{}'::jsonb,'Ataque direto','whatsapp',null)",[owner]),/permission denied/);
   }finally{await local.db.exec("reset role");}
  }
 });
 it("escopo com responsável nulo é falso, não NULL autorizador; redistribuição exige competência",async()=>{
  assert.equal((await q("select maia_department_scope($1,$2,null,$3,null,'trabalho.redistribuir') as ok",[member,clientA,team]))[0].ok,false);
  const row=await save(member,payload({request_key:"dept:reassign"}));
  await rejects(save(member,payload({responsible_person_id:other}),String(row.id),1),/Redistribuição fora do escopo/);
 });
 it("financeiro herdado vê somente observações e catálogo do cliente atribuído",async()=>{
  const financeAuth=String((await q("insert into auth.users(email) values('department-finance@example.test') returning id"))[0].id);
  const person=String((await q("insert into people(name,role,auth_user_id) values('Financeiro departamentos','equipe',$1) returning id",[financeAuth]))[0].id);
  const group=String((await q("insert into maia_access_groups(name,client_id) values('Financeiro cliente A',$1) returning id",[clientA]))[0].id);
  await q("insert into person_permissions(person_id,permission_code) values($1,'painel.ver')",[person]);
  await q("insert into maia_access_group_members(access_group_id,person_id) values($1,$2)",[group,person]);
  await q("insert into maia_access_group_permissions(access_group_id,permission_code) values($1,'financeiro.ver')",[group]);
  await q("insert into work_scope_roles(person_id,role,client_id) values($1,'financeiro',$2)",[person,clientA]);
  for(const client of [clientA,clientB])await q("insert into external_metric_observations(metric_code,client_id,period_start,period_end,value,unit,source_name,last_attempt_at,last_success_at) values('finance.received',$1,'2026-10-01','2026-10-31',123,'BRL','Fonte simulada',now(),now())",[client]);
  const view=await collaborationView(db,await identityByAuthUser(db,financeAuth));
  assert.equal(view.externalMetrics.length,1);assert.equal(view.externalMetrics[0].client_id,clientA);
  assert.ok(view.metricCatalog.some(row=>row.code==="finance.received"));
  assert.equal(view.departmentRecords.length,0);assert.equal(view.tasks.length,0);
 });
});

describe("painel colaborativo: escopo, concorrência e revogação",()=>{
  let member:unknown,reviewer:unknown,coordinator:unknown,teamA:unknown,teamB:unknown,clientA:unknown,taskA:unknown;
  before(async()=>{
    member=(await q("insert into people(name,role) values('Membro painel','equipe') returning id"))[0].id;
    reviewer=(await q("insert into people(name,role) values('Revisor painel','equipe') returning id"))[0].id;
    coordinator=(await q("insert into people(name,role) values('Coordenador painel','equipe') returning id"))[0].id;
    clientA=(await q("insert into maia_clients(name) values('Cliente painel') returning id"))[0].id;
    teamA=(await q("insert into work_teams(name) values('Equipe painel A') returning id"))[0].id;
    teamB=(await q("insert into work_teams(name) values('Equipe painel B') returning id"))[0].id;
    await q("insert into person_permissions(person_id,permission_code) values($1,'trabalho.ver'),($1,'trabalho.atualizar'),($2,'trabalho.ver'),($2,'trabalho.revisar'),($3,'trabalho.ver'),($3,'trabalho.atualizar'),($3,'trabalho.redistribuir'),($3,'trabalho.planejar')",[member,reviewer,coordinator]);
    const access=(await q("insert into maia_access_groups(name) values('Permissão herdada painel') returning id"))[0].id;
    await q("insert into maia_access_group_members(access_group_id,person_id) values($1,$2)",[access,member]);
    await q("insert into maia_access_group_permissions(access_group_id,permission_code) values($1,'trabalho.ver')",[access]);
    await q("insert into work_team_members(team_id,person_id) values($1,$2)",[teamA,member]);
    await q("insert into work_scope_roles(person_id,role,team_id) values($1,'revisor',$2),($3,'coordenador',$2)",[reviewer,teamA,coordinator]);
    taskA=(await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,responsible_team_id,reviewer_person_id,client_ref_id,origin_kind,created_by_person_id) values('Tarefa painel','Membro painel','painel:test:1',$1,$2,$3,$4,'whatsapp',$1) returning id",[member,teamA,reviewer,clientA]))[0].id;
  });
  it("membro não acessa outra equipe e coordenador fica limitado à sua equipe",async()=>{
    const taskB=(await q("insert into work_tasks(title,responsible,request_key,responsible_team_id) values('Outra equipe','Outra','painel:test:2',$1) returning id",[teamB]))[0].id;
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') as ok",[member,taskA]))[0].ok,true);
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') as ok",[member,taskB]))[0].ok,false);
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.redistribuir') as ok",[coordinator,taskA]))[0].ok,true);
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.redistribuir') as ok",[coordinator,taskB]))[0].ok,false);
  });
  it("restrição individual vence concessão e revogação vale na próxima chamada",async()=>{
    await local.db.exec("set role service_role");
    try { await q("insert into maia_member_access_modes(person_id,permission_code,mode,updated_by) values($1,'trabalho.ver','bloqueado','teste')",[member]); }
    finally { await local.db.exec("reset role"); }
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') as ok",[member,taskA]))[0].ok,false);
    await local.db.exec("set role service_role");
    try { await q("delete from maia_member_access_modes where person_id=$1 and permission_code='trabalho.ver'",[member]); await q("update people set active=false where id=$1",[member]); }
    finally { await local.db.exec("reset role"); }
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') as ok",[member,taskA]))[0].ok,false);
    await local.db.exec("set role service_role");
    try { await q("update people set active=true where id=$1",[member]); }
    finally { await local.db.exec("reset role"); }
  });
  it("revisão não concede administração e duas edições não sobrescrevem",async()=>{
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.revisar') as ok",[reviewer,taskA]))[0].ok,true);
    assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.redistribuir') as ok",[reviewer,taskA]))[0].ok,false);
    await q("select update_collaborative_work_task($1,$2,1,'status','{\"status\":\"in_progress\"}'::jsonb,'panel')",[member,taskA]);
    await rejects(q("select update_collaborative_work_task($1,$2,1,'status','{\"status\":\"blocked\",\"reason\":\"Espera\",\"waiting_kind\":\"team\"}'::jsonb,'panel')",[member,taskA]),/alterada por outra pessoa/i);
    assert.equal((await q("select workflow_status from work_tasks where id=$1",[taskA]))[0].workflow_status,"in_progress");
    assert.equal((await q("select count(*)::int as n from work_task_history where work_task_id=$1",[taskA]))[0].n,2);
  });
  it("aprovação pontual executa a operação vinculada sem criar permissão permanente",async()=>{
    const oneOff=(await q("insert into people(name,role) values('Acesso pontual','equipe') returning id"))[0].id;
    const task=(await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,responsible_team_id) values('Tarefa com OK','Acesso pontual','painel:one-off',$1,$2) returning id",[oneOff,teamA]))[0].id;
    await local.db.exec("set role service_role");
    try {
      await q("select update_collaborative_work_task($1,$2,1,'status','{\"status\":\"in_progress\"}'::jsonb,'whatsapp',true)",[oneOff,task]);
      assert.equal((await q("select count(*)::int as n from person_permissions where person_id=$1 and permission_code='trabalho.atualizar'",[oneOff]))[0].n,0);
      await q("insert into maia_member_access_modes(person_id,permission_code,mode,updated_by) values($1,'trabalho.atualizar','bloqueado','teste')",[oneOff]);
      await rejects(q("select update_collaborative_work_task($1,$2,2,'status','{\"status\":\"blocked\",\"reason\":\"novo bloqueio\",\"waiting_kind\":\"team\"}'::jsonb,'whatsapp',true)",[oneOff,task]),/fora do escopo autorizado/i);
    } finally { await local.db.exec("reset role"); }
    assert.equal((await q("select workflow_status from work_tasks where id=$1",[task]))[0].workflow_status,"in_progress");
  });
  it("usuário authenticated não pode consultar autorização personificando outra pessoa",async()=>{
    const authId=(await q("insert into auth.users(email) values('self-only@example.test') returning id"))[0].id;
    const actor=(await q("insert into people(name,role,auth_user_id) values('Identidade própria','equipe',$1) returning id",[authId]))[0].id;
    const owner=(await q("insert into people(name,role) values('Owner para teste de impersonação','proprietario') returning id"))[0].id;
    await local.db.exec("set role authenticated");
    try {
      await q("select set_config('request.jwt.claim.sub',$1,false)",[authId]);
      assert.equal((await q("select maia_effective_permission($1,'trabalho.ver',null) as value",[owner]))[0].value,"bloqueado");
      assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') as ok",[owner,taskA]))[0].ok,false);
      assert.equal((await q("select maia_effective_permission($1,'trabalho.ver',null) as value",[actor]))[0].value,"bloqueado");
    } finally { await local.db.exec("reset role"); await q("select set_config('request.jwt.claim.sub','',false)"); }
  });
  it("RLS limita catálogo e não revela metadados financeiros sem permissão",async()=>{
    const authId=(await q("insert into auth.users(email) values('member-metrics@example.test') returning id"))[0].id;
    const person=(await q("insert into people(name,role,auth_user_id) values('Membro métricas','equipe',$1) returning id",[authId]))[0].id;
    await q("insert into person_permissions(person_id,permission_code) values($1,'indicadores.ver')",[person]);
    await local.db.exec("set role authenticated");
    try {
      await q("select set_config('request.jwt.claim.sub',$1,false)",[authId]);
      const visible=await q("select code from metric_catalog order by code");
      assert.ok(visible.some((row)=>row.code==='team.throughput'));
      assert.equal(visible.some((row)=>row.code==='finance.received'),false);
    } finally { await local.db.exec("reset role"); await q("select set_config('request.jwt.claim.sub','',false)"); }
  });
});


describe("painel completo: carteira, baseline e passagem de trabalho",()=>{
 let owner:string,member:string,reviewer:string,coordinator:string,team:string,otherTeam:string,client:string,otherClient:string,contract:string,project:string;
 before(async()=>{
  owner=String((await q("insert into people(name,role) values('Owner colaboração completa','proprietario') returning id"))[0].id);
  member=String((await q("insert into people(name,role) values('Membro colaboração completa','equipe') returning id"))[0].id);
  reviewer=String((await q("insert into people(name,role) values('Revisor colaboração completa','equipe') returning id"))[0].id);
  coordinator=String((await q("insert into people(name,role) values('Coordenador colaboração completa','equipe') returning id"))[0].id);
  team=String((await q("insert into work_teams(name) values('Equipe colaboração completa') returning id"))[0].id);
  otherTeam=String((await q("insert into work_teams(name) values('Equipe colaboração externa') returning id"))[0].id);
  client=String((await q("insert into maia_clients(name) values('Cliente colaboração completa') returning id"))[0].id);
  otherClient=String((await q("insert into maia_clients(name) values('Cliente colaboração externo') returning id"))[0].id);
  await q("insert into work_team_members(team_id,person_id,membership_role) values($1,$2,'membro'),($1,$3,'membro'),($1,$4,'coordenador')",[team,member,reviewer,coordinator]);
  await q("insert into person_permissions(person_id,permission_code) values($1,'trabalho.ver'),($1,'trabalho.atualizar'),($2,'trabalho.ver'),($2,'trabalho.revisar'),($2,'trabalho.aprovar'),($3,'trabalho.ver'),($3,'trabalho.atualizar'),($3,'trabalho.planejar'),($3,'trabalho.redistribuir')",[member,reviewer,coordinator]);
  await q("select save_work_scope_role($1,$2,'responsavel_cliente',null,$3,null,true)",[owner,coordinator,client]);
 });
 const save=async(actor:string,kind:string,id:string|null,revision:number|null,payload:Record<string,unknown>)=>(await q("select save_work_portfolio($1,$2,$3,$4,$5::jsonb,'Teste de alteração autorizada') as record",[actor,kind,id,revision,JSON.stringify(payload)])).map(row=>({...row,record:row.record as {id:string}}));
 const task=async(key:string,extra="")=>(await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,responsible_team_id,client_ref_id,project_ref_id"+extra+") values('Trabalho de teste','Membro',$1,$2,$3,$4,$5"+(extra?",'"+reviewer+"'":"")+") returning id",[key,member,team,client,project]))[0].id;
 it("carteira usa IDs reais, impede outro cliente, mantém revisão e trilha",async()=>{
  const payload={client_id:client,name:"Contrato real",service_scope:"Escopo contratado",status:"active",responsible_team_id:team};
  contract=(await save(owner,"contract",null,null,payload))[0].record.id;
  project=(await save(coordinator,"project",null,null,{client_id:client,contract_id:contract,name:"Projeto real",objective:"Entrega",status:"active",responsible_team_id:team}))[0].record.id;
  await rejects(save(coordinator,"contract",null,null,{...payload,client_id:otherClient}),/fora do escopo/i);
  await save(owner,"contract",contract,1,{...payload,name:"Contrato revisado"});
  await rejects(save(owner,"contract",contract,1,payload),/alterado por outra sessão/i);
  await rejects(save(owner,"project",null,null,{client_id:otherClient,contract_id:contract,name:"Vínculo inválido",status:"active"}),/não corresponde/i);
  assert.equal((await q("select count(*)::int n from work_portfolio_history where entity_id=$1",[contract]))[0].n,2);
 });
 it("baseline original sobrevive à urgência e à remoção; edição exige motivo e revisão",async()=>{
  const first=await task("collab:plan:first"),second=await task("collab:plan:second");
  const plan=(await q("select save_work_plan($1,null,null,'weekly','2026-10-12','2026-10-18',$2,'Compromisso original',array[$3::bigint],true) as id",[coordinator,team,first]))[0].id;
  await rejects(q("select save_work_plan($1,$2,1,'weekly','2026-10-12','2026-10-18',$3,'Urgência',array[$4::bigint],false)",[coordinator,plan,team,second]),/exige motivo/i);
  await q("select save_work_plan($1,$2,1,'weekly','2026-10-12','2026-10-18',$3,'Urgência',array[$4::bigint],false,'Cliente mudou a prioridade; compromisso original afetado')",[coordinator,plan,team,second]);
  const baseline=(await q("select task_snapshots from work_plan_baselines where plan_id=$1",[plan]))[0].task_snapshots as Array<{id:number}>;
  assert.deepEqual(baseline.map((row:any)=>row.id),[first]);
  assert.equal((await q("select added_after_baseline from work_plan_items where plan_id=$1 and work_task_id=$2",[plan,second]))[0].added_after_baseline,true);
  const changes=await q("select change_kind,reason,affected_task_ids from work_plan_changes where plan_id=$1",[plan]);
  assert.ok(changes.some((row:any)=>row.change_kind==="urgency_added"&&row.affected_task_ids.includes(first)));
  assert.ok(changes.some((row:any)=>row.change_kind==="commitment_removed"));
  await rejects(q("select save_work_plan($1,$2,1,'weekly','2026-10-12','2026-10-18',$3,'Conflito',array[$4::bigint],false,'Outra edição')",[coordinator,plan,team,second]),/alterado por outra sessão/i);
  await rejects(q("select save_work_plan($1,null,null,'daily','2026-10-12','2026-10-12',$2,'Inválido',array[99999999::bigint],false)",[coordinator,team]),/inexistente|fora da equipe/i);
 });
 it("membro não vê trabalho alheio pela mera associação à equipe",async()=>{
  const id=(await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,responsible_team_id,client_ref_id) values('Outro cliente','Revisor','collab:other-person',$1,$2,$3) returning id",[reviewer,team,otherClient]))[0].id;
  assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') ok",[member,id]))[0].ok,false);
  assert.equal((await q("select maia_can_access_work_task($1,$2,'trabalho.ver') ok",[coordinator,id]))[0].ok,true);
 });
 it("estado não pula revisão/aprovação e registra data de conclusão",async()=>{
  const id=await task("collab:review",",reviewer_person_id");
  await rejects(q("select update_collaborative_work_task($1,$2,1,'review','{\"outcome\":\"approved\",\"comment\":\"Conferido\"}')",[reviewer,id]),/não está em revisão/i);
  await q("select update_collaborative_work_task($1,$2,1,'status','{\"status\":\"in_progress\"}')",[member,id]);
  await rejects(q("select update_collaborative_work_task($1,$2,2,'status','{\"status\":\"completed\",\"evidence\":\"Tentativa de atalho\"}')",[member,id]),/transição/i);
  await q("select update_collaborative_work_task($1,$2,2,'status','{\"status\":\"review\"}')",[member,id]);
  await rejects(q("select update_collaborative_work_task($1,$2,3,'status','{\"status\":\"completed\",\"evidence\":\"Tentativa de atalho\"}')",[member,id]),/transição/i);
  await q("select update_collaborative_work_task($1,$2,3,'review','{\"outcome\":\"approved\",\"comment\":\"Entrega conferida\"}')",[reviewer,id]);
  const completed=(await q("select workflow_status,completed_at from work_tasks where id=$1",[id]))[0];
  assert.equal(completed.workflow_status,"completed");assert.ok(completed.completed_at);
  await rejects(q("select update_collaborative_work_task($1,$2,4,'status','{\"status\":\"in_progress\"}')",[member,id]),/encerrado/i);
 });
 it("redistribuição, dependências e artefatos executam com evidência e revisão",async()=>{
  const id=await task("collab:handoff"),dependency=await task("collab:dependency");
  await q("select update_collaborative_work_task($1,$2,1,'reassign',$3::jsonb)",[coordinator,id,JSON.stringify({person_id:reviewer,team_id:team,reason:"Passagem com briefing e critérios"})]);
  assert.equal((await q("select responsible_person_id from work_tasks where id=$1",[id]))[0].responsible_person_id,reviewer);
  await q("select update_collaborative_work_task($1,$2,2,'dependency',$3::jsonb)",[coordinator,id,JSON.stringify({depends_on:dependency,reason:"Aguardar briefing"})]);
  await rejects(q("select update_collaborative_work_task($1,$2,1,'dependency',$3::jsonb)",[coordinator,dependency,JSON.stringify({depends_on:id,reason:"Ciclo inválido"})]),/circular/i);
  await rejects(q("select update_collaborative_work_task($1,$2,3,'status','{\"status\":\"in_progress\"}')",[coordinator,id]),/dependências/i);
  await q("select update_collaborative_work_task($1,$2,3,'artifact','{\"label\":\"Briefing\",\"uri\":\"https://example.test/briefing\",\"evidence_kind\":\"reference\"}')",[coordinator,id]);
  assert.equal((await q("select count(*)::int n from work_task_artifacts where work_task_id=$1",[id]))[0].n,1);
 });
 it("revogar coordenação impede novas escritas e capacidade usa somente a semana informada",async()=>{
  await q("select save_work_capacity($1,$2,$3,'2026-10-12',40,8,'Ausência informada',null)",[coordinator,member,team]);
  await rejects(q("select save_work_capacity($1,$2,$3,'2026-10-13',40,8,null,null)",[coordinator,member,team]),/segunda-feira/i);
  await q("select save_work_scope_role($1,$2,'responsavel_cliente',null,$3,null,false)",[owner,coordinator,client]);
  await q("update work_team_members set active=false where team_id=$1 and person_id=$2",[team,coordinator]);
  await rejects(q("select save_work_capacity($1,$2,$3,'2026-10-19',40,0,null,null)",[coordinator,member,team]),/fora do escopo/i);
  await rejects(save(coordinator,"project",project,1,{client_id:client,name:"Não autorizado",status:"active"}),/fora do escopo/i);
 });
});


describe("sincronização do contrato compartilhado WhatsApp e painel",()=>{
 it("escritas cruzadas são visíveis e revogação remove o próximo contexto",async()=>{
  const db=temporarySupabase(local);
  const auth=String((await q("insert into auth.users(email) values('shared-workflow@example.test') returning id"))[0].id);
  const person=String((await q("insert into people(name,role,auth_user_id) values('Pessoa sincronizada','equipe',$1) returning id",[auth]))[0].id);
  const team=String((await q("insert into work_teams(name) values('Equipe sincronizada') returning id"))[0].id);
  await q("insert into work_team_members(team_id,person_id) values($1,$2)",[team,person]);
  await q("insert into person_permissions(person_id,permission_code) values($1,'painel.ver'),($1,'trabalho.ver'),($1,'trabalho.atualizar'),($1,'indicadores.ver')",[person]);
  const task=Number((await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,responsible_team_id) values('Trabalho sincronizado','Pessoa sincronizada','shared:sync',$1,$2) returning id",[person,team]))[0].id);
  const identity=await identityByAuthUser(db,auth);
  await executeCollaborationCommand(db,identity,{action:"task_action",taskId:task,revision:1,operation:"status",payload:{status:"in_progress"}},"whatsapp");
  const panel=await collaborationView(db,await identityByAuthUser(db,auth));
  assert.equal(panel.tasks.find(row=>row.id===task)?.workflow_status,"in_progress");
  await executeCollaborationCommand(db,await identityByAuthUser(db,auth),{action:"task_action",taskId:task,revision:2,operation:"edit",payload:{title:"Atualizado no painel",reason:"Briefing atualizado"}},"panel");
  const maia=await scopedWorkTasksView(db,await identityByAuthUser(db,auth));
  assert.equal(maia.find(row=>row.id===task)?.title,"Atualizado no painel");
  await q("insert into maia_member_access_modes(person_id,permission_code,mode,updated_by) values($1,'trabalho.ver','bloqueado','teste')",[person]);
  assert.equal((await scopedWorkTasksView(db,await identityByAuthUser(db,auth))).length,0);
 });
 it("contexto de uma tarefa não abre todos os projetos e entregáveis do cliente",async()=>{
  const db=temporarySupabase(local);
  const auth=String((await q("insert into auth.users(email) values('portfolio-isolation@example.test') returning id"))[0].id);
  const person=String((await q("insert into people(name,role,auth_user_id) values('Membro carteira isolada','equipe',$1) returning id",[auth]))[0].id);
  const client=String((await q("insert into maia_clients(name) values('Cliente carteira isolada') returning id"))[0].id);
  const projects=await q("insert into work_projects(client_id,name) values($1,'Projeto necessário'),($1,'Projeto reservado') returning id",[client]);
  const deliverables=await q("insert into work_deliverables(project_id,title) values($1,'Entregável necessário'),($1,'Entregável reservado') returning id",[projects[0].id]);
  await q("insert into person_permissions(person_id,permission_code) values($1,'painel.ver'),($1,'trabalho.ver')",[person]);
  await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,project_ref_id,deliverable_id) values('Tarefa escopada','Membro','shared:scope',$1,$2,$3)",[person,projects[0].id,deliverables[0].id]);
  const view=await collaborationView(db,await identityByAuthUser(db,auth));
  assert.deepEqual(view.projects.map(row=>row.id),[projects[0].id]);
  assert.deepEqual(view.deliverables.map(row=>row.id),[deliverables[0].id]);
  assert.equal(view.externalMetrics.length,0);
 });
 it("KPI e detalhes abrangem mais de mil tarefas sem truncar a população",async()=>{
  const db=temporarySupabase(local);
  const auth=String((await q("insert into auth.users(email) values('complete-metrics@example.test') returning id"))[0].id);
  const person=String((await q("insert into people(name,role,auth_user_id) values('Membro mil tarefas','equipe',$1) returning id",[auth]))[0].id);
  await q("insert into person_permissions(person_id,permission_code) values($1,'painel.ver'),($1,'trabalho.ver'),($1,'indicadores.ver')",[person]);
  await q("insert into work_tasks(title,responsible,request_key,responsible_person_id,workflow_status) select 'Trabalho '||n,'Membro','shared:metric:'||n,$1,'in_progress' from generate_series(1,1005) n",[person]);
  const view=await collaborationView(db,await identityByAuthUser(db,auth));
  const metric=view.metrics.find(row=>row.code==="individual.open_wip");
  assert.equal(view.tasks.length,1005);assert.equal(metric?.value,1005);assert.equal(metric?.recordIds.length,1005);
 });
});

describe("administração individual de acessos", () => {
  it("uma aprovação vinculada a pessoa/operação/recurso só é consumida uma vez", async () => {
    const binding = JSON.stringify({ requester: "5511990000000", operation: "mcp__claude_ai_Google_Drive__search_files", resource: "hash-recurso", taskId: 7 });
    const row = (await q("insert into approvals(tool_name,status,payload,expires_at) values('search_files','approved',$1::jsonb,now()+interval '10 minutes') returning id", [binding]))[0];
    const claim = (payload: string) => q("update approvals set status='consumed' where id=$1 and status='approved' and expires_at>now() and payload @> $2::jsonb returning id", [row.id, payload]);
    assert.equal((await claim(JSON.stringify({ requester: "5511888888888" }))).length, 0);
    assert.equal((await claim(binding)).length, 1);
    assert.equal((await claim(binding)).length, 0);
  });
  it("grava modo e auditoria atomicamente sem alterar concessão da equipe", async () => {
    const person = (await q("insert into people(name,role) values('Membro teste acesso','equipe') returning id"))[0].id;
    const group = (await q("insert into maia_access_groups(name) values('Equipe teste acesso') returning id"))[0].id;
    await q("insert into maia_access_group_members(access_group_id,person_id) values($1,$2)", [group, person]);
    await q("insert into maia_access_group_permissions(access_group_id,permission_code) values($1,'sheets.ler')", [group]);
    await local.db.exec("set role service_role");
    try {
      await q("select set_config('request.jwt.claim.role','service_role',false)");
      await q("select set_maia_member_access_mode($1,'sheets.ler','bloqueado','5511990000000')", [person]);
      await q("select set_maia_member_access_mode($1,'sheets.ler','aprovacao','5511990000000')", [person]);
    } finally { await local.db.exec("reset role"); await q("select set_config('request.jwt.claim.role','',false)"); }
    assert.equal((await q("select mode from maia_member_access_modes where person_id=$1 and permission_code='sheets.ler'", [person]))[0].mode, "aprovacao");
    assert.equal((await q("select count(*)::int as n from maia_member_access_audit where person_id=$1", [person]))[0].n, 2);
    assert.equal((await q("select count(*)::int as n from maia_access_group_permissions where access_group_id=$1", [group]))[0].n, 1);
    assert.equal((await q("select count(*)::int as n from person_permissions where person_id=$1 and permission_code='sheets.ler'", [person]))[0].n, 0);
    await local.db.exec("set role anon");
    try {
      await rejects(q("select set_maia_member_access_mode($1,'sheets.ler','permitido','falso')", [person]), /permission denied/i);
      await rejects(q("select * from maia_member_access_audit where person_id=$1", [person]), /permission denied/i);
    } finally { await local.db.exec("reset role"); }
    await local.db.exec("set role authenticated");
    try {
      await rejects(q("select set_maia_member_access_mode($1,'sheets.ler','permitido','5511990000000')", [person]), /Solicitante não autenticado|Somente proprietário/i);
      assert.equal((await q("select * from maia_member_access_modes where person_id=$1", [person])).length, 0);
    } finally { await local.db.exec("reset role"); }
  });
});

describe("núcleo: isolamento e execução sem replay", () => {
  it("uma sessão ativa por escopo inclusive sem cliente; arquivos permanecem históricos", async () => {
    const owner = "5511990000000";
    const args = ["whatsapp", `dm:${owner}`, owner, "owner_private"];
    const insert = () => q("insert into maia_sessions(channel,conversation_key,requester_key,scope_kind) values($1,$2,$3,$4) returning id", args);
    const first = (await insert())[0].id;
    await rejects(insert(), /duplicate key/i);
    await q("update maia_sessions set status='archived' where id=$1", [first]);
    const second = (await insert())[0].id;
    await q("update maia_sessions set status='archived' where id=$1", [second]);
    assert.ok((await insert())[0].id);
    assert.equal((await q("select count(*)::int as n from maia_sessions where requester_key=$1", [owner]))[0].n, 3);
  });

  it("reserva etapa uma vez, sem reclamar lease vencido ou resultado externo incerto", async () => {
    const plan = (await q("insert into maia_plans(title) values('Plano teste lease') returning id"))[0].id;
    await q("insert into maia_plan_steps(plan_id,step_no,text) values($1,1,'Ação externa')", [plan]);
    const claim = () => q("select (claim_maia_plan_step($1,1,'worker',1)).status as status", [plan]);
    assert.equal((await claim())[0].status, "leased");
    await q("update maia_plan_steps set lease_until=now()-interval '1 second' where plan_id=$1", [plan]);
    assert.equal((await claim())[0].status, null);
    await q("update maia_plan_steps set status='uncertain' where plan_id=$1", [plan]);
    assert.equal((await claim())[0].status, null);
  });

  it("espelha planos existentes em etapas e cancela só as não iniciadas", async () => {
    const plan = (await q("insert into maia_plans(title,steps) values('Plano teste etapas','[{\"text\":\"Primeira\",\"done\":true},{\"text\":\"Segunda\",\"done\":false},{\"text\":\"Terceira\",\"done\":false}]'::jsonb) returning id"))[0].id;
    const before = await q("select step_no,status,depends_on from maia_plan_steps where plan_id=$1 order by step_no", [plan]);
    assert.deepEqual(before.map((r) => r.status), ["done", "pending", "pending"]);
    assert.deepEqual(before[2].depends_on, [2]);
    await q("update maia_plan_steps set status='running' where plan_id=$1 and step_no=2", [plan]);
    await q("update maia_plans set status='cancelled' where id=$1", [plan]);
    const after = await q("select status from maia_plan_steps where plan_id=$1 order by step_no", [plan]);
    assert.deepEqual(after.map((r) => r.status), ["done", "running", "cancelled"]);
  });

  it("evento do plano é reservado atomicamente e evento anterior ao plano não retoma", async () => {
    const waiting = JSON.stringify({ type: "approval", id: 123 });
    const plan = (await q("insert into maia_plans(title,waiting) values('Plano teste evento',$1::jsonb) returning id", [waiting]))[0].id;
    const claim = (key: string, at = new Date().toISOString()) => q("select claim_maia_waiting_plan($1,$2::jsonb,$3,$4::timestamptz) as ok", [plan, waiting, key, at]);
    assert.equal((await claim("evento-antigo", "2000-01-01T00:00:00Z"))[0].ok, false);
    assert.equal((await claim("evento-123"))[0].ok, true);
    assert.equal((await claim("evento-123"))[0].ok, false);
    assert.equal((await q("select count(*)::int as n from maia_plan_resumptions where plan_id=$1", [plan]))[0].n, 1);
  });

  it("reserva rotina só na hora agendada e não repete execução interrompida", async () => {
    const schedule = (await q("insert into maia_schedules(owner_key,instruction,schedule_kind,schedule_value,destination,status,next_run_at) values('owner','Resumo','once','2026-10-16T00:00:00Z','owner','active',now()-interval '1 minute') returning id,next_run_at"))[0];
    const run = () => q("select (claim_maia_schedule_run($1,$2,'worker',1)).status as status", [schedule.id, schedule.next_run_at]);
    assert.equal((await run())[0].status, "leased");
    await q("update maia_schedule_runs set lease_until=now()-interval '1 second' where schedule_id=$1", [schedule.id]);
    assert.equal((await run())[0].status, null);
    await q("update maia_schedules set status='paused' where id=$1", [schedule.id]);
    assert.equal((await run())[0].status, null);
  });

  it("retenção remove história de membro/grupo e preserva a do owner", async () => {
    const member = (await q("insert into maia_sessions(channel,conversation_key,requester_key,scope_kind) values('whatsapp','dm:5511990000001','5511990000001','member_private') returning id"))[0].id;
    const owner = (await q("select id from maia_sessions where requester_key='5511990000000' and status='active'"))[0].id;
    await q("insert into maia_session_messages(session_id,at,author,text,source) values($1,now()-interval '8 days','member','antigo','whatsapp'),($2,now()-interval '8 days','owner','preservado','whatsapp')", [member, owner]);
    const recent = (await q("insert into maia_session_messages(session_id,author,text,source) values($1,'member','recente','whatsapp') returning id", [member]))[0].id;
    await q("insert into maia_context_summaries(session_id,covers_through_message_id,source,summary,source_message_count) values($1,$2,'worker','contém texto antigo',2)", [member, recent]);
    assert.equal((await q("select purge_maia_scoped_history() as n"))[0].n, 1);
    assert.equal((await q("select count(*)::int as n from maia_session_messages where session_id=$1", [member]))[0].n, 1);
    assert.equal((await q("select count(*)::int as n from maia_context_summaries where session_id=$1", [member]))[0].n, 0);
    assert.equal((await q("select count(*)::int as n from maia_session_messages where session_id=$1", [owner]))[0].n, 1);
  });

  it("resumo registra cobertura sem apagar a mensagem de origem", async () => {
    const session = (await q("select id from maia_sessions where requester_key='5511990000000' and status='active'"))[0].id;
    const message = (await q("insert into maia_session_messages(session_id,author,text,source) values($1,'owner','decisão original','whatsapp') returning id", [session]))[0].id;
    await q("insert into maia_context_summaries(session_id,covers_through_message_id,source,summary,source_message_count) values($1,$2,'worker','decisão resumida',1)", [session, message]);
    await rejects(q("insert into maia_context_summaries(session_id,covers_through_message_id,source,summary,source_message_count) values($1,$2,'worker','duplicado',1)", [session, message]), /duplicate key/i);
    assert.equal((await q("select text from maia_session_messages where id=$1", [message]))[0].text, "decisão original");
  });

  it("skill proposta exige ativação explícita e troca versão sem duas ativas", async () => {
    const first = (await q("insert into maia_skills(slug,version,description,instructions) values('teste-seguro','1','Teste','Consultar') returning id"))[0].id;
    const second = (await q("insert into maia_skills(slug,version,description,instructions) values('teste-seguro','2','Teste','Consultar') returning id"))[0].id;
    assert.equal((await q("select status from maia_skills where id=$1", [first]))[0].status, "proposal");
    await q("select activate_maia_skill($1,'owner-test')", [first]);
    await q("select activate_maia_skill($1,'owner-test')", [second]);
    const statuses = await q("select version,status,approved_by from maia_skills where slug='teste-seguro' order by version");
    assert.deepEqual(statuses.map((r) => r.status), ["archived", "active"]);
    assert.equal(statuses[1].approved_by, "owner-test");
  });

  it("subagente só é reservado uma vez e cancelado não pode concluir", async () => {
    const first = (await q("insert into maia_subagents(objective) values('Analisar contexto') returning id"))[0].id;
    const second = (await q("insert into maia_subagents(objective) values('Revisar contexto') returning id"))[0].id;
    assert.equal((await q("select (claim_maia_subagent($1,1)).status as status", [first]))[0].status, "running");
    assert.equal((await q("select (claim_maia_subagent($1,1)).status as status", [second]))[0].status, null);
    await q("update maia_subagents set status='cancelled' where id=$1", [first]);
    assert.equal((await q("select (claim_maia_subagent($1,1)).status as status", [first]))[0].status, null);
    assert.equal((await q("select (claim_maia_subagent($1,1)).status as status", [second]))[0].status, "running");
  });

  it("registro MCP impede nome duplicado em escopo sem cliente", async () => {
    await q("insert into maia_mcp_servers(owner_key,name,transport,endpoint) values('owner-test','externo','http','https://mcp.example.test')");
    await rejects(q("insert into maia_mcp_servers(owner_key,name,transport,endpoint) values('owner-test','externo','http','https://mcp.example.test')"), /duplicate key/i);
  });
});

describe("clientes e grupos de acesso", () => {
  after(async () => { await q("delete from group_messages where conv='8800@g.us'"); });
  let clientA: unknown; let clientB: unknown; let person: unknown; let access: unknown;
  const save = (revision: unknown, permissions = ["conversa.maia"]) => q("select save_maia_access_group($1,$2,'Equipe teste organização',$3,true,$4::uuid[],$5::text[]) as id",[access ?? null,revision,clientA,[person],permissions]);
  it("salva grupo, membros e permissões em uma transação; preserva edição concorrente", async () => {
    clientA = (await q("insert into maia_clients(name) values('Cliente teste A') returning id"))[0].id;
    clientB = (await q("insert into maia_clients(name) values('Cliente teste B') returning id"))[0].id;
    person = (await q("insert into people(name,role) values('Membro teste organização','equipe') returning id"))[0].id;
    await local.db.exec("set role service_role");
    try { access = (await save(null))[0].id; } finally { await local.db.exec("reset role"); }
    await save(1);
    await rejects(save(1),/outra sessão/i);
    await rejects(save(null),/outra sessão/i);
    await rejects(save(2,["permissao.inexistente"]),/foreign key/i);
    assert.equal((await q("select revision from maia_access_groups where id=$1",[access]))[0].revision,2);
    assert.deepEqual((await q("select permission_code from maia_access_group_permissions where access_group_id=$1",[access])).map((r)=>r.permission_code),["conversa.maia"]);
    await rejects(save(2,["escrita.aprovar"]),/check/i);
  });
  it("anon é bloqueado; membro não lê cadastro global e owner lê sem poder escrever pelo cliente", async () => {
    const authId = (await q("insert into auth.users(email) values('owner-organization@example.test') returning id"))[0].id;
    await q("insert into people(name,role,auth_user_id) values('Owner teste organização','proprietario',$1)",[authId]);
    const tables = ["maia_clients","maia_access_groups","maia_access_group_members","maia_access_group_permissions","maia_groups"];
    await local.db.exec("set role anon");
    try { await rejects(q("select * from maia_clients"),/permission denied/i); } finally { await local.db.exec("reset role"); }
    await local.db.exec("set role authenticated");
    try {
      for (const table of tables) assert.equal((await q(`select * from ${table}`)).length,0);
      await q("select set_config('request.jwt.claim.sub',$1,false)",[authId]);
      assert.equal((await q("select * from maia_clients where id=$1",[clientA])).length,1);
      await rejects(q("insert into maia_clients(name) values('Não autorizado')"),/permission denied/i);
      await rejects(save(2),/permission denied/i);
    } finally { await local.db.exec("reset role"); await q("select set_config('request.jwt.claim.sub','',false)"); }
  });
  it("grupos WhatsApp e acessos pertencem ao mesmo cliente; revisão e histórico preservam separação", async () => {
    await q("insert into maia_groups(jid,name,source,kind,client_id,access_group_id) values('8800@g.us','Grupo teste cliente','cadastrado','cliente',$1,$2)",[clientA,access]);
    await rejects(q("insert into maia_groups(jid,name,kind,client_id,access_group_id) values('8801@g.us','Outro cliente','cliente',$1,$2)",[clientB,access]),/mesmo cliente/i);
    await rejects(q("select save_maia_access_group($1,2,'Equipe teste organização',$2,true,'{}','{}')",[access,clientB]),/corresponder/i);
    await rejects(q("insert into maia_groups(jid,name,kind) values('8802@g.us','Sem cliente','cliente')"),/check/i);
    await q("insert into group_messages(conv,participant,name,text) values('8800@g.us','test','Teste','Histórico A')");
    await q("update maia_groups set client_id=$1,access_group_id=null,revision=revision+1 where jid='8800@g.us'",[clientB]);
    await q("insert into group_messages(conv,participant,name,text) values('8800@g.us','test','Teste','Histórico B')");
    const rows = await q("select client_id,text from group_messages where conv='8800@g.us' order by id");
    assert.deepEqual(rows.map((r)=>r.client_id),[clientA,clientB]);
    assert.equal((await q("select text from group_messages where conv='8800@g.us' and client_id=$1",[clientB]))[0].text,"Histórico B");
    await q("insert into group_messages(conv,participant,name,text,at) values('8800@g.us','test','Teste','Texto antigo na fila','2000-01-01')");
    assert.equal((await q("select client_id from group_messages where text='Texto antigo na fila'"))[0].client_id,null);
  });
});

describe("regras alinhadas e conhecimento atômico", () => {
  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  const chunks = [{ secao: "Política", conteudo: "Conteúdo vigente", embedding: JSON.stringify(Array(384).fill(0.1)) }];
  const replace = (slug: string, hash: string, expected: string | null, input = chunks) => q("select replace_knowledge_document($1,'Regras','docs/regras-da-maia.md',$2,$3,$4::jsonb) as id", [slug, hash, expected, JSON.stringify(input)]);
  it("o banco reconstruído tem exatamente o catálogo aprovado", async () => {
    assert.deepEqual(validateRules(await q("select codigo,categoria,titulo,texto,ordem,ativa from maia_rules")), RULE_CATALOG);
  });
  it("a aplicação não reativa regra desativada nem sobrescreve edição concorrente", async () => {
    const migration = readFileSync(new URL("../../supabase/migrations/20261010175923_maia_knowledge_atomic_rules_alignment.sql", import.meta.url), "utf8");
    const activation = migration.slice(migration.indexOf("do $alignment$"));
    await q("update maia_rules set ativa=false where codigo='instagram'");
    try {
      await rejects(local.db.exec(activation), /mudou após a revisão/i);
      assert.equal((await q("select ativa from maia_rules where codigo='instagram'"))[0].ativa, false);
    } finally {
      await q("update maia_rules set ativa=true where codigo='instagram'");
    }
  });
  it("troca documento e checksum juntos; rejeita escritor com versão antiga", async () => {
    const created = await replace("test-atomic", firstHash, null);
    assert.ok(created[0].id);
    await replace("test-atomic", secondHash, firstHash);
    await rejects(replace("test-atomic", firstHash, firstHash), /alterado durante/i);
    const row = (await q("select checksum,ativo from knowledge_sources where slug='test-atomic'"))[0];
    assert.equal(row.checksum, secondHash);
    assert.equal(row.ativo, true);
    assert.equal((await q("select count(*)::int as n from knowledge_chunks where source_id=$1", [created[0].id]))[0].n, 1);
  });
  it("erro depois da remoção dos trechos reverte tudo na transação", async () => {
    const created = await replace("test-rollback", firstHash, null);
    await rejects(replace("test-rollback", secondHash, firstHash, [{ ...chunks[0], embedding: "[1,2]" }]), /dimensions/i);
    assert.equal((await q("select checksum from knowledge_sources where slug='test-rollback'"))[0].checksum, firstHash);
    assert.equal((await q("select conteudo from knowledge_chunks where source_id=$1", [created[0].id]))[0].conteudo, "Conteúdo vigente");
    await rejects(replace("test-rollback", secondHash, firstHash, []), /inválido/i);
  });
  it("fontes inativas não aparecem na busca e somente o servidor troca documentos", async () => {
    await replace("test-retired", firstHash, null);
    await q("update knowledge_sources set ativo=false where slug='test-retired'");
    const results = await q("select * from search_knowledge('Conteúdo vigente',$1::extensions.vector,100)", [chunks[0].embedding]);
    const retired = await q("select c.id from knowledge_chunks c join knowledge_sources s on s.id=c.source_id where s.slug='test-retired'");
    assert.ok(!results.some((r) => r.chunk_id === retired[0].id));
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await q("select has_function_privilege($1,'replace_knowledge_document(text,text,text,text,text,jsonb)','execute') as allowed", [role]))[0].allowed, false);
    }
    assert.equal((await q("select has_function_privilege('service_role','replace_knowledge_document(text,text,text,text,text,jsonb)','execute') as allowed"))[0].allowed, true);
  });
});

describe("recibos de mensagens de saída", () => {
  it("preserva o estado mais forte quando callbacks chegam fora de ordem", async () => {
    await q("select record_outbound_receipt('receipt-test-1','5511999999999','accepted')");
    await q("select record_outbound_receipt('receipt-test-1','5511999999999','read')");
    await q("select record_outbound_receipt('receipt-test-1','5511999999999','delivered')");
    await q("select record_outbound_receipt('receipt-test-1','5511999999999','accepted')");
    await q("select record_outbound_receipt('receipt-test-1','5511999999999','failed')");
    const row = (await q("select recipient,status from outbound_receipts where message_id='receipt-test-1'"))[0];
    assert.deepEqual(row, { recipient: "5511999999999", status: "read" });
    await rejects(q("select record_outbound_receipt('receipt-test-1','5511999999999','unknown')"), /Estado de recibo inválido/i);
    await rejects(q("insert into outbound_receipts(message_id,recipient,status) values('receipt-test-1','5511999999999','accepted')"), /unique/i);
  });
  it("remove somente recibos técnicos com mais de 30 dias", async () => {
    await q("insert into outbound_receipts(message_id,recipient,status,created_at) values('receipt-old','5511999999999','read',now()-interval '31 days'),('receipt-new','5511999999999','accepted',now())");
    await q("select purge_outbound_receipts()");
    assert.equal((await q("select message_id from outbound_receipts where message_id='receipt-old'")).length,0);
    assert.equal((await q("select message_id from outbound_receipts where message_id='receipt-new'")).length,1);
  });
});

describe("trabalhos criativos retomáveis", () => {
  it("cria o lote uma vez, reserva cada arte uma vez e retoma do checkpoint", async () => {
    const task = (await q("insert into tasks(channel,summary,status) values('whatsapp','Job criativo teste','em_andamento') returning id"))[0];
    const items = JSON.stringify([
      { briefing: "Story 1", format: "story", refs: [] },
      { briefing: "Story 2", format: "story", refs: [] },
    ]);
    const jobId = (await q("select create_creative_job($1,'Stories teste',$2::jsonb) as id", [task.id, items]))[0].id;
    assert.equal((await q("select create_creative_job($1,'Stories repetidos',$2::jsonb) as id", [task.id, items]))[0].id, jobId);
    assert.equal((await q("select count(*)::int as n from creative_job_items where job_id=$1", [jobId]))[0].n, 2);

    const first = (await q("select * from claim_next_creative_item()"))[0];
    assert.deepEqual([first.seq, first.prior_status, first.source_task_id], [1, "queued", task.id]);
    assert.equal((await q("select * from claim_next_creative_item()")).length, 0);

    await q("update creative_job_items set status='artifact_ready',artifact_path='/arte/story-1.png' where id=$1", [first.id]);
    const resumed = (await q("select * from claim_next_creative_item()"))[0];
    assert.deepEqual([resumed.seq, resumed.prior_status, resumed.artifact_path], [1, "artifact_ready", "/arte/story-1.png"]);
    assert.equal((await q("select status from creative_job_items where id=$1", [first.id]))[0].status, "preview_sending");
    await q("update creative_job_items set status='ready_for_review',message_id='draft-msg-1' where id=$1", [first.id]);
    const second = (await q("select * from claim_next_creative_item()"))[0];
    assert.deepEqual([second.seq, second.prior_status], [2, "queued"]);
  });

  it("protege conteúdo e RPCs de criação contra roles públicas", async () => {
    for (const table of ["creative_jobs", "creative_job_items"]) {
      assert.equal((await q("select relrowsecurity from pg_class where oid=$1::regclass", [`public.${table}`]))[0].relrowsecurity, true);
      assert.equal((await q("select has_table_privilege('anon',$1,'select') as allowed", [`public.${table}`]))[0].allowed, false);
      assert.equal((await q("select has_table_privilege('service_role',$1,'select') as allowed", [`public.${table}`]))[0].allowed, true);
    }
    assert.equal((await q("select has_function_privilege('authenticated','create_creative_job(bigint,text,jsonb)','execute') as allowed"))[0].allowed, false);
  });
});

describe("plano de eficácia: trabalho, lembretes e entrega", () => {
  it("impede lembretes duplicados da mesma tarefa e horário, preservando outros horários", async () => {
    const t = (await q("insert into work_tasks(title,responsible,due_at,request_key) values('Teste duplicidade','Owner','2030-01-01T15:00:00Z','test:dedupe') returning id"))[0];
    await rejects(q("insert into task_reminders(work_task_id,run_at,kind,request_key) values($1,'2030-01-01T12:00:00-03:00','manual','test:duplicate')", [t.id]), /já existe lembrete/i);
    const other = (await q("insert into task_reminders(work_task_id,run_at,kind,request_key) values($1,'2030-01-01T16:00:00Z','manual','test:other') returning id", [t.id]))[0];
    await rejects(q("update task_reminders set run_at='2030-01-01T15:00:00Z' where id=$1", [other.id]), /já existe lembrete/i);
    await rejects(q("update work_tasks set due_at='2030-01-01T16:00:00Z' where id=$1", [t.id]), /já existe lembrete/i);
    await q("update task_reminders set status='cancelled' where id=$1", [other.id]);
    await q("update work_tasks set due_at='2030-01-01T16:00:00Z' where id=$1", [t.id]);
  });
  it("cria histórico e lembrete de prazo na mesma transação; não duplica claim", async () => {
    const t = (await q("insert into work_tasks(title,responsible,due_at,request_key) values('Validar fluxo','Owner',now() - interval '1 minute','test:work') returning id,revision"))[0];
    assert.equal(t.revision,1);
    assert.equal((await q("select * from work_task_updates where work_task_id = $1",[t.id])).length,1);
    const claimed = await q("select * from claim_task_reminders(10)");
    assert.equal(claimed.length,1);
    assert.equal((await q("select * from claim_task_reminders(10)")).length,0);
    await rejects(q("update work_tasks set due_at = now() where id = $1",[t.id]),/em envio/i);
    await q("update task_reminders set status = 'failed' where id = $1",[claimed[0].id]);
    await q("update work_tasks set due_at = now() + interval '1 day' where id = $1",[t.id]);
    assert.equal((await q("select status from task_reminders where work_task_id = $1",[t.id]))[0].status,"pending");
    await rejects(q("update work_tasks set status = 'concluida' where id = $1",[t.id]),/check/i);
    await q("update work_tasks set status = 'concluida',completion_evidence = 'Documento entregue' where id = $1",[t.id]);
    assert.equal((await q("select status from task_reminders where work_task_id = $1",[t.id]))[0].status,"cancelled");
    assert.equal((await q("select * from work_task_updates where work_task_id = $1",[t.id])).length,3);
    await rejects(q("insert into task_reminders(work_task_id,run_at,kind,request_key) values($1,now(),'manual','test:closed')",[t.id]),/concluída/i);
    await rejects(q("insert into work_tasks(title,responsible,status,request_key) values('X','Owner','atrasada','test:invalid')"),/check/i);
  });
  it("entrega guarda ordem e não repete partes aceitas ou incertas", async () => {
    const t = (await q("insert into tasks(channel,kind,summary,status) values('whatsapp','conversa','Teste entrega','em_andamento') returning id"))[0];
    await q("insert into response_deliveries(task_id,part,recipient,text) values($1,0,'owner','Parte 1'),($1,1,'owner','Parte 2')",[t.id]);
    const first = await q("select * from claim_response_delivery($1)",[t.id]);
    assert.equal(first[0].part,0);
    assert.equal((await q("select * from claim_response_delivery($1)",[t.id])).length,0);
    await q("update response_deliveries set status = 'sent',message_id = 'test-msg' where id = $1",[first[0].id]);
    const second = await q("select * from claim_response_delivery($1)",[t.id]);
    assert.equal(second[0].part,1);
    await q("update response_deliveries set status = 'uncertain' where id = $1",[second[0].id]);
    assert.equal((await q("select * from claim_response_delivery($1)",[t.id])).length,0);
    await rejects(q("update response_deliveries set status = 'sent' where id = $1",[second[0].id]),/check/i);
  });
  it("tabelas privadas não são legíveis por anon e RPCs não são públicas", async () => {
    for (const table of ['work_tasks','work_task_updates','task_reminders','task_evaluations','response_deliveries']) {
      assert.equal((await q("select relrowsecurity from pg_class where oid = $1::regclass",[`public.${table}`]))[0].relrowsecurity,true);
      assert.equal((await q("select has_table_privilege('anon',$1,'select') as allowed",[`public.${table}`]))[0].allowed,false);
      assert.equal((await q("select has_table_privilege('service_role',$1,'select') as allowed",[`public.${table}`]))[0].allowed,true);
    }
    assert.equal((await q("select has_function_privilege('authenticated','claim_task_reminders(integer)','execute') as allowed"))[0].allowed,false);
  });
});

describe("migrações reconstroem o banco do zero", () => {
  it("todas as migrações do repositório aplicam em ordem", () => {
    assert.deepEqual(local.applied, listMigrations());
    assert.ok(local.applied.length >= 19);
  });

  it("nomes seguem o padrão do Supabase CLI e as versões são únicas", () => {
    assert.deepEqual(checkNames(listMigrations()), []);
    assert.equal(checkNames(["maia_sem_versao.sql"]).length, 1);
    assert.equal(checkNames(["20261009000000_a.sql", "20261009000000_b.sql"]).length, 1);
  });

  it("estruturas essenciais, funções RPC, constraints e RLS estão presentes", async () => {
    assert.deepEqual(checkEssentials(await local.snapshot()), []);
  });
  it("memória do owner tem RLS e só service_role acessa diretamente", async () => {
    assert.equal((await q("select relrowsecurity from pg_class where oid='public.owner_memories'::regclass"))[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await q("select has_table_privilege($1,'public.owner_memories','select') as allowed", [role]))[0].allowed, false);
    }
    assert.equal((await q("select has_table_privilege('service_role','public.owner_memories','select') as allowed"))[0].allowed, true);
    assert.equal((await q("select has_table_privilege('service_role','public.owner_memories','update') as allowed"))[0].allowed, true);
  });

  it("o código só usa tabelas e funções que as migrações criam", async () => {
    const rows = await local.snapshot();
    const tables = new Set(rows.filter((r) => r.kind === "tabela").map((r) => r.name));
    const functions = new Set(rows.filter((r) => r.kind === "funcao").map((r) => r.name.split("(")[0]));
    assert.deepEqual(missingStructures(scanUsage(), tables, functions), []);
  });

  it("detecta o uso de tabela ou função que nenhuma migração cria", () => {
    const usage = { tables: new Map([["tabela_nova", ["server/x.ts"]]]), rpcs: new Map([["funcao_nova", ["server/y.ts"]]]) };
    assert.equal(missingStructures(usage, new Set(["inbox"]), new Set(["claim_inbox"])).length, 2);
    assert.deepEqual(scanSource('db.from("kv").select(); db.rpc("claim_inbox", {})'), { tables: ["kv"], rpcs: ["claim_inbox"] });
  });

  it("a validação acusa estrutura essencial ausente", async () => {
    const rows = (await local.snapshot()).filter((r) => !(r.kind === "tabela" && r.name === "inbox"));
    assert.match(checkEssentials(rows).join(" "), /inbox/);
  });

  it("a fila aceita o tipo media e recusa tipo desconhecido", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload) values ('media', 'owner', '{}')");
    await rejects(local.db.exec("insert into public.inbox (kind, sender) values ('video', 'owner')"), /check/i);
    await local.db.exec("delete from public.inbox");
  });
});

describe("regras de migração", () => {
  it("comando destrutivo exige a marcação de aprovação", () => {
    assert.ok(findDestructive("drop table public.x;").includes("drop table"));
    assert.ok(findDestructive("alter table t drop column c;").includes("drop column"));
    assert.ok(findDestructive("delete from public.x;").includes("delete sem where"));
    assert.deepEqual(findDestructive("delete from public.x where id = 1;"), []);
    assert.deepEqual(findDestructive("-- drop table é só comentário\ncreate table a (id int);"), []);
    assert.equal(hasApprovalMark("-- destrutivo-aprovado: owner, remover tabela sem uso\ndrop table x;"), true);
    assert.equal(hasApprovalMark("drop table x;"), false);
  });

  it("a consulta remota é somente leitura", () => {
    assert.doesNotThrow(() => assertReadOnly("select 1"));
    assert.doesNotThrow(() => assertReadOnly("with a as (select 1) select * from a"));
    assert.doesNotThrow(() => assertReadOnly("select 'delete' as palavra"));
    assert.throws(() => assertReadOnly("drop table inbox"));
    assert.throws(() => assertReadOnly("select 1; delete from inbox"));
    assert.throws(() => assertReadOnly("update inbox set status = 'x'"));
  });
});

describe("detecção de divergência (drift)", () => {
  it("banco idêntico às migrações não tem divergência", async () => {
    const rows = await local.snapshot();
    const diff = diffSnapshots(rows, rows);
    assert.equal(hasDrift(diff), false);
    assert.match(formatDiff(diff), /Sem divergência/);
  });

  it("alteração manual no banco vira relatório", async () => {
    const expected = await local.snapshot();
    const actual = expected
      .filter((r) => r.name !== "contacts")
      .map((r) => (r.kind === "coluna" && r.name === "inbox.status" ? { ...r, detail: r.detail + " default 'x'" } : r))
      .concat([{ kind: "tabela", name: "criada_na_mao", detail: "rls=false force=false" }]);
    const diff = diffSnapshots(expected, actual);
    assert.equal(hasDrift(diff), true);
    assert.ok(diff.onlyActual.map((r) => r.name).includes("criada_na_mao"));
    assert.ok(diff.onlyExpected.map((r) => r.name).includes("contacts"));
    assert.ok(diff.changed.map((c) => c.name).includes("inbox.status"));
    const report = formatDiff(diff);
    assert.match(report, /criada_na_mao/);
    assert.doesNotMatch(report, /service_role_key|Bearer|token/i);
  });
});

describe("acesso: ninguém de fora lê o banco", () => {
  it("anon e authenticated não enxergam linhas das tabelas internas", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload) values ('text', 'owner', 'segredo')");
    for (const role of ["anon", "authenticated"]) {
      await local.db.exec(`set role ${role}`);
      try {
        assert.equal((await q("select * from public.inbox")).length, 0);
        assert.equal((await q("select * from public.group_messages")).length, 0);
        assert.equal((await q("select * from public.contacts")).length, 0);
      } finally {
        await local.db.exec("reset role");
      }
    }
    await local.db.exec("delete from public.inbox");
  });

  it("anon e authenticated não executam as funções internas", async () => {
    for (const role of ["anon", "authenticated"]) {
      await local.db.exec(`set role ${role}`);
      try {
        await rejects(q("select * from public.claim_inbox(1)"), /permission denied/i);
        await rejects(q("select public.purge_group_messages()"), /permission denied/i);
      } finally {
        await local.db.exec("reset role");
      }
    }
  });

  it("is_owner é falso sem sessão", async () => {
    assert.equal((await q("select public.is_owner() as v"))[0].v, false);
  });
});

describe("estruturas usadas pelos módulos (integração)", () => {
  it("fila inbox: claim_inbox reserva sem repetir e purge apaga o texto vencido", async () => {
    await local.db.exec("insert into public.inbox (kind, sender, payload, key_id) values ('text','owner','a','k1'), ('text','owner','b','k2')");
    const first = await q("select * from public.claim_inbox(1)");
    assert.equal(first.length, 1);
    assert.equal(first[0].status, "processando");
    const second = await q("select * from public.claim_inbox(10)");
    assert.equal(second.length, 1);
    assert.notEqual(second[0].id, first[0].id);
    await rejects(local.db.exec("insert into public.inbox (kind, sender, key_id) values ('text','owner','k1')"), /unique|duplicate/i);
    await local.db.exec("update public.inbox set expires_at = now() - interval '1 hour'");
    assert.equal((await q("select public.purge_inbox_payloads() as n"))[0].n, 2);
    await local.db.exec("delete from public.inbox");
  });

  it("agrupamento de mensagens: add_batch_item junta no mesmo lote", async () => {
    const a = (await q("select public.add_batch_item('dono', 1, 'oi', 15, 60) as id"))[0].id;
    const b = (await q("select public.add_batch_item('dono', 2, 'tudo bem', 15, 60) as id"))[0].id;
    assert.equal(b, a);
    assert.deepEqual(await q("select seq from public.batch_items where batch_id = $1 order by seq", [a]), [{ seq: 1 }, { seq: 2 }]);
    assert.equal((await q("select * from public.due_owner_batches()")).length, 0);
  });

  it("cota diária de imagens: claim respeita o limite e release devolve", async () => {
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, false);
    await q("select public.release_image_quota('2026-10-09')");
    assert.equal((await q("select public.claim_image_quota('2026-10-09', 2) as ok"))[0].ok, true);
  });

  it("agendamentos: claim_due_actions pega só o que venceu e uma vez", async () => {
    await local.db.exec(`insert into public.scheduled_actions (kind, group_jid, group_name, payload, run_at) values
      ('texto','1@g.us','G','{"text":"oi"}', now() - interval '1 minute'),
      ('texto','1@g.us','G','{"text":"depois"}', now() + interval '1 day')`);
    const due = await q("select * from public.claim_due_actions(5)");
    assert.equal(due.length, 1);
    assert.equal(due[0].status, "running");
    assert.equal((await q("select * from public.claim_due_actions(5)")).length, 0);
  });

  it("memória das conversas: reenvio da mesma mensagem é barrado e a limpeza apaga o antigo", async () => {
    await local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')");
    await rejects(local.db.exec("insert into public.group_messages (conv, text, key_id) values ('g1','oi','m1')"), /unique|duplicate/i);
    await local.db.exec("insert into public.group_messages (conv, text, at) values ('g1','velho', now() - interval '8 days')");
    assert.equal((await q("select public.purge_group_messages() as n"))[0].n, 1);
  });

  it("aprovações e permissões: papel de pessoa só aceita os valores previstos (regressão do people_role_check)", async () => {
    await local.db.exec("insert into public.people (name, role) values ('Ana', 'equipe')");
    await rejects(local.db.exec("insert into public.people (name, role) values ('Bia', 'membro')"), /people_role_check/);
    assert.equal((await q("select code from public.permission_catalog where code = 'mensagem.enviar'")).length, 1);
    await rejects(local.db.exec("insert into public.approvals (tool_name, status) values ('x', 'qualquer')"), /check/i);
  });

  it("grupos e contatos: grupo cadastrado é único e a origem é validada", async () => {
    await local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Teste')");
    await rejects(local.db.exec("insert into public.maia_groups (jid, name) values ('9@g.us', 'Outro')"), /unique|duplicate|pkey/i);
    await rejects(local.db.exec("insert into public.contacts (number, source) values ('5511999999999', 'invalida')"), /check/i);
    await local.db.exec("insert into public.outreach (number, text) values ('5511999999999', 'oi')");
  });

  it("registro de atividade de grupo conta mensagens", async () => {
    await q("select public.record_group_activity('5@g.us', now())");
    await q("select public.record_group_activity('5@g.us', now())");
    assert.equal((await q("select messages from public.group_activity where jid = '5@g.us'"))[0].messages, 2);
  });

  it("base de conhecimento: busca híbrida devolve o trecho com a fonte", async () => {
    await local.db.exec("insert into public.knowledge_sources (slug, titulo, origem, checksum) values ('s1', 'Regras', 'CLAUDE.md', 'abc')");
    const vec = `[${Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    await local.db.exec(`insert into public.knowledge_chunks (source_id, ordem, secao, conteudo, embedding) values (1, 1, 'Aprovação', 'A aprovação vale para uma única ação', '${vec}')`);
    const rows = await q("select * from public.search_knowledge('aprovação ação', $1::extensions.vector, 3)", [vec]);
    assert.ok(rows.length > 0);
    assert.equal(String(rows[0].titulo), "Regras");
  });

  it("roteamento multi-IA e Jev: saúde dos provedores e triagem aceitam os estados previstos", async () => {
    await local.db.exec("insert into public.provider_health (provider, state) values ('claude', 'healthy')");
    await rejects(local.db.exec("insert into public.provider_health (provider, state) values ('codex', 'quebrado')"), /check/i);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'agent_runs'")).map((r) => r.column_name);
    for (const c of ["tokens_in", "tokens_out", "cache_read_tokens", "cache_creation_tokens"]) assert.ok(cols.includes(c), c);
    const jev = (await q("select column_name from information_schema.columns where table_name = 'jev_triage'")).map((r) => r.column_name);
    assert.ok(jev.includes("intencao"));
  });

  it("escopo por recurso e retenção: RLS fechada, grant válido e memória durável preservada", async () => {
    const person = (await q("insert into public.people(name,role) values('Recurso','equipe') returning id"))[0].id;
    const grant = (await q("insert into public.maia_resource_access(person_id,resource_type,resource_id,capability,decision,source) values($1,'drive_file','file-1','read','allow','direct') returning id", [person]))[0];
    assert.ok(grant.id);
    await rejects(local.db.exec("insert into public.maia_resource_access(person_id,resource_type,resource_id,capability,decision,source) values('00000000-0000-0000-0000-000000000000','drive_file','x','read','maybe','direct')"), /check|foreign key/i);
    await local.db.exec("insert into public.messages(channel,author,text,at) values('whatsapp','owner','antiga',now()-interval '91 days')");
    const memory = (await q("insert into public.owner_memories(title,detail) values('Decisão durável','não apagar com mensagem') returning id"))[0].id;
    const cleaned = (await q("select public.purge_maia_raw_messages(now()-interval '90 days',now()-interval '7 days') as value"))[0].value as { messages: number };
    assert.equal(Number(cleaned.messages), 1);
    assert.equal((await q("select count(*)::int as n from public.owner_memories where id=$1", [memory]))[0].n, 1);
    await local.db.exec("set role authenticated");
    try { await rejects(q("select * from public.maia_resource_access"), /permission denied/i); }
    finally { await local.db.exec("reset role"); }
  });
});

describe("fontes gerenciais isoladas da operação",()=>{
 let source:string;
 const rows=JSON.stringify([{key:"pagamento-1",date:"2026-10-20",value:100}]);
 before(async()=>{source=String((await q("insert into panel_data_sources(name,metric_code,source_ref,range_ref,mapping,unit,basis,coverage,active) values('Recebimentos teste','finance.received','sheet_12345678','Dados!A1:C10',$1::jsonb,'BRL','Caixa','Agência',true) returning id",[JSON.stringify({key:"id",date:"data",value:"valor"})]))[0].id);});
 it("reserva uma vez e conclusão repetida não altera o lote",async()=>{
 const first=String((await q("select claim_panel_source($1,1) as id",[source]))[0].id);
 assert.ok(first);assert.equal((await q("select claim_panel_source($1,1) as id",[source]))[0].id,null);
 await q("select finish_panel_source($1,$2::jsonb,null)",[first,rows]);
 await q("select finish_panel_source($1,'[]'::jsonb,null)",[first]);
 assert.deepEqual((await q("select observations from panel_source_runs where id=$1",[first]))[0].observations,JSON.parse(rows));
 });
 it("erro preserva sucesso, duplicidade não publica lote e revisão mudou não promove dado antigo",async()=>{
 let run=String((await q("select claim_panel_source($1,1) as id",[source]))[0].id);
 await rejects(q("select finish_panel_source($1,$2::jsonb,null)",[run,JSON.stringify([{key:"dup",date:"2026-10-20",value:1},{key:"dup",date:"2026-10-20",value:2}])]),/duplicado/);
 await q("select finish_panel_source($1,null,'Falha de teste')",[run]);
 assert.equal((await q("select count(*)::int as n from panel_source_runs where source_id=$1 and status='ok'",[source]))[0].n,1);
 run=String((await q("select claim_panel_source($1,1) as id",[source]))[0].id);
 await q("update panel_data_sources set revision=2 where id=$1",[source]);await q("select finish_panel_source($1,$2::jsonb,null)",[run,rows]);
 assert.equal((await q("select status from panel_source_runs where id=$1",[run]))[0].status,'error');
 await q("update panel_data_sources set active=false where id=$1",[source]);assert.equal((await q("select claim_panel_source($1,2) as id",[source]))[0].id,null);
 });
 it("fonte duplicada e datas inválidas são recusadas",async()=>{
 await rejects(q("insert into panel_data_sources(name,metric_code,source_ref,range_ref,mapping,unit,basis,coverage) select name,metric_code,source_ref,range_ref,mapping,unit,basis,coverage from panel_data_sources where id=$1",[source]),/unique constraint/);
 await q("update panel_data_sources set active=true where id=$1",[source]);const run=String((await q("select claim_panel_source($1,2) as id",[source]))[0].id);
 await rejects(q("select finish_panel_source($1,$2::jsonb,null)",[run,JSON.stringify([{key:"bad",date:"2026-02-30",value:1}])]),/date|range/i);await q("select finish_panel_source($1,null,'Data inválida')",[run]);
 });
 it("roles públicas não leem dados nem executam coleta",async()=>{
 for(const role of ["anon","authenticated"]){await local.db.exec("set role "+role);try{
 for(const table of ["panel_data_sources","panel_source_runs","panel_source_health"])await rejects(q("select * from "+table),/permission denied/);
 await rejects(q("select claim_panel_source($1,2)",[source]),/permission denied/);await rejects(q("select finish_panel_source(gen_random_uuid(),'[]',null)"),/permission denied/);
 }finally{await local.db.exec("reset role");}}
 });
});
