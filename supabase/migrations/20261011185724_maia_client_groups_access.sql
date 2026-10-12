-- maia_client_groups_access
-- Clientes e grupos de acesso reais; classificação no cadastro existente de WhatsApp.
-- Código dependente: organization, groupScope, access, conversations e painel.
-- Rollback: voltar o código anterior; preservar tabelas e colunas aditivas para não perder cadastros.

create table public.maia_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now()
);
create unique index maia_clients_name on public.maia_clients (lower(trim(name)));

create table public.maia_access_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  client_id uuid references public.maia_clients(id),
  active boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now()
);
create unique index maia_access_groups_name on public.maia_access_groups (lower(trim(name)));
create index maia_access_groups_client on public.maia_access_groups(client_id);

create table public.maia_access_group_members (
  access_group_id uuid not null references public.maia_access_groups(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (access_group_id, person_id)
);
create index maia_access_group_members_person on public.maia_access_group_members(person_id);
create table public.maia_access_group_permissions (
  access_group_id uuid not null references public.maia_access_groups(id) on delete cascade,
  permission_code text not null references public.permission_catalog(code),
  primary key (access_group_id, permission_code),
  check (permission_code <> 'escrita.aprovar')
);

alter table public.maia_groups
  add column kind text not null default 'interno' check (kind in ('interno','cliente')),
  add column client_id uuid references public.maia_clients(id),
  add column access_group_id uuid references public.maia_access_groups(id),
  add column scope_started_at timestamptz not null default now(),
  add column revision integer not null default 1 check (revision > 0),
  add constraint maia_groups_client_kind check ((kind = 'cliente' and client_id is not null) or (kind = 'interno' and client_id is null));
create index maia_groups_client on public.maia_groups(client_id);
create index maia_groups_access_group on public.maia_groups(access_group_id);

-- A autoria do histórico mantém o cliente da época: reclassificar um grupo não relê dados do cliente anterior.
alter table public.group_messages add column client_id uuid references public.maia_clients(id);
create index group_messages_scope on public.group_messages(conv, client_id, at desc);
create function public.stamp_group_message_client() returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.client_id := (select case when new.at >= scope_started_at then client_id else null end from public.maia_groups where jid = new.conv);
  return new;
end;
$$;
revoke all on function public.stamp_group_message_client() from public, anon, authenticated;
grant execute on function public.stamp_group_message_client() to service_role;
create trigger group_messages_client before insert on public.group_messages for each row execute function public.stamp_group_message_client();

-- Alterações de membros/permissões são uma transação, com revisão para evitar sobrescrita concorrente.
create function public.save_maia_access_group(p_id uuid, p_revision integer, p_name text, p_client_id uuid,
  p_active boolean, p_members uuid[], p_permissions text[]) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_revision integer;
begin
  if p_id is null then
    insert into public.maia_access_groups(name, client_id, active) values (trim(p_name), p_client_id, p_active) returning id into v_id;
  else
    select revision into v_revision from public.maia_access_groups where id = p_id for update;
    if v_revision is null or v_revision is distinct from p_revision then raise exception 'Grupo alterado por outra sessão. Atualize antes de salvar.'; end if;
    if exists(select 1 from public.maia_groups where access_group_id = p_id and client_id is distinct from p_client_id) then
      raise exception 'O cliente deve corresponder aos grupos de WhatsApp vinculados.';
    end if;
    update public.maia_access_groups set name = trim(p_name), client_id = p_client_id, active = p_active, revision = revision + 1 where id = p_id;
    v_id := p_id;
  end if;
  delete from public.maia_access_group_members where access_group_id = v_id;
  insert into public.maia_access_group_members(access_group_id, person_id) select v_id, unnest(p_members);
  delete from public.maia_access_group_permissions where access_group_id = v_id;
  insert into public.maia_access_group_permissions(access_group_id, permission_code) select v_id, unnest(p_permissions);
  return v_id;
end;
$$;
revoke all on function public.save_maia_access_group(uuid, integer, text, uuid, boolean, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.save_maia_access_group(uuid, integer, text, uuid, boolean, uuid[], text[]) to service_role;

create function public.check_maia_group_access_scope() returns trigger language plpgsql security invoker set search_path = public as $$
declare v_client uuid;
begin
  if tg_op = 'UPDATE' and (new.client_id is distinct from old.client_id or new.access_group_id is distinct from old.access_group_id or new.active is distinct from old.active) then
    new.scope_started_at := now();
  end if;
  if new.access_group_id is not null then
    select client_id into v_client from public.maia_access_groups where id = new.access_group_id for share;
    if not found or v_client is distinct from new.client_id then
      raise exception 'O grupo de acesso deve pertencer ao mesmo cliente.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.check_maia_group_access_scope() from public, anon, authenticated;
grant execute on function public.check_maia_group_access_scope() to service_role;
create trigger maia_groups_access_scope before insert or update on public.maia_groups for each row execute function public.check_maia_group_access_scope();

alter table public.maia_clients enable row level security;
alter table public.maia_access_groups enable row level security;
alter table public.maia_access_group_members enable row level security;
alter table public.maia_access_group_permissions enable row level security;
revoke all on public.maia_clients, public.maia_access_groups, public.maia_access_group_members, public.maia_access_group_permissions from anon, authenticated;
grant all on public.maia_clients, public.maia_access_groups, public.maia_access_group_members, public.maia_access_group_permissions to service_role;
grant select on public.maia_clients, public.maia_access_groups, public.maia_access_group_members, public.maia_access_group_permissions, public.maia_groups to authenticated;
create policy clients_owner_read on public.maia_clients for select to authenticated using ((select public.is_owner()));
create policy access_groups_owner_read on public.maia_access_groups for select to authenticated using ((select public.is_owner()));
create policy access_members_owner_read on public.maia_access_group_members for select to authenticated using ((select public.is_owner()));
create policy access_permissions_owner_read on public.maia_access_group_permissions for select to authenticated using ((select public.is_owner()));
create policy groups_owner_read on public.maia_groups for select to authenticated using ((select public.is_owner()));
