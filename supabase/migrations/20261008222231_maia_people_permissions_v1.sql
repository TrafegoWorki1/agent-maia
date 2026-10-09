
-- Catálogo das permissões que a Maia tem hoje. Só muda por migração.
create table if not exists public.permission_catalog (
  code text primary key,
  label text not null,
  description text not null
);

insert into public.permission_catalog (code, label, description) values
  ('conversa.maia', 'Conversar com a Maia', 'Enviar pedidos pelo WhatsApp e receber respostas da Maia.'),
  ('painel.ver', 'Ver o painel', 'Abrir o painel e ver tarefas, conexões e indicadores.'),
  ('tarefas.criar', 'Criar tarefa', 'Criar tarefa com o comando "tarefa Título".'),
  ('resumo.ver', 'Pedir resumo do dia', 'Receber o resumo diário e pedir o resumo sob demanda.'),
  ('gmail.ler', 'Consultar Gmail', 'Ler e resumir e-mails pelo conector do Gmail.'),
  ('meta.ler', 'Consultar Meta Ads', 'Ler campanhas, gastos e métricas pelo conector do Meta Ads.'),
  ('sheets.ler', 'Consultar Sheets', 'Ler planilhas do Google Sheets.'),
  ('agenda.ler', 'Consultar Agenda', 'Ler eventos do Google Agenda.'),
  ('grupos.criar', 'Criar grupo', 'Pedir criação de grupo do WhatsApp (passa por aprovação).'),
  ('escrita.pedir', 'Pedir ações de escrita', 'Pedir ações que alteram algo (passam pelo SIM do aprovador).'),
  ('escrita.aprovar', 'Aprovar ações de escrita', 'Responder SIM ou NÃO a pedidos de escrita.')
on conflict (code) do nothing;

-- Pessoas. Uma pessoa pode ter vários números. Papel: proprietario, aprovador ou equipe.
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('proprietario','aprovador','equipe')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.person_numbers (
  number text primary key check (number ~ '^[0-9]{10,15}$'),
  person_id uuid not null references public.people(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.person_permissions (
  person_id uuid not null references public.people(id) on delete cascade,
  permission_code text not null references public.permission_catalog(code) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (person_id, permission_code)
);

-- Verdadeiro se quem chama é o proprietário ativo.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.people
     where auth_user_id = auth.uid() and role = 'proprietario' and active
  );
$$;

revoke execute on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

-- Pessoas iniciais (ainda sem login). O proprietário ganha o auth_user_id ao aceitar o convite.
insert into public.people (name, role) values ('Herickson Maia', 'proprietario');
insert into public.people (name, role) values ('Aprovador', 'aprovador');

insert into public.person_numbers (number, person_id)
select '5585998372658', id from public.people where role = 'proprietario';
insert into public.person_numbers (number, person_id)
select '5585992494552', id from public.people where role = 'aprovador';

-- Proprietário tem todas as permissões; aprovador só aprova escrita e conversa.
insert into public.person_permissions (person_id, permission_code)
select p.id, c.code from public.people p cross join public.permission_catalog c where p.role = 'proprietario';
insert into public.person_permissions (person_id, permission_code)
select p.id, c.code from public.people p join public.permission_catalog c on c.code in ('conversa.maia','escrita.aprovar')
 where p.role = 'aprovador';

alter table public.permission_catalog enable row level security;
alter table public.people enable row level security;
alter table public.person_numbers enable row level security;
alter table public.person_permissions enable row level security;

create policy catalog_read on public.permission_catalog for select to authenticated using (true);

create policy people_read on public.people for select to authenticated
  using (public.is_owner() or auth_user_id = auth.uid());
create policy people_owner_write on public.people for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy numbers_owner on public.person_numbers for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

create policy permissions_read on public.person_permissions for select to authenticated
  using (public.is_owner() or person_id in (select id from public.people where auth_user_id = auth.uid()));
create policy permissions_owner_write on public.person_permissions for insert to authenticated
  with check (public.is_owner());
create policy permissions_owner_update on public.person_permissions for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy permissions_owner_delete on public.person_permissions for delete to authenticated
  using (public.is_owner());
