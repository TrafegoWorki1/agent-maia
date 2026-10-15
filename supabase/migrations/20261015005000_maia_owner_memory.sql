-- Memória explícita e auditável do owner, compartilhada pelo agente e pelo painel.
-- Acesso apenas pelo backend com service_role; RLS bloqueia clientes diretos.
create table if not exists public.owner_memories (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  detail text not null check (char_length(btrim(detail)) between 1 and 4000),
  kind text not null default 'compromisso' check (kind in ('compromisso','contexto','preferencia')),
  status text not null default 'active' check (status in ('active','completed','archived')),
  due_at timestamptz,
  source_task_id bigint references public.tasks(id) on delete set null,
  created_by text not null default 'maia' check (created_by in ('maia','owner')),
  completed_at timestamptz,
  revision integer not null default 1 check (revision > 0)
);
create index if not exists owner_memories_active_updated_idx on public.owner_memories (updated_at desc) where status = 'active';
create index if not exists owner_memories_due_idx on public.owner_memories (due_at) where status = 'active' and due_at is not null;
alter table public.owner_memories enable row level security;
revoke all on table public.owner_memories from public, anon, authenticated;
grant select, insert, update on table public.owner_memories to service_role;
grant usage, select on sequence public.owner_memories_id_seq to service_role;
