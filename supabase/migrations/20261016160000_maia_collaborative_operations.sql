-- maia_collaborative_operations
-- Central colaborativa: identidade vinculada, escopos operacionais, fluxo de trabalho,
-- planejamento, capacidade, revisão e métricas sem substituir grupos de permissão.
-- Código dependente: panelIdentity, collaborativeWork, /api/collaboration, painel e ferramentas de tarefas.
-- Rollback: voltar o código; preservar estruturas e histórico. Remoção exige migration compensatória e backup.

insert into public.permission_catalog(code,label,description) values
 ('trabalho.ver','Ver trabalho autorizado','Consulta tarefas, entregáveis e projetos dentro dos escopos atribuídos.'),
 ('trabalho.atualizar','Atualizar trabalho','Atualiza estado, bloqueio, evidência e próxima ação no escopo autorizado.'),
 ('trabalho.revisar','Revisar entregas','Registra revisão e devolução em entregas atribuídas.'),
 ('trabalho.aprovar','Aprovar entregas','Aprova qualidade no fluxo interno; não autoriza publicação externa.'),
 ('trabalho.planejar','Planejar trabalho','Mantém prioridades, capacidade e baselines da equipe autorizada.'),
 ('trabalho.redistribuir','Redistribuir trabalho','Altera responsável, equipe e prioridade no escopo coordenado.'),
 ('indicadores.ver','Ver indicadores','Consulta métricas calculadas sobre registros autorizados.'),
 ('financeiro.ver','Ver financeiro autorizado','Consulta somente dados financeiros de clientes explicitamente atribuídos.'),
 ('operacao.administrar','Administrar operação','Mantém equipes, papéis operacionais e vínculos de escopo.')
on conflict(code) do nothing;

create table public.work_teams (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 100),
 access_group_id uuid references public.maia_access_groups(id),
 active boolean not null default true,
 revision integer not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index work_teams_name on public.work_teams(lower(trim(name)));

create table public.work_team_members (
 team_id uuid not null references public.work_teams(id) on delete cascade,
 person_id uuid not null references public.people(id) on delete cascade,
 membership_role text not null default 'membro' check(membership_role in ('membro','coordenador')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key(team_id,person_id)
);
create index work_team_members_person on public.work_team_members(person_id,team_id) where active;

create table public.work_contracts (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.maia_clients(id),
 name text not null check(length(trim(name)) between 1 and 160),
 service_scope text not null check(length(trim(service_scope)) between 1 and 2000),
 status text not null default 'active' check(status in ('draft','active','paused','ended','cancelled')),
 starts_on date, ends_on date,
 responsible_person_id uuid references public.people(id), responsible_team_id uuid references public.work_teams(id),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create index work_contracts_client on public.work_contracts(client_id,status);

create table public.work_projects (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null references public.maia_clients(id),
 contract_id uuid references public.work_contracts(id),
 name text not null check(length(trim(name)) between 1 and 160),
 objective text,
 status text not null default 'active' check(status in ('planned','active','on_hold','completed','cancelled')),
 responsible_person_id uuid references public.people(id),
 responsible_team_id uuid references public.work_teams(id),
 starts_on date, due_on date,
 revision integer not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.work_projects add constraint work_projects_dates check(due_on is null or starts_on is null or due_on>=starts_on);
create index work_projects_client on public.work_projects(client_id,status);
create index work_projects_team on public.work_projects(responsible_team_id,status);

create or replace function public.validate_work_project_contract() returns trigger language plpgsql set search_path='' as $$
declare v_client uuid;
begin
 if NEW.contract_id is not null then
  select client_id into v_client from public.work_contracts where id=NEW.contract_id;
  if v_client is null or v_client is distinct from NEW.client_id then raise exception 'Contrato não corresponde ao cliente do projeto'; end if;
 end if;
 return NEW;
end;
$$;
create trigger work_projects_contract_scope before insert or update of contract_id,client_id on public.work_projects for each row execute function public.validate_work_project_contract();

create table public.work_deliverables (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.work_projects(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200),
 objective text, acceptance_criteria text,
 status text not null default 'pending' check(status in ('pending','in_progress','review','awaiting_approval','completed','cancelled')),
 due_at timestamptz, completed_at timestamptz,
 revision integer not null default 1 check(revision > 0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index work_deliverables_project on public.work_deliverables(project_id,status,due_at);

-- Uma pessoa pode acumular funções e cada função tem um escopo explícito.
create table public.work_scope_roles (
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.people(id) on delete cascade,
 role text not null check(role in ('membro','coordenador','responsavel_cliente','revisor','aprovador','financeiro')),
 team_id uuid references public.work_teams(id) on delete cascade,
 client_id uuid references public.maia_clients(id) on delete cascade,
 project_id uuid references public.work_projects(id) on delete cascade,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 check(num_nonnulls(team_id,client_id,project_id) = 1)
);
create unique index work_scope_roles_unique on public.work_scope_roles(person_id,role,coalesce(team_id,'00000000-0000-0000-0000-000000000000'),coalesce(client_id,'00000000-0000-0000-0000-000000000000'),coalesce(project_id,'00000000-0000-0000-0000-000000000000')) where active;
create index work_scope_roles_person on public.work_scope_roles(person_id,role) where active;

alter table public.work_tasks
 add column responsible_person_id uuid references public.people(id),
 add column responsible_team_id uuid references public.work_teams(id),
 add column reviewer_person_id uuid references public.people(id),
 add column approver_person_id uuid references public.people(id),
 add column client_ref_id uuid references public.maia_clients(id),
 add column project_ref_id uuid references public.work_projects(id),
 add column deliverable_id uuid references public.work_deliverables(id),
 add column objective text,
 add column briefing text,
 add column acceptance_criteria text,
 add column workflow_status text not null default 'pending' check(workflow_status in ('pending','in_progress','review','awaiting_approval','blocked','completed','cancelled')),
 add column priority smallint not null default 3 check(priority between 1 and 5),
 add column committed_due_at timestamptz,
 add column started_at timestamptz,
 add column blocked_at timestamptz,
 add column waiting_kind text check(waiting_kind is null or waiting_kind in ('team','owner','client','external')),
 add column block_reason text,
 add column estimated_effort_hours numeric(8,2) check(estimated_effort_hours is null or estimated_effort_hours >= 0),
 add column origin_kind text not null default 'legacy' check(origin_kind in ('legacy','whatsapp','panel','maia','integration')),
 add column created_by_person_id uuid references public.people(id),
 add column planned_week date,
 add column added_after_baseline boolean not null default false;
create index work_tasks_responsible_scope on public.work_tasks(responsible_person_id,workflow_status,committed_due_at);
create index work_tasks_team_scope on public.work_tasks(responsible_team_id,workflow_status,committed_due_at);
create index work_tasks_client_scope on public.work_tasks(client_ref_id,workflow_status,committed_due_at);
create index work_tasks_project_scope on public.work_tasks(project_ref_id,workflow_status);

create or replace function public.validate_collaborative_task_scope() returns trigger language plpgsql set search_path='' as $$
declare v_client uuid; v_project uuid;
begin
 if NEW.project_ref_id is not null then
  select client_id into v_client from public.work_projects where id=NEW.project_ref_id;
  if v_client is null then raise exception 'Projeto não encontrado'; end if;
  if NEW.client_ref_id is not null and NEW.client_ref_id is distinct from v_client then raise exception 'Cliente não corresponde ao projeto cadastrado'; end if;
  NEW.client_ref_id:=v_client;
 end if;
 if NEW.deliverable_id is not null then
  select project_id into v_project from public.work_deliverables where id=NEW.deliverable_id;
  if v_project is null or NEW.project_ref_id is distinct from v_project then raise exception 'Entregável não corresponde ao projeto da tarefa'; end if;
 end if;
 if NEW.responsible_team_id is not null and not exists(select 1 from public.work_teams where id=NEW.responsible_team_id and active) then raise exception 'Equipe responsável inativa ou inexistente'; end if;
 return NEW;
end;
$$;
create trigger work_tasks_collaborative_scope before insert or update of project_ref_id,client_ref_id,deliverable_id,responsible_team_id on public.work_tasks for each row execute function public.validate_collaborative_task_scope();

update public.work_tasks set
 workflow_status = case status when 'em_andamento' then 'in_progress' when 'concluida' then 'completed' else 'pending' end,
 committed_due_at = due_at,
 origin_kind = case when source_task_id is null then 'legacy' else 'maia' end;

create table public.work_task_dependencies (
 task_id bigint not null references public.work_tasks(id) on delete cascade,
 depends_on_task_id bigint not null references public.work_tasks(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(task_id,depends_on_task_id), check(task_id <> depends_on_task_id)
);
create index work_task_dependencies_parent on public.work_task_dependencies(depends_on_task_id);

create table public.work_task_history (
 id bigint generated always as identity primary key,
 work_task_id bigint not null references public.work_tasks(id) on delete cascade,
 at timestamptz not null default now(), actor_person_id uuid references public.people(id),
 actor_origin text not null check(actor_origin in ('panel','whatsapp','maia','worker','migration')),
 event_type text not null check(event_type in ('created','updated','status_changed','deadline_changed','priority_changed','reassigned','blocked','unblocked','handoff','reviewed','approved','returned','commented','artifact_added','plan_changed')),
 from_value jsonb, to_value jsonb, reason text, evidence text,
 revision integer not null
);
create index work_task_history_task on public.work_task_history(work_task_id,at desc,id desc);

create or replace function public.record_collaborative_task_creation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.work_task_history(work_task_id,actor_person_id,actor_origin,event_type,to_value,revision)
 values(NEW.id,NEW.created_by_person_id,case when NEW.origin_kind in ('panel','whatsapp','maia') then NEW.origin_kind else 'maia' end,'created',to_jsonb(NEW),NEW.revision);
 return NEW;
end;
$$;
create trigger work_task_collaborative_created after insert on public.work_tasks for each row execute function public.record_collaborative_task_creation();

create table public.work_task_artifacts (
 id uuid primary key default gen_random_uuid(), work_task_id bigint not null references public.work_tasks(id) on delete cascade,
 added_by uuid references public.people(id), label text not null, uri text not null,
 evidence_kind text not null default 'reference' check(evidence_kind in ('reference','draft','final','proof')),
 created_at timestamptz not null default now()
);
create index work_task_artifacts_task on public.work_task_artifacts(work_task_id,created_at);

create table public.work_task_reviews (
 id uuid primary key default gen_random_uuid(), work_task_id bigint not null references public.work_tasks(id) on delete cascade,
 reviewer_person_id uuid not null references public.people(id), outcome text not null check(outcome in ('approved','returned')),
 return_reason text check(return_reason is null or return_reason in ('error','quality','incomplete_brief','scope_change')),
 comment text, created_at timestamptz not null default now(),
 check((outcome='approved' and return_reason is null) or (outcome='returned' and return_reason is not null))
);
create index work_task_reviews_task on public.work_task_reviews(work_task_id,created_at desc);

create table public.work_plans (
 id uuid primary key default gen_random_uuid(), period_kind text not null check(period_kind in ('monthly','weekly','daily')),
 period_start date not null, period_end date not null, team_id uuid references public.work_teams(id),
 client_id uuid references public.maia_clients(id), project_id uuid references public.work_projects(id),
 objective text, status text not null default 'draft' check(status in ('draft','baselined','closed')),
 baseline_at timestamptz, baseline_by uuid references public.people(id), revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(period_end >= period_start), check(num_nonnulls(team_id,client_id,project_id) >= 1)
);
create index work_plans_period on public.work_plans(period_kind,period_start,period_end);

create table public.work_plan_items (
 plan_id uuid not null references public.work_plans(id) on delete cascade,
 work_task_id bigint not null references public.work_tasks(id) on delete cascade,
 planned_priority smallint not null check(planned_priority between 1 and 5),
 committed_effort_hours numeric(8,2) check(committed_effort_hours is null or committed_effort_hours >= 0),
 baseline_snapshot jsonb, added_after_baseline boolean not null default false,
 created_at timestamptz not null default now(), primary key(plan_id,work_task_id)
);

create table public.work_plan_changes (
 id bigint generated always as identity primary key, plan_id uuid not null references public.work_plans(id) on delete cascade,
 changed_by uuid not null references public.people(id), changed_at timestamptz not null default now(),
 change_kind text not null check(change_kind in ('urgency_added','priority_changed','commitment_removed','deadline_changed','plan_changed')),
 reason text not null, affected_task_ids bigint[] not null default '{}', prior_value jsonb, new_value jsonb
);
create index work_plan_changes_plan on public.work_plan_changes(plan_id,changed_at desc);

create table public.work_capacity (
 id uuid primary key default gen_random_uuid(), person_id uuid not null references public.people(id) on delete cascade,
 team_id uuid not null references public.work_teams(id) on delete cascade, week_start date not null,
 available_hours numeric(6,2) not null check(available_hours >= 0), absence_hours numeric(6,2) not null default 0 check(absence_hours >= 0),
 note text, revision integer not null default 1, updated_by uuid not null references public.people(id), updated_at timestamptz not null default now(),
 unique(person_id,team_id,week_start), check(absence_hours <= available_hours)
);

create table public.metric_catalog (
 code text primary key, label text not null, level text not null check(level in ('individual','team','creative','content','traffic','cs','commercial','projects','finance','maia')),
 formula text not null, population text not null, period text not null, source text not null, unit text not null,
 target text, coverage_rule text not null, financial boolean not null default false, active boolean not null default true
);
insert into public.metric_catalog(code,label,level,formula,population,period,source,unit,target,coverage_rule,financial) values
 ('individual.commitment_rate','Compromissos cumpridos','individual','concluídas no prazo / compromissos com prazo concluídos','tarefas atribuídas com committed_due_at','semana','work_tasks','percentual',null,'indisponível sem ao menos um compromisso concluído com prazo',false),
 ('individual.open_wip','Trabalho em andamento','individual','contagem de tarefas in_progress, review ou awaiting_approval','tarefas abertas atribuídas','agora','work_tasks','itens',null,'zero somente após consulta completa do escopo',false),
 ('team.throughput','Entregas no período','team','contagem de tarefas completed no período','tarefas da equipe autorizada','semana','work_tasks','entregas',null,'zero somente após consulta completa do escopo',false),
 ('team.cycle_time','Tempo de ciclo','team','média de completed_at - started_at','tarefas concluídas com ambos timestamps','semana','work_tasks','horas',null,'indisponível sem timestamps completos',false),
 ('team.blocked_aging','Bloqueios com mais de 48 horas','team','contagem de tarefas bloqueadas há ao menos 48h','tarefas bloqueadas no escopo','agora','work_tasks','itens',null,'zero somente após consulta completa do escopo',false),
 ('team.unplanned_after_baseline','Trabalho acrescentado após baseline','team','contagem de itens incluídos após baseline','itens adicionados ao plano após baseline','semana','work_plan_items','itens',null,'zero somente após consulta completa do escopo',false),
 ('team.predictability','Previsibilidade semanal','team','itens baseline concluídos / itens da baseline','itens do plano semanal baselined','semana','work_plan_items + work_tasks','percentual',null,'indisponível sem baseline',false),
 ('creative.first_review','Aprovação na primeira revisão','creative','tarefas aprovadas na primeira revisão / tarefas revisadas','tarefas com reviews','mês','work_task_reviews','percentual',null,'indisponível sem revisão registrada',false),
 ('creative.production_time','Tempo de produção','creative','média de conclusão menos início','tarefas criativas concluídas com timestamps','semana','work_tasks','horas',null,'indisponível sem timestamps completos e área criativa',false),
 ('content.calendar_adherence','Calendário cumprido','content','peças publicadas / peças previstas','calendário de conteúdo e publicações confirmadas','mês','fonte de publicação integrada','percentual',null,'indisponível: calendário e confirmação de publicação não conectados',false),
 ('content.approval_queue','Peças em aprovação','content','contagem de peças aguardando aprovação','entregas de conteúdo em aprovação','agora','work_tasks','itens',null,'indisponível: entregáveis ainda não classificados por objetivo e publicação',false),
 ('traffic.spend_pacing','Ritmo de investimento','traffic','investimento realizado / investimento planejado','campanhas com orçamento e gasto no período','semana','Meta Ads/Google Ads integrado','percentual',null,'indisponível sem coleta e orçamento persistido',false),
 ('traffic.cost_per_result','Custo por resultado','traffic','investimento / resultados definidos','campanhas com objetivo e resultados íntegros','mês','Meta Ads/Google Ads integrado','moeda',null,'indisponível sem fonte, objetivo e denominador compatíveis',false),
 ('cs.response_time','Tempo de retorno','cs','média de resposta menos entrada','pendências de atendimento com timestamps','semana','registro de atendimento','horas',null,'indisponível: eventos de atendimento ainda não persistidos',false),
 ('commercial.stage_conversion','Conversão por etapa','commercial','oportunidades avançadas / oportunidades da etapa','oportunidades com histórico de etapa','mês','funil comercial','percentual',null,'indisponível: pipeline de oportunidades não integrado',false),
 ('projects.milestone_on_time','Marcos no prazo','projects','marcos concluídos no prazo / marcos concluídos com prazo','marcos de projeto','mês','work_deliverables','percentual',null,'indisponível sem marcos de projeto formalizados',false),
 ('finance.received','Recebido','finance','soma de observações financeiras recebidas','clientes financeiros autorizados','mês','external_metric_observations','moeda',null,'indisponível sem fonte integrada e período homogêneo',true),
 ('finance.overdue','Financeiro vencido','finance','soma de valores vencidos ainda não recebidos','registros financeiros autorizados vencidos','agora','external_metric_observations','moeda',null,'indisponível sem fonte financeira integrada',true),
 ('maia.execution_failure_rate','Falhas da Maia','maia','execuções com erro / execuções encerradas','agent_runs encerradas','7 dias','agent_runs','percentual',null,'indisponível sem denominador encerrado e classificação validada',false),
 ('maia.approval_wait','Espera por aprovação','maia','média de resolução menos solicitação','aprovações encerradas','7 dias','approvals','horas',null,'indisponível sem medição validada de tempos de fila',false)
on conflict(code) do nothing;

create table public.external_metric_observations (
 id uuid primary key default gen_random_uuid(), metric_code text not null references public.metric_catalog(code),
 client_id uuid references public.maia_clients(id), project_id uuid references public.work_projects(id),
 period_start timestamptz not null, period_end timestamptz not null, value numeric, unit text not null,
 source_name text not null, source_ref text, last_attempt_at timestamptz not null, last_success_at timestamptz,
 unavailable_reason text, collected_by_run_id bigint references public.agent_runs(id), created_at timestamptz not null default now(),
 check(period_end >= period_start), check((value is not null and last_success_at is not null) or unavailable_reason is not null)
);
create index external_metric_scope on public.external_metric_observations(metric_code,client_id,period_start,period_end);

create or replace function public.current_person_id() returns uuid language sql stable security definer set search_path='' as $$
 select id from public.people where auth_user_id=auth.uid() and active limit 1;
$$;
revoke all on function public.current_person_id() from public,anon;
grant execute on function public.current_person_id() to authenticated,service_role;

create or replace function public.maia_effective_permission(p_person_id uuid,p_code text,p_client_id uuid default null)
returns text language sql stable security definer set search_path='' as $$
 with person as (select role from public.people where id=p_person_id and active),
 override as (select mode from public.maia_member_access_modes where person_id=p_person_id and permission_code=p_code),
 direct_grant as (select true as ok from public.person_permissions where person_id=p_person_id and permission_code=p_code),
 inherited as (
  select true as ok from public.maia_access_group_members m
  join public.maia_access_groups g on g.id=m.access_group_id and g.active
  join public.maia_access_group_permissions gp on gp.access_group_id=g.id and gp.permission_code=p_code
  where m.person_id=p_person_id and (g.client_id is null or g.client_id=p_client_id)
 )
 select case when auth.uid() is not null and p_person_id is distinct from public.current_person_id() then 'bloqueado'
  when exists(select 1 from person where role='proprietario') then 'permitido'
  when not exists(select 1 from person) then 'bloqueado'
  when exists(select 1 from override) then (select mode from override)
  when exists(select 1 from direct_grant) or exists(select 1 from inherited) then 'permitido'
  else 'bloqueado' end;
$$;
revoke all on function public.maia_effective_permission(uuid,text,uuid) from public,anon;
grant execute on function public.maia_effective_permission(uuid,text,uuid) to authenticated,service_role;

create or replace function public.maia_can_access_work_task(p_person_id uuid,p_task_id bigint,p_capability text,p_one_time_approval boolean)
returns boolean language sql stable security definer set search_path='' as $$
 with t as (select * from public.work_tasks where id=p_task_id),
 p as (select role from public.people where id=p_person_id and active),
 scoped as (
  select exists(select 1 from t where responsible_person_id=p_person_id or reviewer_person_id=p_person_id or approver_person_id=p_person_id)
   or exists(select 1 from t join public.work_team_members m on m.team_id=t.responsible_team_id where m.person_id=p_person_id and m.active and m.membership_role='coordenador')
   or exists(select 1 from t join public.work_scope_roles r on r.person_id=p_person_id and r.active where
      ((r.team_id=t.responsible_team_id and r.role='coordenador') or ((r.client_id=t.client_ref_id or r.project_id=t.project_ref_id) and r.role in ('membro','coordenador','responsavel_cliente')))) as ok
 ), role_match as (
  select (exists(select 1 from t where
    (p_capability='trabalho.revisar' and reviewer_person_id=p_person_id) or
    (p_capability='trabalho.aprovar' and approver_person_id=p_person_id) or
     (p_capability='trabalho.atualizar' and responsible_person_id=p_person_id))
   or exists(select 1 from t join public.work_scope_roles r on r.person_id=p_person_id and r.active where
    (r.team_id=t.responsible_team_id or r.client_id=t.client_ref_id or r.project_id=t.project_ref_id) and
    ((p_capability in ('trabalho.atualizar','trabalho.planejar','trabalho.redistribuir') and r.role='coordenador') or
     (p_capability='trabalho.revisar' and r.role='revisor') or
      (p_capability='trabalho.aprovar' and r.role='aprovador') or
      (p_capability='financeiro.ver' and r.role='financeiro')))
   or exists(select 1 from t join public.work_team_members m on m.team_id=t.responsible_team_id and m.person_id=p_person_id and m.active and m.membership_role='coordenador'
      where p_capability in ('trabalho.atualizar','trabalho.planejar','trabalho.redistribuir'))) as ok
 )
 select (auth.uid() is null or p_person_id is not distinct from public.current_person_id()) and exists(select 1 from p) and
  (exists(select 1 from p where role='proprietario') or
  ((public.maia_effective_permission(p_person_id,p_capability,(select client_ref_id from t))='permitido' or
    (p_one_time_approval and not exists(select 1 from public.maia_member_access_modes where person_id=p_person_id and permission_code=p_capability and mode='bloqueado')))
   and case when p_capability in ('trabalho.ver','indicadores.ver') then (select ok from scoped) else (select ok from role_match) end));
$$;
create or replace function public.maia_can_access_work_task(p_person_id uuid,p_task_id bigint,p_capability text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.maia_can_access_work_task(p_person_id,p_task_id,p_capability,false);
$$;
revoke all on function public.maia_can_access_work_task(uuid,bigint,text),public.maia_can_access_work_task(uuid,bigint,text,boolean) from public,anon;
grant execute on function public.maia_can_access_work_task(uuid,bigint,text) to authenticated,service_role;
grant execute on function public.maia_can_access_work_task(uuid,bigint,text,boolean) to service_role;

create or replace function public.update_collaborative_work_task(
 p_actor_person_id uuid,p_task_id bigint,p_revision integer,p_action text,p_payload jsonb,p_origin text default 'panel',p_one_time_approval boolean default false)
returns public.work_tasks language plpgsql security definer set search_path='' as $$
declare v_task public.work_tasks; v_before jsonb; v_after jsonb; v_cap text; v_status text; v_reason text;
begin
 if auth.uid() is not null and p_actor_person_id is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if auth.uid() is not null and p_one_time_approval then raise exception 'Aprovação pontual só pode ser usada pelo fluxo autenticado do servidor'; end if;
 select * into v_task from public.work_tasks where id=p_task_id for update;
 if not found or v_task.revision<>p_revision then raise exception 'Tarefa inexistente ou alterada por outra pessoa; atualize antes de salvar'; end if;
 v_cap := case p_action when 'review' then 'trabalho.revisar' when 'approve' then 'trabalho.aprovar'
   when 'reassign' then 'trabalho.redistribuir' when 'prioritize' then 'trabalho.planejar' when 'dependency' then 'trabalho.planejar' else 'trabalho.atualizar' end;
 if not public.maia_can_access_work_task(p_actor_person_id,p_task_id,v_cap,p_one_time_approval) then raise exception 'Operação fora do escopo autorizado'; end if;
 v_before:=to_jsonb(v_task); v_reason:=nullif(trim(p_payload->>'reason'),'');
 if v_task.workflow_status in ('completed','cancelled') then raise exception 'Trabalho encerrado não admite novos efeitos'; end if;
 if p_action='review' and v_task.workflow_status<>'review' then raise exception 'Tarefa não está em revisão'; end if;
 if p_action='status' then
  v_status:=p_payload->>'status';
  if v_status not in ('pending','in_progress','review','awaiting_approval','blocked','completed','cancelled') then raise exception 'Estado inválido'; end if;
  if not ((v_task.workflow_status='pending' and v_status in ('in_progress','blocked','cancelled')) or
    (v_task.workflow_status='in_progress' and v_status in ('review','awaiting_approval','completed','blocked','cancelled') and (v_status<>'completed' or (v_task.reviewer_person_id is null and v_task.approver_person_id is null)) and (v_status<>'awaiting_approval' or v_task.reviewer_person_id is null)) or
    (v_task.workflow_status='review' and v_status in ('in_progress','blocked','cancelled')) or
    (v_task.workflow_status='awaiting_approval' and v_status in ('review','blocked','cancelled')) or
    (v_task.workflow_status='blocked' and v_status in ('pending','in_progress','cancelled')) or v_task.workflow_status=v_status) then raise exception 'Transição de estado não permitida'; end if;
  if v_status in ('in_progress','review','awaiting_approval','completed') and exists(select 1 from public.work_task_dependencies d join public.work_tasks t on t.id=d.depends_on_task_id where d.task_id=p_task_id and t.workflow_status<>'completed') then raise exception 'Existem dependências ainda não concluídas'; end if;
  if v_status='review' and v_task.reviewer_person_id is null then raise exception 'Encaminhar para revisão exige revisor'; end if;
  if v_status='awaiting_approval' and v_task.approver_person_id is null then raise exception 'Aguardar aprovação exige aprovador'; end if;
  if v_status='completed' and coalesce(length(trim(p_payload->>'evidence')),0)=0 then raise exception 'Concluir exige evidência'; end if;
  if v_status='blocked' and (v_reason is null or nullif(p_payload->>'waiting_kind','') is null) then raise exception 'Bloqueio exige motivo e tipo de espera'; end if;
  if v_status='cancelled' and v_reason is null then raise exception 'Cancelamento exige motivo'; end if;
  update public.work_tasks set workflow_status=v_status,
   status=case when v_status='completed' then 'concluida' when v_status in ('in_progress','review','awaiting_approval','blocked') then 'em_andamento' else status end,
   completion_evidence=case when v_status='completed' then p_payload->>'evidence' else completion_evidence end,
   completed_at=case when v_status='completed' then coalesce(completed_at,now()) else completed_at end,
   started_at=case when v_status='in_progress' then coalesce(started_at,now()) else started_at end,
   blocked_at=case when v_status='blocked' then now() else null end,
   waiting_kind=case when v_status='blocked' then nullif(p_payload->>'waiting_kind','') else null end,
   block_reason=case when v_status='blocked' then v_reason else null end,
   due_at=case when v_status='cancelled' then null else due_at end
   where id=p_task_id returning * into v_task;
 elsif p_action='review' then
  if p_payload->>'outcome' not in ('approved','returned') then raise exception 'Resultado de revisão inválido'; end if;
  if p_payload->>'outcome'='returned' and nullif(p_payload->>'return_reason','') is null then raise exception 'Devolução exige motivo classificado'; end if;
  if p_payload->>'outcome'='approved' and v_task.approver_person_id is null and
     coalesce(length(trim(coalesce(v_task.completion_evidence,p_payload->>'comment',''))),0)=0 then
    raise exception 'Aprovação final exige evidência ou comentário';
  end if;
  insert into public.work_task_reviews(work_task_id,reviewer_person_id,outcome,return_reason,comment)
   values(p_task_id,p_actor_person_id,p_payload->>'outcome',nullif(p_payload->>'return_reason',''),nullif(p_payload->>'comment',''));
  update public.work_tasks set workflow_status=case when p_payload->>'outcome'='approved' then case when approver_person_id is null then 'completed' else 'awaiting_approval' end else 'in_progress' end,
   status=case when p_payload->>'outcome'='approved' and approver_person_id is null then 'concluida' else 'em_andamento' end,
   completion_evidence=case when p_payload->>'outcome'='approved' and approver_person_id is null then coalesce(completion_evidence,p_payload->>'comment') else completion_evidence end,
   completed_at=case when p_payload->>'outcome'='approved' and approver_person_id is null then coalesce(completed_at,now()) else completed_at end
   where id=p_task_id returning * into v_task;
 elsif p_action='approve' then
  if coalesce(length(trim(coalesce(nullif(p_payload->>'evidence',''),v_task.completion_evidence,''))),0)=0 then raise exception 'Aprovação final exige evidência'; end if;
  update public.work_tasks set workflow_status='completed',status='concluida',completed_at=coalesce(completed_at,now()),completion_evidence=coalesce(nullif(p_payload->>'evidence',''),completion_evidence)
   where id=p_task_id and workflow_status='awaiting_approval' returning * into v_task;
  if not found then raise exception 'Tarefa não está aguardando aprovação'; end if;
 elsif p_action='reassign' then
  if v_reason is null then raise exception 'Redistribuição exige motivo para registrar a passagem'; end if;
  if nullif(p_payload->>'person_id','') is null or nullif(p_payload->>'team_id','') is null then raise exception 'Redistribuição exige pessoa e equipe cadastradas'; end if;
  if not exists(select 1 from public.people where id=(p_payload->>'person_id')::uuid and active) then raise exception 'Responsável precisa ser pessoa ativa cadastrada'; end if;
  if not exists(select 1 from public.work_team_members where person_id=(p_payload->>'person_id')::uuid and team_id=(p_payload->>'team_id')::uuid and active) then raise exception 'Responsável não pertence à equipe destino'; end if;
  if not exists(select 1 from public.people where id=p_actor_person_id and role='proprietario') and
    not (exists(select 1 from public.work_scope_roles where person_id=p_actor_person_id and role='coordenador' and active and team_id=(p_payload->>'team_id')::uuid)
      or exists(select 1 from public.work_team_members where person_id=p_actor_person_id and membership_role='coordenador' and active and team_id=(p_payload->>'team_id')::uuid)) then raise exception 'Equipe destino fora da coordenação autorizada'; end if;
  update public.work_tasks set responsible=(select name from public.people where id=(p_payload->>'person_id')::uuid),responsible_person_id=nullif(p_payload->>'person_id','')::uuid,responsible_team_id=nullif(p_payload->>'team_id','')::uuid where id=p_task_id returning * into v_task;
 elsif p_action='comment' then
  if v_reason is null then raise exception 'Comentário exige texto'; end if;
  update public.work_tasks set updated_at=now() where id=p_task_id returning * into v_task;
 elsif p_action='artifact' then
  if nullif(trim(p_payload->>'label'),'') is null or p_payload->>'uri' !~ '^https://' then raise exception 'Artefato exige nome e referência HTTPS'; end if;
  insert into public.work_task_artifacts(work_task_id,added_by,label,uri,evidence_kind)
   values(p_task_id,p_actor_person_id,p_payload->>'label',p_payload->>'uri',coalesce(p_payload->>'evidence_kind','reference'));
  update public.work_tasks set updated_at=now() where id=p_task_id returning * into v_task;
 elsif p_action='dependency' then
  perform pg_catalog.pg_advisory_xact_lock(731904,1);
  if not public.maia_can_access_work_task(p_actor_person_id,(p_payload->>'depends_on')::bigint,'trabalho.ver') then raise exception 'Dependência fora do escopo autorizado'; end if;
  if v_reason is null then raise exception 'Alterar dependência exige motivo'; end if;
  if coalesce((p_payload->>'remove')::boolean,false) then
   delete from public.work_task_dependencies where task_id=p_task_id and depends_on_task_id=(p_payload->>'depends_on')::bigint;
  else
   if p_task_id=(p_payload->>'depends_on')::bigint or exists(with recursive chain(id) as (
    select (p_payload->>'depends_on')::bigint union
    select d.depends_on_task_id from public.work_task_dependencies d join chain c on c.id=d.task_id
   ) select 1 from chain where id=p_task_id) then raise exception 'Dependência circular'; end if;
   insert into public.work_task_dependencies(task_id,depends_on_task_id) values(p_task_id,(p_payload->>'depends_on')::bigint) on conflict do nothing;
  end if;
  update public.work_tasks set updated_at=now() where id=p_task_id returning * into v_task;
 elsif p_action='edit' then
  if (p_payload ? 'reviewer_person_id' or p_payload ? 'approver_person_id' or p_payload ? 'project_ref_id' or p_payload ? 'deliverable_id') and not public.maia_can_access_work_task(p_actor_person_id,p_task_id,'trabalho.planejar') then raise exception 'Vínculos e revisores exigem coordenação autorizada'; end if;
  if p_payload ? 'project_ref_id' and nullif(p_payload->>'project_ref_id','') is not null and not exists(select 1 from public.work_projects p where p.id=(p_payload->>'project_ref_id')::uuid and (v_task.client_ref_id is null or p.client_id=v_task.client_ref_id) and public.maia_can_manage_portfolio(p_actor_person_id,p.client_id,p.id,p.responsible_team_id)) then raise exception 'Projeto fora do escopo autorizado'; end if;
  if exists(select 1 from unnest(array[nullif(p_payload->>'reviewer_person_id','')::uuid,nullif(p_payload->>'approver_person_id','')::uuid]) x where x is not null and not exists(select 1 from public.people where id=x and active)) then raise exception 'Revisor ou aprovador inativo'; end if;
  if p_payload ? 'committed_due_at' and (v_before->>'committed_due_at' is distinct from nullif(p_payload->>'committed_due_at','')) and v_reason is null then raise exception 'Mudança de prazo exige motivo'; end if;
  update public.work_tasks set title=coalesce(nullif(trim(p_payload->>'title'),''),title),
   objective=case when p_payload ? 'objective' then p_payload->>'objective' else objective end,
   briefing=case when p_payload ? 'briefing' then p_payload->>'briefing' else briefing end,
   acceptance_criteria=case when p_payload ? 'acceptance_criteria' then p_payload->>'acceptance_criteria' else acceptance_criteria end,
   estimated_effort_hours=case when p_payload ? 'estimated_effort_hours' then nullif(p_payload->>'estimated_effort_hours','')::numeric else estimated_effort_hours end,
   project_ref_id=case when p_payload ? 'project_ref_id' then nullif(p_payload->>'project_ref_id','')::uuid else project_ref_id end,
   deliverable_id=case when p_payload ? 'deliverable_id' then nullif(p_payload->>'deliverable_id','')::uuid else deliverable_id end,
   reviewer_person_id=case when p_payload ? 'reviewer_person_id' then nullif(p_payload->>'reviewer_person_id','')::uuid else reviewer_person_id end,
   approver_person_id=case when p_payload ? 'approver_person_id' then nullif(p_payload->>'approver_person_id','')::uuid else approver_person_id end,
   committed_due_at=case when p_payload ? 'committed_due_at' then nullif(p_payload->>'committed_due_at','')::timestamptz else committed_due_at end,
   due_at=case when p_payload ? 'committed_due_at' then nullif(p_payload->>'committed_due_at','')::timestamptz else due_at end
   where id=p_task_id returning * into v_task;
 elsif p_action='prioritize' then
  if v_reason is null then raise exception 'Repriorização exige motivo'; end if;
  if p_payload ? 'committed_due_at' and (v_before->>'committed_due_at' is distinct from nullif(p_payload->>'committed_due_at','')) then raise exception 'Mudança de prazo exige motivo específico'; end if;
  update public.work_tasks set priority=(p_payload->>'priority')::smallint,committed_due_at=case when p_payload ? 'committed_due_at' then nullif(p_payload->>'committed_due_at','')::timestamptz else committed_due_at end,
   due_at=case when p_payload ? 'committed_due_at' then nullif(p_payload->>'committed_due_at','')::timestamptz else due_at end where id=p_task_id returning * into v_task;
 else raise exception 'Ação desconhecida'; end if;
 v_after:=to_jsonb(v_task);
 insert into public.work_task_history(work_task_id,actor_person_id,actor_origin,event_type,from_value,to_value,reason,evidence,revision)
 values(p_task_id,p_actor_person_id,p_origin,
  case p_action when 'status' then case when v_task.workflow_status='blocked' then 'blocked' else 'status_changed' end when 'review' then case when p_payload->>'outcome'='approved' then 'reviewed' else 'returned' end when 'approve' then 'approved' when 'reassign' then 'reassigned' when 'comment' then 'commented' when 'artifact' then 'artifact_added' when 'dependency' then 'updated' when 'edit' then case when v_before->>'committed_due_at' is distinct from v_after->>'committed_due_at' then 'deadline_changed' else 'updated' end when 'prioritize' then case when v_before->>'committed_due_at' is distinct from v_after->>'committed_due_at' then 'deadline_changed' else 'priority_changed' end end,
  v_before,v_after,v_reason,nullif(p_payload->>'evidence',''),v_task.revision);
 return v_task;
end;
$$;
revoke all on function public.update_collaborative_work_task(uuid,bigint,integer,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.update_collaborative_work_task(uuid,bigint,integer,text,jsonb,text,boolean) to service_role,authenticated;

-- Escritas compostas ficam em uma transação no banco. O backend ainda revalida o
-- escopo antes da chamada; as funções repetem identidade, permissão e revisão.
create or replace function public.save_work_team(
 p_actor uuid,p_id uuid,p_revision integer,p_name text,p_access_group_id uuid,p_active boolean,p_members jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_member jsonb; v_before jsonb; v_after jsonb;
begin
 if auth.uid() is not null and p_actor is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if not exists(select 1 from public.people where id=p_actor and active and role='proprietario') or
    public.maia_effective_permission(p_actor,'operacao.administrar',null)<>'permitido' then raise exception 'Administração exclusiva do proprietário'; end if;
 if p_id is null then
  insert into public.work_teams(name,access_group_id,active) values(trim(p_name),p_access_group_id,p_active) returning id into v_id;
 else
  select jsonb_build_object('team',to_jsonb(t),'members',(select coalesce(jsonb_agg(m),'[]') from public.work_team_members m where team_id=p_id)) into v_before from public.work_teams t where id=p_id for update;
  update public.work_teams set name=trim(p_name),access_group_id=p_access_group_id,active=p_active,revision=revision+1,updated_at=now()
   where id=p_id and revision=p_revision returning id into v_id;
  if v_id is null then raise exception 'Equipe alterada por outra sessão'; end if;
 end if;
 update public.work_team_members set active=false where team_id=v_id;
 for v_member in select value from jsonb_array_elements(coalesce(p_members,'[]'::jsonb)) loop
  insert into public.work_team_members(team_id,person_id,membership_role)
   values(v_id,(v_member->>'personId')::uuid,v_member->>'role') on conflict(team_id,person_id) do update set membership_role=excluded.membership_role,active=true;
 end loop;
 select jsonb_build_object('team',to_jsonb(t),'members',(select coalesce(jsonb_agg(m),'[]') from public.work_team_members m where team_id=v_id)) into v_after from public.work_teams t where id=v_id;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
  values('team',v_id,p_actor,'Equipe e associações atualizadas',v_before,v_after);
 return v_id;
end;
$$;
revoke all on function public.save_work_team(uuid,uuid,integer,text,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.save_work_team(uuid,uuid,integer,text,uuid,boolean,jsonb) to service_role,authenticated;

create or replace function public.save_work_capacity(
 p_actor uuid,p_person uuid,p_team uuid,p_week date,p_available numeric,p_absence numeric,p_note text,p_revision integer)
returns public.work_capacity language plpgsql security definer set search_path='' as $$
declare v_row public.work_capacity; v_before jsonb;
begin
 if auth.uid() is not null and p_actor is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if not (exists(select 1 from public.people where id=p_actor and active and role='proprietario') or
    (public.maia_effective_permission(p_actor,'trabalho.planejar',null)='permitido' and (exists(
     select 1 from public.work_scope_roles where person_id=p_actor and team_id=p_team and role='coordenador' and active)
     or exists(select 1 from public.work_team_members where person_id=p_actor and team_id=p_team and membership_role='coordenador' and active)))) then raise exception 'Capacidade fora do escopo coordenado'; end if;
 if extract(isodow from p_week)<>1 then raise exception 'Capacidade exige segunda-feira como início da semana'; end if;
 if p_absence>p_available then raise exception 'Ausência não pode superar disponibilidade'; end if;
 if not exists(select 1 from public.work_team_members where team_id=p_team and person_id=p_person and active) then raise exception 'Pessoa não pertence à equipe informada'; end if;
 select to_jsonb(c) into v_before from public.work_capacity c where person_id=p_person and team_id=p_team and week_start=p_week for update;
 if p_revision is null then
  insert into public.work_capacity(person_id,team_id,week_start,available_hours,absence_hours,note,updated_by)
   values(p_person,p_team,p_week,p_available,p_absence,p_note,p_actor) returning * into v_row;
 else
  update public.work_capacity set available_hours=p_available,absence_hours=p_absence,note=p_note,updated_by=p_actor,revision=revision+1,updated_at=now()
   where person_id=p_person and team_id=p_team and week_start=p_week and revision=p_revision returning * into v_row;
  if v_row.id is null then raise exception 'Capacidade alterada por outra sessão'; end if;
 end if;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
  values('capacity',v_row.id,p_actor,coalesce(nullif(trim(p_note),''),'Disponibilidade e ausência atualizadas'),v_before,to_jsonb(v_row));
 return v_row;
end;
$$;
revoke all on function public.save_work_capacity(uuid,uuid,uuid,date,numeric,numeric,text,integer) from public,anon,authenticated;
grant execute on function public.save_work_capacity(uuid,uuid,uuid,date,numeric,numeric,text,integer) to service_role,authenticated;

create table public.work_plan_baselines (
 plan_id uuid primary key references public.work_plans(id), task_snapshots jsonb not null,
 created_by uuid not null references public.people(id), created_at timestamptz not null default now()
);
alter table public.work_plan_baselines enable row level security;
revoke all on public.work_plan_baselines from anon,authenticated;
grant all on public.work_plan_baselines to service_role;

create or replace function public.save_work_plan(
 p_actor uuid,p_id uuid,p_revision integer,p_period_kind text,p_start date,p_end date,p_team uuid,p_objective text,p_task_ids bigint[],p_baseline boolean,p_reason text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_plan public.work_plans; v_before jsonb; v_after jsonb; v_items jsonb; v_prior_ids bigint[]; v_added bigint[]; v_removed bigint[]; v_ids bigint[];
begin
 if auth.uid() is not null and p_actor is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if p_end<p_start or p_period_kind not in ('monthly','weekly','daily') then raise exception 'Período inválido'; end if;
 if p_baseline and p_period_kind<>'weekly' then raise exception 'Baseline exige horizonte semanal'; end if;
 if not exists(select 1 from public.work_teams where id=p_team and active) then raise exception 'Equipe inativa'; end if;
 if not (exists(select 1 from public.people where id=p_actor and active and role='proprietario') or
  (public.maia_effective_permission(p_actor,'trabalho.planejar',null)='permitido' and (
   exists(select 1 from public.work_scope_roles where person_id=p_actor and team_id=p_team and role='coordenador' and active) or
   exists(select 1 from public.work_team_members where person_id=p_actor and team_id=p_team and membership_role='coordenador' and active)))) then raise exception 'Plano fora do escopo coordenado'; end if;
 select coalesce(array_agg(distinct x),'{}') into v_ids from unnest(coalesce(p_task_ids,'{}')) x;
 if cardinality(v_ids)>300 or exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.work_tasks t where t.id=x and t.responsible_team_id=p_team and public.maia_can_access_work_task(p_actor,t.id,'trabalho.planejar'))) then raise exception 'Plano contém tarefa inexistente ou fora da equipe autorizada'; end if;
 if p_id is null then
  insert into public.work_plans(period_kind,period_start,period_end,team_id,objective)
   values(p_period_kind,p_start,p_end,p_team,p_objective) returning * into v_plan;
 else
  select * into v_plan from public.work_plans where id=p_id for update;
  if not found or v_plan.revision<>p_revision then raise exception 'Plano alterado por outra sessão'; end if;
  if v_plan.team_id is distinct from p_team or v_plan.status='closed' then raise exception 'Plano encerrado ou equipe divergente'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'Edição de plano exige motivo'; end if;
  if v_plan.baseline_at is not null and (v_plan.period_kind<>p_period_kind or v_plan.period_start<>p_start or v_plan.period_end<>p_end) then raise exception 'Período da baseline é imutável; crie outro plano'; end if;
 end if;
 v_id:=v_plan.id;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.work_task_id),'[]') into v_items from public.work_plan_items i where plan_id=v_id;
 v_before:=jsonb_build_object('plan',to_jsonb(v_plan),'items',v_items);
 select coalesce(array_agg(work_task_id),'{}') into v_prior_ids from public.work_plan_items where plan_id=v_id;
 select coalesce(array_agg(x),'{}') into v_added from unnest(v_ids) x where not x=any(v_prior_ids);
 select coalesce(array_agg(x),'{}') into v_removed from unnest(v_prior_ids) x where not x=any(v_ids);
 delete from public.work_plan_items where plan_id=v_id and not(work_task_id=any(v_ids));
 insert into public.work_plan_items(plan_id,work_task_id,planned_priority,committed_effort_hours,baseline_snapshot,added_after_baseline)
  select v_id,t.id,t.priority,t.estimated_effort_hours,null,v_plan.baseline_at is not null from public.work_tasks t where t.id=any(v_added);
 update public.work_plans set objective=p_objective,period_kind=p_period_kind,period_start=p_start,period_end=p_end,
  status=case when p_baseline then 'baselined' else status end,
  baseline_at=case when p_baseline then coalesce(baseline_at,now()) else baseline_at end,
  baseline_by=case when p_baseline then coalesce(baseline_by,p_actor) else baseline_by end,
  revision=case when p_id is null then revision else revision+1 end,updated_at=now() where id=v_id returning * into v_plan;
 if p_baseline then
  insert into public.work_plan_baselines(plan_id,task_snapshots,created_by)
   select v_id,coalesce(jsonb_agg(jsonb_build_object('id',t.id,'priority',t.priority,'estimated_effort_hours',t.estimated_effort_hours,'committed_due_at',t.committed_due_at) order by t.id),'[]'),p_actor
   from public.work_tasks t where t.id=any(v_ids) on conflict(plan_id) do nothing;
  update public.work_plan_items i set baseline_snapshot=b.value,added_after_baseline=false
   from public.work_plan_baselines s cross join lateral jsonb_array_elements(s.task_snapshots) b(value)
   where s.plan_id=v_id and i.plan_id=v_id and i.work_task_id=(b.value->>'id')::bigint;
 end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.work_task_id),'[]') into v_items from public.work_plan_items i where plan_id=v_id;
 v_after:=jsonb_build_object('plan',to_jsonb(v_plan),'items',v_items);
 if p_id is not null then
  insert into public.work_plan_changes(plan_id,changed_by,change_kind,reason,affected_task_ids,prior_value,new_value)
   values(v_id,p_actor,'plan_changed',p_reason,ARRAY(select distinct x from unnest(v_ids||v_prior_ids) x),v_before,v_after);
  if v_before->'plan'->>'baseline_at' is not null and cardinality(v_added)>0 then
   insert into public.work_plan_changes(plan_id,changed_by,change_kind,reason,affected_task_ids,prior_value,new_value)
    values(v_id,p_actor,'urgency_added',p_reason,ARRAY(select distinct x from unnest(v_ids||v_prior_ids) x),to_jsonb(v_prior_ids),to_jsonb(v_added));
  end if;
  if cardinality(v_removed)>0 then
   insert into public.work_plan_changes(plan_id,changed_by,change_kind,reason,affected_task_ids,prior_value,new_value)
    values(v_id,p_actor,'commitment_removed',p_reason,v_removed,to_jsonb(v_removed),'[]');
  end if;
 end if;
 return v_id;
end;
$$;
revoke all on function public.save_work_plan(uuid,uuid,integer,text,date,date,uuid,text,bigint[],boolean,text) from public,anon,authenticated;
grant execute on function public.save_work_plan(uuid,uuid,integer,text,date,date,uuid,text,bigint[],boolean,text) to service_role,authenticated;

-- Todas as estruturas são server-first; leitura direta autenticada recebe as mesmas decisões por RLS.
alter table public.work_teams enable row level security;
alter table public.work_team_members enable row level security;
alter table public.work_contracts enable row level security;
alter table public.work_projects enable row level security;
alter table public.work_deliverables enable row level security;
alter table public.work_scope_roles enable row level security;
alter table public.work_task_dependencies enable row level security;
alter table public.work_task_history enable row level security;
alter table public.work_task_artifacts enable row level security;
alter table public.work_task_reviews enable row level security;
alter table public.work_plans enable row level security;
alter table public.work_plan_items enable row level security;
alter table public.work_plan_changes enable row level security;
alter table public.work_capacity enable row level security;
alter table public.metric_catalog enable row level security;
alter table public.external_metric_observations enable row level security;

revoke all on public.work_teams,public.work_team_members,public.work_contracts,public.work_projects,public.work_deliverables,public.work_scope_roles,
 public.work_task_dependencies,public.work_task_history,public.work_task_artifacts,public.work_task_reviews,public.work_plans,
 public.work_plan_items,public.work_plan_changes,public.work_capacity,public.metric_catalog,public.external_metric_observations from anon,authenticated;
grant all on public.work_teams,public.work_team_members,public.work_contracts,public.work_projects,public.work_deliverables,public.work_scope_roles,
 public.work_task_dependencies,public.work_task_history,public.work_task_artifacts,public.work_task_reviews,public.work_plans,
 public.work_plan_items,public.work_plan_changes,public.work_capacity,public.metric_catalog,public.external_metric_observations to service_role;
grant usage,select on sequence public.work_task_history_id_seq,public.work_plan_changes_id_seq to service_role;
grant select on public.work_tasks,public.work_task_history,public.work_task_dependencies,public.work_task_artifacts,public.work_task_reviews,public.metric_catalog to authenticated;

create policy collaborative_tasks_scoped_read on public.work_tasks for select to authenticated using(public.maia_can_access_work_task(public.current_person_id(),id,'trabalho.ver'));
create policy collaborative_history_scoped_read on public.work_task_history for select to authenticated using(public.maia_can_access_work_task(public.current_person_id(),work_task_id,'trabalho.ver'));
create policy collaborative_dependencies_scoped_read on public.work_task_dependencies for select to authenticated using(public.maia_can_access_work_task(public.current_person_id(),task_id,'trabalho.ver'));
create policy collaborative_artifacts_scoped_read on public.work_task_artifacts for select to authenticated using(public.maia_can_access_work_task(public.current_person_id(),work_task_id,'trabalho.ver'));
create policy collaborative_reviews_scoped_read on public.work_task_reviews for select to authenticated using(public.maia_can_access_work_task(public.current_person_id(),work_task_id,'trabalho.ver'));
create policy metric_catalog_authenticated_read on public.metric_catalog for select to authenticated using(
 public.maia_effective_permission(public.current_person_id(),'indicadores.ver',null)='permitido'
 and (not financial or public.maia_effective_permission(public.current_person_id(),'financeiro.ver',null)='permitido')
);

-- Realtime não é requisito de correção: o cliente usa polling reconciliador. Não alteramos o schema realtime.

-- Carteira e funções operacionais: escrita revisada e auditada na mesma transação.
create table public.work_portfolio_history (
 id bigint generated always as identity primary key, entity_kind text not null,
 entity_id uuid not null, actor_person_id uuid not null references public.people(id),
 at timestamptz not null default now(), reason text not null, prior_value jsonb, new_value jsonb not null
);
create index work_portfolio_history_entity on public.work_portfolio_history(entity_kind,entity_id,at desc);
alter table public.work_portfolio_history enable row level security;
revoke all on public.work_portfolio_history from anon,authenticated;
grant all on public.work_portfolio_history to service_role;
grant usage,select on sequence public.work_portfolio_history_id_seq to service_role;

create or replace function public.maia_can_manage_portfolio(p_actor uuid,p_client uuid,p_project uuid,p_team uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select (auth.uid() is null or p_actor is not distinct from public.current_person_id()) and
 (exists(select 1 from public.people where id=p_actor and active and role='proprietario') or
 (public.maia_effective_permission(p_actor,'trabalho.planejar',p_client)='permitido' and (
 exists(select 1 from public.work_scope_roles where person_id=p_actor and active and
  ((client_id=p_client and role in ('responsavel_cliente','coordenador')) or (project_id=p_project and role='coordenador'))) or
 (p_project is not null and exists(select 1 from public.work_projects where id=p_project and client_id=p_client and responsible_team_id=p_team) and
  (exists(select 1 from public.work_team_members where person_id=p_actor and team_id=p_team and active and membership_role='coordenador') or
   exists(select 1 from public.work_scope_roles where person_id=p_actor and team_id=p_team and active and role='coordenador'))))));
$$;
revoke all on function public.maia_can_manage_portfolio(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.maia_can_manage_portfolio(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.save_work_portfolio(p_actor uuid,p_kind text,p_id uuid,p_revision integer,p_payload jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_client uuid; v_project uuid; v_team uuid; v_id uuid;
begin
 if auth.uid() is not null and p_actor is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Alteração da carteira exige motivo'; end if;
 if p_kind='contract' then
  if p_id is not null then select to_jsonb(c) into v_before from public.work_contracts c where id=p_id for update; end if;
  v_client:=(p_payload->>'client_id')::uuid; v_team:=nullif(p_payload->>'responsible_team_id','')::uuid;
 elsif p_kind='project' then
  if p_id is not null then select to_jsonb(p) into v_before from public.work_projects p where id=p_id for update; end if;
  v_client:=(p_payload->>'client_id')::uuid; v_project:=p_id; v_team:=nullif(p_payload->>'responsible_team_id','')::uuid;
 elsif p_kind='deliverable' then
  if p_id is not null then select to_jsonb(d) into v_before from public.work_deliverables d where id=p_id for update; end if;
  v_project:=(p_payload->>'project_id')::uuid;
  select client_id,responsible_team_id into v_client,v_team from public.work_projects where id=v_project;
 else raise exception 'Tipo de registro inválido'; end if;
 if p_id is not null and (v_before is null or (v_before->>'revision')::integer is distinct from p_revision) then raise exception 'Registro alterado por outra sessão'; end if;
 if p_id is not null and (
  (p_kind in ('contract','project') and (v_before->>'client_id')::uuid is distinct from v_client) or
  (p_kind='deliverable' and (v_before->>'project_id')::uuid is distinct from v_project)) then raise exception 'Não é permitido mover registros entre clientes ou projetos'; end if;
 if not public.maia_can_manage_portfolio(p_actor,v_client,v_project,coalesce((v_before->>'responsible_team_id')::uuid,v_team)) then raise exception 'Carteira fora do escopo autorizado'; end if;
 if not exists(select 1 from public.maia_clients where id=v_client and active) then raise exception 'Cliente inativo ou inexistente'; end if;
 if v_team is not null and not exists(select 1 from public.work_teams where id=v_team and active) then raise exception 'Equipe inativa ou inexistente'; end if;
 if nullif(p_payload->>'responsible_person_id','') is not null and not exists(select 1 from public.people where id=(p_payload->>'responsible_person_id')::uuid and active) then raise exception 'Responsável inativo ou inexistente'; end if;
 if v_team is not null and (v_before is null or (v_before->>'responsible_team_id')::uuid is distinct from v_team) and not exists(select 1 from public.people where id=p_actor and active and role='proprietario') and
  not (public.maia_effective_permission(p_actor,'trabalho.redistribuir',v_client)='permitido' and (
   exists(select 1 from public.work_team_members where team_id=v_team and person_id=p_actor and active and membership_role='coordenador') or
   exists(select 1 from public.work_scope_roles where team_id=v_team and person_id=p_actor and active and role='coordenador'))) then raise exception 'Equipe destino fora da coordenação autorizada'; end if;
 if p_kind='contract' then
  if p_id is null then
   insert into public.work_contracts(client_id,name,service_scope,status,starts_on,ends_on,responsible_person_id,responsible_team_id)
    values(v_client,trim(p_payload->>'name'),trim(p_payload->>'service_scope'),p_payload->>'status',nullif(p_payload->>'starts_on','')::date,nullif(p_payload->>'ends_on','')::date,nullif(p_payload->>'responsible_person_id','')::uuid,v_team) returning to_jsonb(work_contracts.*) into v_after;
  else
   update public.work_contracts set name=trim(p_payload->>'name'),service_scope=trim(p_payload->>'service_scope'),status=p_payload->>'status',
    starts_on=nullif(p_payload->>'starts_on','')::date,ends_on=nullif(p_payload->>'ends_on','')::date,responsible_person_id=nullif(p_payload->>'responsible_person_id','')::uuid,responsible_team_id=v_team,revision=revision+1,updated_at=now()
    where id=p_id returning to_jsonb(work_contracts.*) into v_after;
  end if;
 elsif p_kind='project' then
  if p_id is null then
   insert into public.work_projects(client_id,contract_id,name,objective,status,starts_on,due_on,responsible_person_id,responsible_team_id)
    values(v_client,nullif(p_payload->>'contract_id','')::uuid,trim(p_payload->>'name'),p_payload->>'objective',p_payload->>'status',nullif(p_payload->>'starts_on','')::date,nullif(p_payload->>'due_on','')::date,nullif(p_payload->>'responsible_person_id','')::uuid,v_team) returning to_jsonb(work_projects.*) into v_after;
  else
   update public.work_projects set contract_id=nullif(p_payload->>'contract_id','')::uuid,name=trim(p_payload->>'name'),objective=p_payload->>'objective',status=p_payload->>'status',
    starts_on=nullif(p_payload->>'starts_on','')::date,due_on=nullif(p_payload->>'due_on','')::date,responsible_person_id=nullif(p_payload->>'responsible_person_id','')::uuid,responsible_team_id=v_team,revision=revision+1,updated_at=now()
    where id=p_id returning to_jsonb(work_projects.*) into v_after;
  end if;
 else
  if p_payload->>'status'='completed' and (nullif(trim(p_payload->>'evidence'),'') is null or exists(select 1 from public.work_tasks where deliverable_id=p_id and workflow_status not in ('completed','cancelled'))) then raise exception 'Concluir entregável exige evidência e tarefas encerradas'; end if;
  if p_id is null then
   insert into public.work_deliverables(project_id,title,objective,acceptance_criteria,status,due_at,completed_at)
    values(v_project,trim(p_payload->>'title'),p_payload->>'objective',p_payload->>'acceptance_criteria',p_payload->>'status',nullif(p_payload->>'due_at','')::timestamptz,case when p_payload->>'status'='completed' then now() end) returning to_jsonb(work_deliverables.*) into v_after;
  else
   update public.work_deliverables set title=trim(p_payload->>'title'),objective=p_payload->>'objective',acceptance_criteria=p_payload->>'acceptance_criteria',status=p_payload->>'status',due_at=nullif(p_payload->>'due_at','')::timestamptz,
    completed_at=case when p_payload->>'status'='completed' then coalesce(completed_at,now()) else null end,revision=revision+1,updated_at=now()
    where id=p_id returning to_jsonb(work_deliverables.*) into v_after;
  end if;
 end if;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
  values(p_kind,(v_after->>'id')::uuid,p_actor,p_reason,v_before,v_after||jsonb_build_object('evidence',p_payload->>'evidence'));
 return v_after;
end;
$$;
revoke all on function public.save_work_portfolio(uuid,text,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_work_portfolio(uuid,text,uuid,integer,jsonb,text) to service_role;

create or replace function public.save_work_scope_role(p_actor uuid,p_person uuid,p_role text,p_team uuid,p_client uuid,p_project uuid,p_active boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_before jsonb; v_after jsonb; v_id uuid;
begin
 if auth.uid() is not null and p_actor is distinct from public.current_person_id() then raise exception 'Identidade divergente'; end if;
 if not exists(select 1 from public.people where id=p_actor and active and role='proprietario') then raise exception 'Administração exclusiva do proprietário'; end if;
 if num_nonnulls(p_team,p_client,p_project)<>1 then raise exception 'Informe exatamente um escopo'; end if;
 if not exists(select 1 from public.people where id=p_person and active) then raise exception 'Pessoa inativa ou inexistente'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_person::text||p_role||coalesce(p_team,p_client,p_project)::text,0));
 select to_jsonb(r),id into v_before,v_id from public.work_scope_roles r where person_id=p_person and role=p_role
  and team_id is not distinct from p_team and client_id is not distinct from p_client and project_id is not distinct from p_project order by active desc,created_at desc limit 1 for update;
 if v_id is null then
  insert into public.work_scope_roles(person_id,role,team_id,client_id,project_id,active) values(p_person,p_role,p_team,p_client,p_project,p_active) returning id,to_jsonb(work_scope_roles.*) into v_id,v_after;
 else
  update public.work_scope_roles set active=p_active where id=v_id returning to_jsonb(work_scope_roles.*) into v_after;
 end if;
 insert into public.work_portfolio_history(entity_kind,entity_id,actor_person_id,reason,prior_value,new_value)
  values('scope_role',v_id,p_actor,case when p_active then 'Função atribuída' else 'Função revogada' end,v_before,v_after);
 return v_id;
end;
$$;
revoke all on function public.save_work_scope_role(uuid,uuid,text,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_work_scope_role(uuid,uuid,text,uuid,uuid,uuid,boolean) to service_role;
