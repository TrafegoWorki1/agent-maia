-- Missões delegadas: planos continuam sendo a fonte única do worker e painel.
-- Rollback: voltar código, pausar missões por controle; preservar tabelas/evidências.
alter table public.maia_plans
  add column kind text not null default 'general' check (kind in ('general','conversation','meeting','group_action')),
  add column authority jsonb not null default '{}'::jsonb,
  add column mission_state text check (mission_state in ('working','waiting_external','waiting_owner','paused','done','cancelled')),
  add column revision integer not null default 1,
  add column expires_at timestamptz,
  add column interaction_count integer not null default 0,
  add column max_interactions integer not null default 8 check (max_interactions between 1 and 30),
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column mission_notice text;

create unique index maia_mission_conversation_active on public.maia_plans ((authority->>'conversation'))
  where kind <> 'general' and status = 'active';
create index maia_missions_due on public.maia_plans (mission_state, expires_at) where kind <> 'general';

create table public.maia_mission_events (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.maia_plans(id),
  event_key text not null,
  at timestamptz not null,
  text text not null,
  participant text not null,
  processed boolean not null default false,
  unique(plan_id,event_key)
);
create table public.maia_mission_effects (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.maia_plans(id),
  effect_key text not null,
  kind text not null check (kind in ('message','calendar','group','notice')),
  state text not null default 'pending' check (state in ('pending','confirmed','uncertain')),
  input jsonb not null,
  evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id,effect_key)
);
create index maia_mission_events_age on public.maia_mission_events(at);
create index maia_mission_events_key on public.maia_mission_events(event_key,participant);
-- Reserva de intervalos também protege negociações simultâneas de missões diferentes.
create table public.maia_mission_slots (
  plan_id bigint primary key references public.maia_plans(id),
  calendar_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at)
);
alter table public.maia_mission_events enable row level security;
alter table public.maia_mission_effects enable row level security;
alter table public.maia_mission_slots enable row level security;
revoke all on public.maia_mission_events, public.maia_mission_effects, public.maia_mission_slots from public, anon, authenticated;
grant all on public.maia_mission_events, public.maia_mission_effects, public.maia_mission_slots to service_role;
grant usage, select on sequence public.maia_mission_events_id_seq, public.maia_mission_effects_id_seq to service_role;

create function public.purge_maia_mission_content() returns void
language plpgsql security invoker set search_path=public as $$
begin
  update public.maia_mission_events set text='' where at<now()-interval '7 days' and text<>'';
  update public.maia_mission_effects set input=input-'text' where created_at<now()-interval '7 days' and input ? 'text';
end $$;
revoke all on function public.purge_maia_mission_content() from public,anon,authenticated;
grant execute on function public.purge_maia_mission_content() to service_role;

create function public.claim_maia_mission(p_id bigint, p_token uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare p public.maia_plans;
begin
  select * into p from public.maia_plans where id=p_id for update;
  if not found or p.kind='general' or p.status<>'active' or p.expires_at<=now()
    or p.mission_state not in ('working','waiting_external') then return null; end if;
  if p.lease_until>now() then return null; end if;
  -- Uma execução interrompida pode ter produzido efeito: não entregar a outro executor.
  if p.lease_token is not null then
    update public.maia_plans set mission_state='waiting_owner', lease_token=null, lease_until=null,
      mission_notice='Execução interrompida. Confira as evidências antes de retomar.', updated_at=now() where id=p_id;
    return null;
  end if;
  if p.mission_state='waiting_external' and not exists(select 1 from public.maia_mission_events where plan_id=p_id and not processed) then return null; end if;
  update public.maia_plans set mission_state='working',lease_token=p_token,lease_until=now()+interval '10 minutes',updated_at=now()
    where id=p_id returning * into p;
  return to_jsonb(p);
end $$;

create function public.reserve_maia_mission_slot(p_id bigint, p_revision integer, p_token uuid, p_calendar text, p_start timestamptz, p_end timestamptz) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_calendar));
  perform 1 from public.maia_plans where id=p_id and revision=p_revision and lease_token=p_token
    and lease_until>now() and status='active' and mission_state='working' and expires_at>now() for update;
  if not found then raise exception 'Missão alterada ou expirada'; end if;
  if exists(select 1 from public.maia_mission_slots where calendar_id=p_calendar and starts_at<p_end and ends_at>p_start) then return false; end if;
  insert into public.maia_mission_slots values(p_id,p_calendar,p_start,p_end);
  return true;
end $$;

create function public.finish_maia_mission_turn(p_id bigint,p_revision integer,p_token uuid,p_state text,p_events bigint[],p_context jsonb,p_notice text) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  if p_state not in ('working','waiting_external','waiting_owner','done','cancelled') then raise exception 'Estado inválido'; end if;
  update public.maia_plans set mission_state=p_state,
    status=case when p_state in ('done','cancelled') then p_state else 'active' end,
    context=p_context, lease_token=null, lease_until=null, updated_at=now(),
    mission_notice=coalesce(p_notice,mission_notice)
    where id=p_id and revision=p_revision and lease_token=p_token and kind<>'general' and status='active';
  if not found then return false; end if;
  update public.maia_mission_events set processed=true where plan_id=p_id and id=any(p_events);
  return true;
end $$;
revoke all on function public.finish_maia_mission_turn(bigint,integer,uuid,text,bigint[],jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_maia_mission_turn(bigint,integer,uuid,text,bigint[],jsonb,text) to service_role;

create function public.control_maia_mission(p_id bigint,p_revision integer,p_action text,p_note text default '') returns jsonb
language plpgsql security invoker set search_path = public as $$
declare p public.maia_plans;
begin
  select * into p from public.maia_plans where id=p_id and kind<>'general' for update;
  if not found or p.revision<>p_revision then raise exception 'Missão mudou; atualize a tela'; end if;
  if p.status<>'active' then raise exception 'Missão encerrada'; end if;
  if p_action not in ('pause','cancel','resume','correct') then raise exception 'Controle inválido'; end if;
  if p_action in ('resume','correct') then
    if p.expires_at<=now() then raise exception 'Missão expirada'; end if;
    if p.lease_until>now() then raise exception 'Execução terminando; tente novamente em instantes'; end if;
    if exists(select 1 from public.maia_mission_effects where plan_id=p_id and state<>'confirmed' and kind<>'notice') then
      raise exception 'Efeito incerto: confira no serviço antes de nova missão';
    end if;
  end if;
  if p_action='correct' and length(trim(p_note))<3 then raise exception 'Descreva a correção'; end if;
  update public.maia_plans set revision=revision+1,
    mission_state=case p_action when 'pause' then 'paused' when 'cancel' then 'cancelled' else 'working' end,
    status=case p_action when 'cancel' then 'cancelled' else 'active' end,
    context=case when p_action='correct' then context || jsonb_build_object('owner_correction',left(p_note,2000)) else context end,
    updated_at=now() where id=p_id returning * into p;
  return to_jsonb(p);
end $$;

revoke all on function public.claim_maia_mission(bigint,uuid), public.reserve_maia_mission_slot(bigint,integer,uuid,text,timestamptz,timestamptz), public.control_maia_mission(bigint,integer,text,text) from public, anon, authenticated;
grant execute on function public.claim_maia_mission(bigint,uuid), public.reserve_maia_mission_slot(bigint,integer,uuid,text,timestamptz,timestamptz), public.control_maia_mission(bigint,integer,text,text) to service_role;

-- Catálogo aprovado 2026-10-21.2. Nova regra: não sobrescrever edição concorrente.
do $$ begin
  if exists(select 1 from public.maia_rules where codigo='autonomia_delegada') then
    raise exception 'Regra autonomia_delegada já existe; comparar antes de aplicar';
  end if;
end $$;
insert into public.maia_rules(codigo,categoria,titulo,texto,ordem,ativa) values ('autonomia_delegada','Continuidade','Missões delegadas pelo proprietário','Quando o proprietário no privado pedir para conduzir uma conversa até um resultado, negociar uma reunião ou avisar um grupo após uma resposta, use missao_criar. O servidor persiste o objetivo, contato, canais, calendário, janelas e limites antes do envio. Respostas futuras retomam a missão sem novo comando; terceiros nunca ampliam sua autoridade. Para reunião, use preferências conhecidas ou pergunte somente o essencial: duração, janelas com fuso, calendário, local ou Meet e forma de convite. Não invente preferências. O evento é conferido na agenda e a confirmação exige ID de envio; só então a missão conclui e envia resumo ao owner. Sem conector/recibo válido, relate a pendência. Avisos condicionais em grupos cadastrados usam texto e menções delegados; mencionar todos exige pedido explícito. Pedidos imediatos usam grupo_enviar_texto e grupos não cadastrados preservam a aprovação existente. Use missoes_listar e missao_controlar para andamento, pausa, retomada, correção e cancelamento, alinhados ao painel Núcleo. Correção mantém o envelope; novos destinos ou horários fora dele exigem nova delegação. Cancelar impede próximos efeitos, sem desfazer o que já foi realizado. Incerteza não autoriza repetir envio ou agendamento. Missões não autorizam prospecção fria/em massa, negociação de preços, publicações ou novas integrações. O piloto aceita uma missão ativa por conversa e não faz follow-up sem resposta.',48,true);

