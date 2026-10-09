-- Aplicada no Supabase em 2026-10-09 (envios agendados em grupos).
create table public.scheduled_actions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  run_at timestamptz not null,
  kind text not null check (kind in ('texto','enquete')),
  group_jid text not null,
  group_name text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','running','done','failed','cancelled')),
  task_id bigint,
  approval_id bigint,
  result text,
  finished_at timestamptz
);
create index scheduled_actions_due on public.scheduled_actions (run_at) where status = 'pending';
alter table public.scheduled_actions enable row level security;
create or replace function public.claim_due_actions(p_limit int default 5)
returns setof public.scheduled_actions
language sql security invoker as $$
  update public.scheduled_actions s set status = 'running'
  where s.id in (select id from public.scheduled_actions where status = 'pending' and run_at <= now() order by run_at limit p_limit for update skip locked)
  returning s.*;
$$;
revoke all on function public.claim_due_actions(int) from public, anon, authenticated;
