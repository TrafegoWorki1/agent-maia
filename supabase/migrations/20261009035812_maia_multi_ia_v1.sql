alter table public.agent_runs
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists categoria text,
  add column if not exists complexidade text,
  add column if not exists motivo text,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer,
  add column if not exists duration_ms integer,
  add column if not exists fallback_de text,
  add column if not exists erro_classe text,
  add column if not exists tentativas integer not null default 1;

create table if not exists public.provider_health (
  provider text primary key,
  state text not null default 'healthy' check (state in ('healthy','degraded','cooldown','unavailable','recovering')),
  consecutive_failures integer not null default 0,
  cooldown_until timestamptz,
  last_error text,
  last_error_class text,
  updated_at timestamptz not null default now()
);
alter table public.provider_health enable row level security;

alter table public.jev_triage
  add column if not exists intencao text,
  add column if not exists complexidade text,
  add column if not exists risco text;

create table if not exists public.image_quota (
  dia date primary key,
  usadas integer not null default 0
);
alter table public.image_quota enable row level security;

-- Reserva atômica da cota diária de imagens: só incrementa se ainda houver saldo.
create or replace function public.claim_image_quota(p_dia date, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare ok boolean;
begin
  insert into public.image_quota (dia, usadas) values (p_dia, 0) on conflict (dia) do nothing;
  update public.image_quota set usadas = usadas + 1 where dia = p_dia and usadas < p_limit returning true into ok;
  return coalesce(ok, false);
end $$;

revoke execute on function public.claim_image_quota(date, integer) from public, anon, authenticated;
grant execute on function public.claim_image_quota(date, integer) to service_role;
