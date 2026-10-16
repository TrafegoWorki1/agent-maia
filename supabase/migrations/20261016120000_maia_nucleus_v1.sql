-- maia_nucleus_v1
-- Continuidade compartilhada, skills, execução supervisionada e agendas.
-- Tudo é aditivo e acessível somente pelo backend service_role.

create table public.maia_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp','painel')),
  conversation_key text not null check (char_length(btrim(conversation_key)) between 1 and 240),
  requester_key text not null check (char_length(btrim(requester_key)) between 1 and 240),
  client_id uuid references public.maia_clients(id) on delete set null,
  scope_kind text not null check (scope_kind in ('owner_private','member_private','group','client','panel')),
  status text not null default 'active' check (status in ('active','archived')),
  title text not null default '',
  last_message_at timestamptz,
  unique(channel, conversation_key, requester_key, client_id, status)
);
create index maia_sessions_lookup_idx on public.maia_sessions(channel, conversation_key, requester_key, updated_at desc);

create table public.maia_session_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.maia_sessions(id) on delete cascade,
  task_id bigint references public.tasks(id) on delete set null,
  at timestamptz not null default now(),
  author text not null check (author in ('owner','approver','member','maia','system')),
  text text not null check (char_length(text) <= 16000),
  source text not null check (source in ('whatsapp','painel','worker','summary','tool')),
  source_event_key text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  unique(session_id, source_event_key)
);
create index maia_session_messages_recent_idx on public.maia_session_messages(session_id, id desc);

create table public.maia_context_summaries (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.maia_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  covers_through_message_id bigint not null references public.maia_session_messages(id),
  source text not null check (source in ('maia','owner','worker')),
  summary text not null check (char_length(summary) between 1 and 16000),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  source_message_count integer not null default 0 check (source_message_count >= 0)
);
create index maia_context_summaries_session_idx on public.maia_context_summaries(session_id, covers_through_message_id desc);

create table public.maia_skills (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'proposal' check (status in ('proposal','active','archived')),
  description text not null,
  instructions text not null,
  scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  tools text[] not null default '{}',
  approved_by text,
  approved_at timestamptz,
  unique(slug, version)
);
create index maia_skills_active_idx on public.maia_skills(status, slug);

create table public.maia_skill_events (
  id bigint generated always as identity primary key,
  skill_id uuid not null references public.maia_skills(id) on delete cascade,
  session_id uuid references public.maia_sessions(id) on delete set null,
  task_id bigint references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  outcome text not null check (outcome in ('loaded','succeeded','failed','proposed')),
  detail text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table public.maia_plan_steps (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.maia_plans(id) on delete cascade,
  step_no integer not null check (step_no > 0),
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  depends_on integer[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','leased','running','waiting','done','cancelled','uncertain','blocked')),
  result text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  blocked_reason text,
  external_state text not null default 'none' check (external_state in ('none','safe','uncertain','confirmed')),
  lease_owner text,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  updated_at timestamptz not null default now(),
  unique(plan_id, step_no)
);
create index maia_plan_steps_claim_idx on public.maia_plan_steps(status, lease_until, plan_id, step_no);

create table public.maia_subagents (
  id uuid primary key default gen_random_uuid(),
  parent_task_id bigint references public.tasks(id) on delete set null,
  parent_session_id uuid references public.maia_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  objective text not null check (char_length(btrim(objective)) between 1 and 4000),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  allowed_tools text[] not null default '{}',
  depth integer not null default 1 check (depth > 0),
  max_steps integer not null default 20 check (max_steps > 0),
  max_seconds integer not null default 300 check (max_seconds > 0),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled','interrupted')),
  result text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object')
);
create index maia_subagents_parent_idx on public.maia_subagents(parent_task_id, created_at);

create table public.maia_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  client_id uuid references public.maia_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  instruction text not null check (char_length(btrim(instruction)) between 1 and 8000),
  skills text[] not null default '{}',
  schedule_kind text not null check (schedule_kind in ('once','interval','cron')),
  schedule_value text not null,
  timezone text not null default 'America/Sao_Paulo',
  destination text not null,
  limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  missed_policy text not null default 'skip' check (missed_policy in ('skip','run_once','catch_up')),
  status text not null default 'paused' check (status in ('active','paused','cancelled')),
  next_run_at timestamptz
);
create index maia_schedules_due_idx on public.maia_schedules(status, next_run_at);

create table public.maia_schedule_runs (
  id bigint generated always as identity primary key,
  schedule_id uuid not null references public.maia_schedules(id) on delete cascade,
  run_key text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'queued' check (status in ('queued','leased','running','completed','failed','uncertain','skipped')),
  delivery_status text not null default 'not_attempted' check (delivery_status in ('not_attempted','pending','confirmed','failed','uncertain')),
  result text,
  error text,
  lease_owner text,
  lease_until timestamptz,
  unique(schedule_id, run_key)
);
create index maia_schedule_runs_schedule_idx on public.maia_schedule_runs(schedule_id, created_at desc);

create table public.maia_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  client_id uuid references public.maia_clients(id) on delete set null,
  name text not null,
  transport text not null check (transport in ('stdio','http','sse')),
  endpoint text,
  command text,
  allowed_tools text[] not null default '{}',
  timeout_ms integer not null default 10000 check (timeout_ms between 100 and 120000),
  auth_secret_ref text,
  status text not null default 'disabled' check (status in ('disabled','configured','connected','error')),
  last_error text,
  updated_at timestamptz not null default now(),
  unique(owner_key, name, client_id)
);

create table public.maia_controlled_runs (
  id uuid primary key default gen_random_uuid(),
  task_id bigint references public.tasks(id) on delete set null,
  session_id uuid references public.maia_sessions(id) on delete set null,
  requested_by text not null,
  kind text not null check (kind in ('browser','command')),
  cwd text not null,
  network text not null default 'disabled' check (network in ('disabled','allowlist')),
  timeout_ms integer not null check (timeout_ms between 100 and 600000),
  status text not null default 'blocked' check (status in ('blocked','queued','running','completed','failed','cancelled','uncertain')),
  command text,
  output text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create or replace function public.claim_maia_plan_step(p_plan_id bigint, p_step_no integer, p_lease_owner text, p_lease_seconds integer default 300)
returns public.maia_plan_steps
language plpgsql security definer set search_path = public
as $$
declare v_step public.maia_plan_steps;
begin
  update public.maia_plan_steps s set status='leased', lease_owner=p_lease_owner,
    lease_until=now() + make_interval(secs => greatest(1, least(p_lease_seconds, 3600))),
    attempts=s.attempts+1, updated_at=now()
  where s.plan_id=p_plan_id and s.step_no=p_step_no
    and (s.status='pending' or (s.status in ('leased','running') and s.lease_until < now()))
    and not exists (select 1 from public.maia_plan_steps dep where dep.plan_id=s.plan_id and dep.step_no=any(s.depends_on) and dep.status <> 'done')
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
  insert into public.maia_schedule_runs(schedule_id, run_key, status, lease_owner, lease_until)
  values (p_schedule_id, p_run_key, 'leased', p_lease_owner, now() + make_interval(secs => greatest(1, least(p_lease_seconds, 3600))))
  on conflict (schedule_id, run_key) do update set status='leased', lease_owner=excluded.lease_owner, lease_until=excluded.lease_until
    where public.maia_schedule_runs.status in ('queued','failed') or (public.maia_schedule_runs.status in ('leased','running') and public.maia_schedule_runs.lease_until < now())
  returning * into v_run;
  return v_run;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['maia_sessions','maia_session_messages','maia_context_summaries','maia_skills','maia_skill_events','maia_plan_steps','maia_subagents','maia_schedules','maia_schedule_runs','maia_mcp_servers','maia_controlled_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
revoke all on function public.claim_maia_plan_step(bigint,integer,text,integer) from public, anon, authenticated;
revoke all on function public.claim_maia_schedule_run(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.claim_maia_plan_step(bigint,integer,text,integer) to service_role;
grant execute on function public.claim_maia_schedule_run(uuid,text,text,integer) to service_role;
