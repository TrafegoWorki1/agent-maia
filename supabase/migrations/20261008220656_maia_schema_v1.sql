
create table if not exists public.events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event text not null,
  kind text not null,
  sender text not null check (sender in ('owner','approver','other','none','group')),
  outcome text not null
);
create index if not exists events_received_at_idx on public.events (received_at);

create table if not exists public.approvals (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  tool_name text not null,
  status text not null check (status in ('pending','approved','denied','expired'))
);

create table if not exists public.agent_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  purpose text not null,
  status text not null,
  cost_usd double precision,
  error text
);

create table if not exists public.snapshots (
  source text primary key,
  fetched_at timestamptz not null,
  status text not null,
  data jsonb,
  error text
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp','painel')),
  author text not null check (author in ('owner','approver','maia')),
  text text not null
);
create index if not exists messages_at_idx on public.messages (at desc);

create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp','painel')),
  kind text not null default 'conversa' check (kind in ('operacional','conversa')),
  summary text not null,
  status text not null check (status in ('recebida','em_andamento','aguardando_aprovacao','concluida','falhou','incerta')),
  started_at timestamptz,
  replied_at timestamptz,
  finished_at timestamptz,
  error text,
  group_name text
);
create index if not exists tasks_created_at_idx on public.tasks (created_at desc);

create table if not exists public.task_events (
  id bigint generated always as identity primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  at timestamptz not null default now(),
  type text not null,
  operation text,
  detail text
);

create table if not exists public.seen_messages (
  key_id text primary key,
  at timestamptz not null default now()
);

create table if not exists public.kv (
  key text primary key,
  value text not null,
  at timestamptz not null default now()
);

create table if not exists public.group_activity (
  jid text primary key,
  last_at timestamptz not null,
  messages integer not null default 0
);

-- Fila de entrada: o webhook (Vercel) grava aqui; o worker (PC) lê e processa.
create table if not exists public.inbox (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  key_id text unique,
  kind text not null check (kind in ('text','audio','event')),
  sender text not null check (sender in ('owner','approver','other','group','none')),
  payload text,
  status text not null default 'pendente' check (status in ('pendente','processando','concluido','falhou')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  error text,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists inbox_pending_idx on public.inbox (received_at) where status = 'pendente';

-- Reserva itens pendentes sem dois workers pegarem o mesmo.
create or replace function public.claim_inbox(p_limit integer default 10)
returns setof public.inbox
language sql
security definer
set search_path = public
as $$
  update public.inbox i
     set status = 'processando', claimed_at = now(), attempts = i.attempts + 1
   where i.id in (
     select id from public.inbox
      where status = 'pendente'
      order by received_at
      for update skip locked
      limit p_limit
   )
  returning i.*;
$$;

-- Apaga o texto (payload) de itens vencidos. Retorna quantos foram limpos.
create or replace function public.purge_inbox_payloads()
returns integer
language sql
security definer
set search_path = public
as $$
  with cleared as (
    update public.inbox set payload = null
     where payload is not null and expires_at < now()
    returning 1
  )
  select count(*)::int from cleared;
$$;

revoke execute on function public.claim_inbox(integer) from public, anon, authenticated;
revoke execute on function public.purge_inbox_payloads() from public, anon, authenticated;
grant execute on function public.claim_inbox(integer) to service_role;
grant execute on function public.purge_inbox_payloads() to service_role;

-- Sem políticas: anon e authenticated não leem nem escrevem. O servidor usa a service_role, que ignora RLS.
alter table public.events enable row level security;
alter table public.approvals enable row level security;
alter table public.agent_runs enable row level security;
alter table public.snapshots enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.seen_messages enable row level security;
alter table public.kv enable row level security;
alter table public.group_activity enable row level security;
alter table public.inbox enable row level security;
