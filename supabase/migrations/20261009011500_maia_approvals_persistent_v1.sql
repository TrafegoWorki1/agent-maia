alter table public.approvals add column if not exists kind text not null default 'ferramenta' check (kind in ('ferramenta','grupo'));
alter table public.approvals add column if not exists summary text;
alter table public.approvals add column if not exists payload jsonb;
alter table public.approvals add column if not exists task_id bigint references public.tasks(id) on delete set null;
alter table public.approvals add column if not exists expires_at timestamptz;
alter table public.approvals add column if not exists process_id integer;
alter table public.approvals add column if not exists decided_by text;
-- Pedidos antigos, sem prazo, que ainda estavam pendentes: encerrados.
update public.approvals set status = 'expired', resolved_at = now() where status = 'pending' and expires_at is null;
create index if not exists approvals_open_idx on public.approvals (status, expires_at);
