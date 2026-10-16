-- maia_nucleus_safety
-- destrutivo-aprovado: solicitação de evolução do núcleo para arquivar sessões sem apagar histórico e permitir várias versões de skill.
-- A migration v1 já foi versionada: corrigimos isolamento e reservas sem editá-la.
-- Código dependente: sessions.ts, planExecution.ts, scheduler.ts.
-- Reversão: nova migration para restaurar as funções; não restaurar a unicidade antiga.

do $$
declare v_name text;
begin
  select conname into strict v_name from pg_constraint
  where conrelid='public.maia_sessions'::regclass and contype='u';
  execute format('alter table public.maia_sessions drop constraint %I', v_name);
end;
$$;

-- Uma sessão ativa por identidade completa. Histórico arquivado pode ter várias sessões.
-- COALESCE torna cliente nulo uma identidade real, sem brecha de UNIQUE/NULL.
create unique index maia_sessions_one_active_scope_idx
  on public.maia_sessions(channel, conversation_key, requester_key, scope_kind, coalesce(client_id::text, ''))
  where status = 'active';
create unique index maia_context_summaries_coverage_idx
  on public.maia_context_summaries(session_id,covers_through_message_id);

do $$ declare v_name text; begin
  select conname into strict v_name from pg_constraint
    where conrelid='public.maia_mcp_servers'::regclass and contype='u';
  execute format('alter table public.maia_mcp_servers drop constraint %I', v_name);
end $$;
create unique index maia_mcp_one_name_scope_idx
  on public.maia_mcp_servers(owner_key,name,coalesce(client_id::text,''));
alter table public.maia_mcp_servers add column read_only_tools text[] not null default '{}';

create unique index maia_skills_one_active_slug_idx
  on public.maia_skills(slug) where status='active';

create table public.maia_plan_resumptions (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.maia_plans(id) on delete cascade,
  event_key text not null,
  trigger_data jsonb not null,
  status text not null default 'leased' check (status in ('leased','dispatched','uncertain','cancelled')),
  task_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id,event_key)
);
create index maia_plan_resumptions_pending_idx on public.maia_plan_resumptions(status,created_at);
alter table public.maia_plan_resumptions enable row level security;
revoke all on public.maia_plan_resumptions from public, anon, authenticated;
grant select,insert,update,delete on public.maia_plan_resumptions to service_role;

alter table public.maia_subagents
  add column kind text not null default 'analysis' check (kind in ('research','analysis','review')),
  add column parent_agent_id uuid references public.maia_subagents(id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_note text;
alter table public.maia_subagents drop constraint maia_subagents_status_check;
alter table public.maia_subagents add constraint maia_subagents_status_check
  check (status in ('queued','running','awaiting_review','completed','failed','cancelled','interrupted'));

create or replace function public.claim_maia_subagent(p_id uuid, p_max_concurrent integer default 3)
returns public.maia_subagents
language plpgsql security definer set search_path = public
as $$
declare v_agent public.maia_subagents;
begin
  perform pg_advisory_xact_lock(73521804);
  if (select count(*) from public.maia_subagents where status='running') >= greatest(1,least(p_max_concurrent,8)) then return null; end if;
  update public.maia_subagents set status='running', updated_at=now()
    where id=p_id and status='queued' returning * into v_agent;
  return v_agent;
end;
$$;

create or replace function public.claim_maia_waiting_plan(p_plan_id bigint, p_waiting jsonb, p_event_key text, p_event_at timestamptz default now())
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_event bigint;
begin
  insert into public.maia_plan_resumptions(plan_id,event_key,trigger_data)
  values(p_plan_id,p_event_key,p_waiting)
  on conflict (plan_id,event_key) do nothing returning id into v_event;
  if v_event is null then return false; end if;
  update public.maia_plans set waiting=null, updated_at=now()
    where id=p_plan_id and status='active' and waiting=p_waiting
      and created_at <= p_event_at and created_at >= p_event_at - interval '7 days';
  if not found then
    delete from public.maia_plan_resumptions where id=v_event;
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.sync_maia_plan_steps()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.maia_plan_steps(plan_id,step_no,text,depends_on,status)
  select new.id, e.n::integer, left(e.value->>'text',4000),
    case when e.n=1 then '{}'::integer[] else array[(e.n-1)::integer] end,
    case when coalesce((e.value->>'done')::boolean,false) then 'done' else 'pending' end
  from jsonb_array_elements(new.steps) with ordinality e(value,n)
  where nullif(btrim(e.value->>'text'),'') is not null
  on conflict (plan_id,step_no) do update
    set text=excluded.text,
      status=case when excluded.status='done' then 'done' else public.maia_plan_steps.status end,
      updated_at=now()
    where public.maia_plan_steps.status in ('pending','waiting');
  if new.status='cancelled' then
    update public.maia_plan_steps set status='cancelled', updated_at=now()
      where plan_id=new.id and status in ('pending','waiting','blocked');
  end if;
  return new;
end;
$$;

create trigger maia_plan_steps_sync_after_write
after insert or update of steps,status on public.maia_plans
for each row execute function public.sync_maia_plan_steps();

-- Planos que já existiam antes da migration passam a ter etapas sem executar nada.
insert into public.maia_plan_steps(plan_id,step_no,text,depends_on,status)
select p.id, e.n::integer, left(e.value->>'text',4000),
  case when e.n=1 then '{}'::integer[] else array[(e.n-1)::integer] end,
  case when p.status='cancelled' then 'cancelled'
       when coalesce((e.value->>'done')::boolean,false) then 'done' else 'pending' end
from public.maia_plans p cross join lateral jsonb_array_elements(p.steps) with ordinality e(value,n)
where nullif(btrim(e.value->>'text'),'') is not null
on conflict (plan_id,step_no) do nothing;

create or replace function public.activate_maia_skill(p_skill_id uuid, p_owner_key text)
returns public.maia_skills
language plpgsql security definer set search_path = public
as $$
declare v_skill public.maia_skills;
begin
  select * into v_skill from public.maia_skills where id=p_skill_id and status='proposal' for update;
  if not found then return null; end if;
  update public.maia_skills set status='archived', updated_at=now()
    where slug=v_skill.slug and status='active';
  update public.maia_skills set status='active', approved_by=p_owner_key, approved_at=now(), updated_at=now()
    where id=p_skill_id returning * into v_skill;
  return v_skill;
end;
$$;

create or replace function public.purge_maia_scoped_history(p_before timestamptz default now() - interval '7 days')
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  -- Conversas de grupo e membros seguem a retenção de group_messages; privado do owner permanece.
  delete from public.maia_context_summaries c using public.maia_sessions s
    where c.session_id=s.id and s.scope_kind in ('group','member_private')
      and exists (select 1 from public.maia_session_messages m where m.session_id=s.id and m.id<=c.covers_through_message_id and m.at < p_before);
  delete from public.maia_session_messages m using public.maia_sessions s
    where m.session_id=s.id and s.scope_kind in ('group','member_private') and m.at < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_maia_plan_step(p_plan_id bigint, p_step_no integer, p_lease_owner text, p_lease_seconds integer default 300)
returns public.maia_plan_steps
language plpgsql security definer set search_path = public
as $$
declare v_step public.maia_plan_steps;
begin
  -- Nunca reclamar um efeito cujo worker anterior pode já ter iniciado.
  update public.maia_plan_steps s set status='leased', lease_owner=p_lease_owner,
    lease_until=now() + make_interval(secs => greatest(1, least(p_lease_seconds, 3600))),
    attempts=s.attempts+1, updated_at=now()
  where s.plan_id=p_plan_id and s.step_no=p_step_no and s.status='pending'
    and exists (select 1 from public.maia_plans p where p.id=s.plan_id and p.status='active')
    and not exists (
      select 1 from unnest(s.depends_on) dep_no
      left join public.maia_plan_steps dep on dep.plan_id=s.plan_id and dep.step_no=dep_no
      where dep.id is null or dep.status <> 'done'
    )
  returning s.* into v_step;
  return v_step;
end;
$$;

create or replace function public.claim_maia_schedule_run(p_schedule_id uuid, p_run_key text, p_lease_owner text, p_lease_seconds integer default 300)
returns public.maia_schedule_runs
language plpgsql security definer set search_path = public
as $$
declare v_run public.maia_schedule_runs;
begin
  -- Chave = instante agendado. Uma falha ou lease vencido exige revisão, não replay.
  insert into public.maia_schedule_runs(schedule_id, run_key, status, lease_owner, lease_until)
  select s.id, p_run_key, 'leased', p_lease_owner,
    now() + make_interval(secs => greatest(1, least(p_lease_seconds, 3600)))
  from public.maia_schedules s
  where s.id=p_schedule_id and s.status='active' and s.next_run_at <= now()
    and s.next_run_at = p_run_key::timestamptz
  on conflict (schedule_id, run_key) do nothing
  returning * into v_run;
  return v_run;
end;
$$;

revoke all on function public.claim_maia_plan_step(bigint,integer,text,integer) from public, anon, authenticated;
revoke all on function public.claim_maia_schedule_run(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_maia_plan_step(bigint,integer,text,integer) to service_role;
grant execute on function public.claim_maia_schedule_run(uuid,text,text,integer) to service_role;
revoke all on function public.claim_maia_waiting_plan(bigint,jsonb,text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_maia_waiting_plan(bigint,jsonb,text,timestamptz) to service_role;
revoke all on function public.activate_maia_skill(uuid,text) from public, anon, authenticated;
grant execute on function public.activate_maia_skill(uuid,text) to service_role;
revoke all on function public.claim_maia_subagent(uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_maia_subagent(uuid,integer) to service_role;
revoke all on function public.sync_maia_plan_steps() from public, anon, authenticated;
revoke all on function public.purge_maia_scoped_history(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_maia_scoped_history(timestamptz) to service_role;
