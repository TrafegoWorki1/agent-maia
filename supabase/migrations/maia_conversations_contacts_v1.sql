-- Aplicada no Supabase em 2026-10-09. Memória das conversas (7 dias), agenda de contatos e mensagens diretas da Maia.
create table public.group_messages (id bigint generated always as identity primary key, conv text not null, participant text not null default '', name text not null default '', text text not null, from_maia boolean not null default false, key_id text, at timestamptz not null default now());
create index group_messages_conv_at on public.group_messages (conv, at desc);
create unique index group_messages_key on public.group_messages (conv, key_id) where key_id is not null;
alter table public.group_messages enable row level security;
create table public.contacts (number text primary key, name text not null default '', aliases text[] not null default '{}', source text not null default 'grupo' check (source in ('grupo','cadastrado','mensagem')), first_conv text, last_seen timestamptz not null default now(), created_at timestamptz not null default now());
alter table public.contacts enable row level security;
create table public.outreach (id bigint generated always as identity primary key, number text not null, name text not null default '', text text not null, task_id bigint, key_id text, at timestamptz not null default now());
create index outreach_number_at on public.outreach (number, at desc);
alter table public.outreach enable row level security;
create or replace function public.purge_group_messages() returns integer language sql security invoker as $$
  with d as (delete from public.group_messages where at < now() - interval '7 days' returning 1) select count(*)::int from d;
$$;
revoke all on function public.purge_group_messages() from public, anon, authenticated;
insert into public.permission_catalog (code, label, description) values ('mensagem.enviar', 'Enviar mensagens', 'Pedir que a Maia mande mensagem a contatos e grupos cadastrados.') on conflict do nothing;
insert into public.person_permissions (person_id, permission_code) select id, 'mensagem.enviar' from public.people where role in ('proprietario','aprovador') on conflict do nothing;
-- maia_groups_last_reply: alter table public.maia_groups add column last_reply_at timestamptz, add column last_reply_to text;
