create table if not exists public.jev_triage (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  channel text not null check (channel in ('whatsapp','painel')),
  task_id bigint references public.tasks(id) on delete set null,
  categoria text,
  confianca double precision,
  manipulacao boolean,
  urgencia integer,
  ms integer,
  erro text,
  ferramentas text[] not null default '{}',
  concordou boolean
);
create index if not exists jev_triage_at_idx on public.jev_triage (at desc);
alter table public.jev_triage enable row level security;
-- Sem políticas: só o servidor (service role) grava e lê. O painel recebe pelo snapshot, já checado como proprietário.
