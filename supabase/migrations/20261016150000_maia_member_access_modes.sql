-- Modos individuais de acesso; bloqueio prevalece sobre concessões de equipes.
-- Depende de people, permission_catalog, person_permissions e maia_access_groups.
-- Rollback: voltar código anterior e preservar esta tabela/histórico; nova migração para remoção após backup.
create table public.maia_member_access_modes (
  person_id uuid not null references public.people(id) on delete cascade,
  permission_code text not null references public.permission_catalog(code),
  mode text not null check (mode in ('permitido','bloqueado','aprovacao')),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (person_id, permission_code)
);
create table public.maia_member_access_audit (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.people(id),
  permission_code text not null references public.permission_catalog(code),
  prior_mode text,
  new_mode text not null,
  prior_direct_grant boolean not null,
  actor_number text not null,
  task_id bigint,
  changed_at timestamptz not null default now()
);
create index maia_member_access_audit_person on public.maia_member_access_audit(person_id, changed_at desc);
alter table public.maia_member_access_modes enable row level security;
alter table public.maia_member_access_audit enable row level security;
revoke all on public.maia_member_access_modes, public.maia_member_access_audit from anon, authenticated;
grant all on public.maia_member_access_modes, public.maia_member_access_audit to service_role;
grant usage, select on sequence public.maia_member_access_audit_id_seq to service_role;
grant select on public.maia_member_access_modes, public.maia_member_access_audit to authenticated;
create policy maia_member_access_modes_owner_read on public.maia_member_access_modes for select to authenticated using ((select public.is_owner()));
create policy maia_member_access_audit_owner_read on public.maia_member_access_audit for select to authenticated using ((select public.is_owner()));
create function public.set_maia_member_access_mode(p_person_id uuid, p_code text, p_mode text, p_actor_number text, p_task_id bigint default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prior text; v_direct boolean; v_actor text;
begin
  if auth.uid() is null and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'Solicitante não autenticado'; end if;
  if auth.uid() is not null and not (select public.is_owner()) then raise exception 'Somente proprietário'; end if;
  v_actor := case when auth.uid() is null then p_actor_number else auth.uid()::text end;
  if v_actor is null or length(trim(v_actor)) < 8 then raise exception 'Autoria inválida'; end if;
  if p_mode not in ('permitido','bloqueado','aprovacao') then raise exception 'Modo inválido'; end if;
  perform 1 from public.people where id = p_person_id and active and role <> 'proprietario' for update;
  if not found then raise exception 'Membro não encontrado ou inativo'; end if;
  if not exists(select 1 from public.permission_catalog where code = p_code) then raise exception 'Capacidade desconhecida'; end if;
  select mode into v_prior from public.maia_member_access_modes where person_id = p_person_id and permission_code = p_code;
  select exists(select 1 from public.person_permissions where person_id = p_person_id and permission_code = p_code) into v_direct;
  insert into public.maia_member_access_modes(person_id, permission_code, mode, updated_by) values(p_person_id,p_code,p_mode,v_actor)
    on conflict(person_id,permission_code) do update set mode=excluded.mode,updated_by=excluded.updated_by,updated_at=now();
  if p_mode = 'permitido' then
    insert into public.person_permissions(person_id,permission_code) values(p_person_id,p_code) on conflict do nothing;
  else
    delete from public.person_permissions where person_id=p_person_id and permission_code=p_code;
  end if;
  insert into public.maia_member_access_audit(person_id,permission_code,prior_mode,new_mode,prior_direct_grant,actor_number,task_id)
    values(p_person_id,p_code,v_prior,p_mode,v_direct,v_actor,p_task_id);
end;
$$;
revoke all on function public.set_maia_member_access_mode(uuid,text,text,text,bigint) from public, anon, authenticated;
grant execute on function public.set_maia_member_access_mode(uuid,text,text,text,bigint) to service_role;
grant execute on function public.set_maia_member_access_mode(uuid,text,text,text,bigint) to authenticated;

-- Uma resposta de aprovação só pode ser consumida pela chamada exata que a criou.
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending','approved','denied','expired','consumed'));
