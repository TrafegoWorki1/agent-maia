create table public.maia_groups (
  jid text primary key,
  name text not null,
  source text not null default 'criado' check (source in ('criado','cadastrado')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.maia_groups enable row level security;
insert into public.maia_groups (jid, name, source) values ('120363412181825151@g.us', 'Operacional Worki Digital', 'criado') on conflict do nothing;
