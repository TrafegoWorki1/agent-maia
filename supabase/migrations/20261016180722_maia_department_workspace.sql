-- maia_department_workspace
-- O que muda: oportunidades internas e combinados de CS vinculados à carteira/tarefas existentes.
-- Código dependente: departmentWork.ts, API colaborativa e ferramentas compartilhadas.
-- Rollback: voltar código mantendo registros/histórico; nunca apagar uma migração aplicada.

create table public.work_department_records (
 id uuid primary key default gen_random_uuid(),
 kind text not null check (kind in ('opportunity','cs')),
 client_id uuid not null references public.maia_clients(id),
 project_id uuid references public.work_projects(id),
 contract_id uuid references public.work_contracts(id),
 work_task_id bigint references public.work_tasks(id),
 responsible_person_id uuid not null references public.people(id),
 responsible_team_id uuid references public.work_teams(id),
 title text not null check (length(trim(title)) between 1 and 200),
 details text not null default '' check (length(details)<=4000),
 status text not null,
 next_action text not null check (length(trim(next_action)) between 1 and 1000),
 next_action_at timestamptz,
 waiting_kind text check (waiting_kind in ('team','owner','client','external')),
 evidence text check (length(evidence)<=2000),
 loss_reason text check (length(loss_reason)<=1000),
 converted_project_id uuid unique references public.work_projects(id),
 origin text not null check (origin in ('whatsapp','panel','maia')),
 source_task_id bigint references public.tasks(id),
 request_key text not null check (length(request_key) between 1 and 200),
 created_by_person_id uuid not null references public.people(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision integer not null default 1 check (revision>0),
 unique(kind,request_key),
 check ((kind='opportunity' and status in ('prospecting','qualified','proposal','negotiation','won','lost','cancelled'))
     or (kind='cs' and status in ('pending','in_progress','waiting','completed','cancelled'))),
 check (status<>'lost' or nullif(trim(loss_reason),'') is not null),
 check (status<>'completed' or nullif(trim(evidence),'') is not null),
 check (status<>'waiting' or waiting_kind is not null),
 check (converted_project_id is null or (kind='opportunity' and status='won'))
);
create index work_department_records_client on public.work_department_records(client_id,kind,status);
create index work_department_records_person on public.work_department_records(responsible_person_id,next_action_at);
create index work_department_records_project on public.work_department_records(project_id);
create index work_department_records_contract on public.work_department_records(contract_id);
create index work_department_records_task on public.work_department_records(work_task_id);
create index work_department_records_team on public.work_department_records(responsible_team_id);
alter table public.work_department_records enable row level security;
revoke all on public.work_department_records from public,anon,authenticated;
grant all on public.work_department_records to service_role;

-- Executável só pelo backend. Escopo + capacidade são independentes; associação à equipe não basta.
create function public.maia_department_scope(p_actor uuid,p_client uuid,p_project uuid,p_team uuid,p_responsible uuid,p_capability text)
returns boolean language sql stable security definer set search_path='' as $$
 select (auth.uid() is null or p_actor is not distinct from public.current_person_id()) and
 exists(select 1 from public.people where id=p_actor and active) and (
 exists(select 1 from public.people where id=p_actor and active and role='proprietario') or (
 public.maia_effective_permission(p_actor,p_capability,p_client)='permitido' and (
 (coalesce(p_actor=p_responsible,false) and p_capability in ('trabalho.ver','trabalho.atualizar','tarefas.criar')) or
 exists(select 1 from public.work_scope_roles r where r.person_id=p_actor and r.active and (
  ((r.client_id=p_client or r.project_id=p_project) and r.role in ('coordenador','responsavel_cliente')) or
  (r.team_id=p_team and r.role='coordenador') or
  ((r.client_id=p_client or r.project_id=p_project) and r.role='membro' and p_capability='trabalho.ver'))) or
 exists(select 1 from public.work_team_members m join public.work_teams t on t.id=m.team_id and t.active
  where m.person_id=p_actor and m.team_id=p_team and m.active and m.membership_role='coordenador'))));
$$;
revoke all on function public.maia_department_scope(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.maia_department_scope(uuid,uuid,uuid,uuid,uuid,text) to service_role;

create function public.save_work_department_record(p_actor uuid,p_id uuid,p_revision integer,p_kind text,p_payload jsonb,p_reason text,p_origin text,p_source_task_id bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.work_department_records; v_after public.work_department_records; v_client uuid;
 v_project uuid; v_contract uuid; v_team uuid; v_person uuid; v_task bigint; v_existing uuid;
begin
 if p_origin not in ('panel','whatsapp','maia') or p_kind not in ('opportunity','cs') then raise exception 'Origem ou tipo inválido'; end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Alteração exige motivo'; end if;
 if p_origin='panel' and public.maia_effective_permission(p_actor,'painel.ver',null)<>'permitido' then raise exception 'Acesso ao painel revogado'; end if;
 if p_id is null and p_origin='panel' then raise exception 'Criação somente pela Maia no WhatsApp'; end if;
 v_client:=(p_payload->>'client_id')::uuid; v_project:=nullif(p_payload->>'project_id','')::uuid;
 v_contract:=nullif(p_payload->>'contract_id','')::uuid; v_team:=nullif(p_payload->>'responsible_team_id','')::uuid;
 v_person:=(p_payload->>'responsible_person_id')::uuid; v_task:=nullif(p_payload->>'work_task_id','')::bigint;
 if p_id is null then
  if nullif(p_payload->>'request_key','') is null then raise exception 'Criação exige chave de idempotência'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_kind||':'||(p_payload->>'request_key'),0));
  select id into v_existing from public.work_department_records where kind=p_kind and request_key=p_payload->>'request_key';
 end if;
 if p_id is not null or v_existing is not null then
  select * into v_before from public.work_department_records where id=coalesce(p_id,v_existing) for update;
  if v_before.id is null then raise exception 'Registro não encontrado'; end if;
  if v_before.kind<>p_kind or v_before.client_id is distinct from v_client or v_before.project_id is distinct from v_project then raise exception 'Não é permitido mover registro entre clientes ou projetos'; end if;
  if not public.maia_department_scope(p_actor,v_before.client_id,v_before.project_id,v_before.responsible_team_id,v_before.responsible_person_id,'trabalho.atualizar') then raise exception 'Alteração fora do escopo autorizado'; end if;
  if v_existing is not null then
   if v_before.created_by_person_id<>p_actor then raise exception 'Chave de outra pessoa'; end if;
   return to_jsonb(v_before);
  end if;
  if v_before.revision is distinct from p_revision then raise exception 'Registro alterado por outra sessão'; end if;
  if v_before.converted_project_id is not null then raise exception 'Oportunidade já convertida; consulte o projeto vinculado'; end if;
 else
  if not public.maia_department_scope(p_actor,v_client,v_project,v_team,v_person,'tarefas.criar') then raise exception 'Criação fora do escopo autorizado'; end if;
  -- Criar para si não permite escolher um cliente desconhecido.
  if not public.maia_can_manage_portfolio(p_actor,v_client,v_project,v_team) and not exists(
   select 1 from public.work_scope_roles where person_id=p_actor and active and role<>'financeiro' and (client_id=v_client or project_id=v_project))
   and not exists(select 1 from public.work_tasks where responsible_person_id=p_actor and client_ref_id=v_client and public.maia_can_access_work_task(p_actor,id,'trabalho.ver')) then raise exception 'Cliente fora do escopo autorizado'; end if;
 end if;
 if not exists(select 1 from public.maia_clients where id=v_client and active) or not exists(select 1 from public.people where id=v_person and active) then raise exception 'Cliente ou responsável inativo'; end if;
 if v_team is not null and not exists(select 1 from public.work_teams where id=v_team and active) then raise exception 'Equipe inativa'; end if;
 if v_project is not null and not exists(select 1 from public.work_projects where id=v_project and client_id=v_client) then raise exception 'Projeto não pertence ao cliente'; end if;
 if v_contract is not null and not exists(select 1 from public.work_contracts where id=v_contract and client_id=v_client) then raise exception 'Contrato não pertence ao cliente'; end if;
 if v_task is not null and not exists(select 1 from public.work_tasks where id=v_task and client_ref_id=v_client and (v_project is null or project_ref_id=v_project) and public.maia_can_access_work_task(p_actor,id,'trabalho.ver')) then raise exception 'Tarefa fora do escopo autorizado'; end if;
 if p_payload->>'status'='completed' and v_task is not null and exists(select 1 from public.work_tasks where id=v_task and workflow_status not in ('completed','cancelled')) then raise exception 'Concluir combinado exige tarefa vinculada encerrada'; end if;
 if p_kind='opportunity' and p_payload->>'status'='won' then raise exception 'Use a conversão em projeto para marcar como ganha'; end if;
 if v_before.id is not null and (v_person is distinct from v_before.responsible_person_id or v_team is distinct from v_before.responsible_team_id) and not public.maia_department_scope(p_actor,v_client,v_project,v_before.responsible_team_id,v_before.responsible_person_id,'trabalho.redistribuir') then raise exception 'Redistribuição fora do escopo autorizado'; end if;
 if (v_before.id is null and v_person<>p_actor or v_before.id is not null and (v_person is distinct from v_before.responsible_person_id or v_team is distinct from v_before.responsible_team_id)) and not exists(select 1 from public.people where id=p_actor and active and role='proprietario') then
  if v_team is null or not exists(select 1 from public.work_team_members where team_id=v_team and person_id=v_person and active) or not public.maia_department_scope(p_actor,v_client,v_project,v_team,null,'trabalho.redistribuir') then raise exception 'Responsável ou equipe destino fora do escopo autorizado'; end if;
 end if;
 if p_id is null then
  insert into public.work_department_records(kind,client_id,project_id,contract_id,work_task_id,responsible_person_id,responsible_team_id,title,details,status,next_action,next_action_at,waiting_kind,evidence,loss_reason,origin,source_task_id,request_key,created_by_person_id)
  values(p_kind,v_client,v_project,v_contract,v_task,v_person,v_team,trim(p_payload->>'title'),coalesce(p_payload->>'details',''),p_payload->>'status',trim(p_payload->>'next_action'),nullif(p_payload->>'next_action_at','')::timestamptz,nullif(p_payload->>'waiting_kind',''),nullif(p_payload->>'evidence',''),nullif(p_payload->>'loss_reason',''),p_origin,p_source_task_id,p_payload->>'request_key',p_actor) returning * into v_after;
 else
  update public.work_department_records set contract_id=v_contract,work_task_id=v_task,responsible_person_id=v_person,responsible_team_id=v_team,title=trim(p_payload->>'title'),details=coalesce(p_payload->>'details',''),status=p_payload->>'status',next_action=trim(p_payload->>'next_action'),next_action_at=nullif(p_payload->>'next_action_at','')::timestamptz,waiting_kind=nullif(p_payload->>'waiting_kind',''),evidence=nullif(p_payload->>'evidence',''),loss_reason=nullif(p_payload->>'loss_reason',''),revision=revision+1,updated_at=now() where id=p_id returning * into v_after;
 end if;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
 values(p_kind,v_after.id,p_actor,p_reason,case when v_before.id is not null then to_jsonb(v_before) end,to_jsonb(v_after)||jsonb_build_object('change_origin',p_origin));
 return to_jsonb(v_after);
end;
$$;
revoke all on function public.save_work_department_record(uuid,uuid,integer,text,jsonb,text,text,bigint) from public,anon,authenticated;
grant execute on function public.save_work_department_record(uuid,uuid,integer,text,jsonb,text,text,bigint) to service_role;

create function public.convert_work_opportunity(p_actor uuid,p_id uuid,p_revision integer,p_reason text,p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before public.work_department_records; v_after public.work_department_records; v_project jsonb;
begin
 if p_origin not in ('panel','whatsapp','maia') then raise exception 'Origem inválida'; end if;
 if p_origin='panel' and public.maia_effective_permission(p_actor,'painel.ver',null)<>'permitido' then raise exception 'Acesso ao painel revogado'; end if;
 if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Conversão exige motivo'; end if;
 select * into v_before from public.work_department_records where id=p_id and kind='opportunity' for update;
 if v_before.id is null then raise exception 'Oportunidade não encontrada'; end if;
 if not public.maia_department_scope(p_actor,v_before.client_id,v_before.project_id,v_before.responsible_team_id,v_before.responsible_person_id,'trabalho.planejar') or not public.maia_can_manage_portfolio(p_actor,v_before.client_id,v_before.project_id,v_before.responsible_team_id) then raise exception 'Conversão fora do escopo autorizado'; end if;
 if v_before.converted_project_id is not null then return jsonb_build_object('id',v_before.converted_project_id,'alreadyConverted',true); end if;
 if v_before.revision is distinct from p_revision then raise exception 'Registro alterado por outra sessão'; end if;
 if v_before.status not in ('qualified','proposal','negotiation') then raise exception 'Qualifique a oportunidade antes de converter'; end if;
 v_project:=public.save_work_portfolio(p_actor,'project',null,null,jsonb_build_object('client_id',v_before.client_id,'contract_id',v_before.contract_id,'name',v_before.title,'objective',v_before.details,'status','planned','responsible_person_id',v_before.responsible_person_id,'responsible_team_id',v_before.responsible_team_id),p_reason);
 update public.work_department_records set converted_project_id=(v_project->>'id')::uuid,status='won',revision=revision+1,updated_at=now() where id=p_id returning * into v_after;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
 values('opportunity',p_id,p_actor,p_reason,to_jsonb(v_before),to_jsonb(v_after)||jsonb_build_object('change_origin',p_origin));
 return v_project;
end;
$$;
revoke all on function public.convert_work_opportunity(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.convert_work_opportunity(uuid,uuid,integer,text,text) to service_role;

insert into public.metric_catalog(code,label,level,formula,population,period,source,unit,target,coverage_rule,financial) values
 ('commercial.open','Oportunidades abertas','commercial','contagem de oportunidades não encerradas','oportunidades autorizadas abertas','estado atual na leitura','work_department_records','registros',null,'Consulta completa do escopo autorizado, sem truncamento',false),
 ('commercial.win_rate','Ganho entre oportunidades encerradas','commercial','ganhas / (ganhas + perdidas) × 100','oportunidades ganhas ou perdidas; não é conversão por etapa','estado atual na leitura','work_department_records','%',null,'Indisponível sem oportunidades encerradas para formar denominador',false),
 ('cs.open','Combinados em aberto','cs','contagem de combinados não encerrados','combinados de CS autorizados abertos','estado atual na leitura','work_department_records','registros',null,'Consulta completa do escopo autorizado, sem truncamento',false),
 ('cs.overdue','Próximas ações de CS vencidas','cs','contagem de próximas ações abertas com prazo anterior à leitura','combinados abertos com prazo; os sem prazo ficam fora','estado atual na leitura','work_department_records','registros',null,'Indisponível sem retornos abertos com prazo informado',false)
on conflict(code) do nothing;

