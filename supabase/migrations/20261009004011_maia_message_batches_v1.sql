create table if not exists public.message_batches (
  id bigint generated always as identity primary key,
  conversa text not null,
  status text not null default 'aguardando_mensagens'
    check (status in ('aguardando_mensagens','pronto','em_execucao','concluido','falhou','incerto')),
  opened_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  ready_at timestamptz not null,
  deadline_at timestamptz not null,
  task_id bigint references public.tasks(id) on delete set null,
  error text,
  updated_at timestamptz not null default now()
);
create index if not exists message_batches_open_idx on public.message_batches (conversa, status);

create table if not exists public.batch_items (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.message_batches(id) on delete cascade,
  inbox_id bigint unique,
  seq integer not null,
  kind text not null check (kind in ('text')),
  payload text,
  received_at timestamptz not null default now()
);
create index if not exists batch_items_batch_idx on public.batch_items (batch_id, seq);

-- Junta a mensagem ao lote aberto da conversa (ou abre um). Atômico: um lote por vez por conversa.
create or replace function public.add_batch_item(p_conversa text, p_inbox_id bigint, p_text text, p_window_s integer, p_max_s integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id bigint;
  now_ts timestamptz := now();
  next_seq integer;
begin
  select id into b_id from public.message_batches
   where conversa = p_conversa and status = 'aguardando_mensagens'
   order by id desc limit 1 for update;
  if b_id is null then
    insert into public.message_batches (conversa, status, opened_at, last_at, ready_at, deadline_at)
    values (p_conversa, 'aguardando_mensagens', now_ts, now_ts,
            now_ts + make_interval(secs => p_window_s), now_ts + make_interval(secs => p_max_s))
    returning id into b_id;
  else
    update public.message_batches
       set last_at = now_ts,
           ready_at = least(now_ts + make_interval(secs => p_window_s), deadline_at),
           updated_at = now_ts
     where id = b_id;
  end if;
  select coalesce(max(seq), 0) + 1 into next_seq from public.batch_items where batch_id = b_id;
  insert into public.batch_items (batch_id, inbox_id, seq, kind, payload)
  values (b_id, p_inbox_id, next_seq, 'text', p_text)
  on conflict (inbox_id) do nothing;
  return b_id;
end $$;

revoke execute on function public.add_batch_item(text, bigint, text, integer, integer) from public, anon, authenticated;
grant execute on function public.add_batch_item(text, bigint, text, integer, integer) to service_role;

alter table public.message_batches enable row level security;
alter table public.batch_items enable row level security;
