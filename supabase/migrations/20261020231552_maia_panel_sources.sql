-- Camada exclusiva de leitura gerencial. Não altera regras nem registros operacionais.
create table public.panel_data_sources (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 120),
 provider text not null default 'google_sheets' check(provider='google_sheets'),
 metric_code text not null check(metric_code in ('sales.won','sales.lost','finance.received','finance.expected','finance.overdue','finance.costs','finance.expenses','campaign.spend','campaign.results','campaign.attributed_revenue')),
 source_ref text not null check(source_ref ~ '^[A-Za-z0-9_-]{10,200}$'),
 range_ref text not null check(length(range_ref) between 1 and 180),
 mapping jsonb not null check(jsonb_typeof(mapping)='object'),
 unit text not null check(unit in ('BRL','USD','EUR','count')),
 basis text not null check(length(basis) between 1 and 250),
 coverage text not null check(length(coverage) between 1 and 500),
 client_id uuid references public.maia_clients(id),
 project_id uuid references public.work_projects(id),
 active boolean not null default false,
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 unique(provider,source_ref,range_ref,metric_code)
);
create table public.panel_source_runs (
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references public.panel_data_sources(id),
 config_revision integer not null,
 config_snapshot jsonb not null,
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 status text not null check(status in ('running','ok','error')),
 observations jsonb check(observations is null or (jsonb_typeof(observations)='array' and jsonb_array_length(observations)<=5000)),
 error text check(length(error)<=500),
 check((status='running' and completed_at is null) or (status<>'running' and completed_at is not null)),
 check(status<>'ok' or observations is not null)
);
create index panel_source_runs_latest on public.panel_source_runs(source_id,config_revision,started_at desc);
create index panel_source_runs_success on public.panel_source_runs(source_id,config_revision,completed_at desc) where status='ok';
create table public.panel_source_health (
 source text primary key check(source in ('gmail','meta','sheets','calendar')),
 last_attempt_at timestamptz not null,
 last_success_at timestamptz,
 error text
);
alter table public.panel_data_sources enable row level security;
alter table public.panel_source_runs enable row level security;
alter table public.panel_source_health enable row level security;
revoke all on public.panel_data_sources, public.panel_source_runs, public.panel_source_health from anon, authenticated;
grant all on public.panel_data_sources, public.panel_source_runs, public.panel_source_health to service_role;

create function public.claim_panel_source(p_source uuid,p_revision integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare cfg panel_data_sources; run_id uuid;
begin
 select * into cfg from panel_data_sources where id=p_source for update;
 if not found or not cfg.active or cfg.revision<>p_revision then return null; end if;
 if exists(select 1 from panel_source_runs where source_id=p_source and status='running' and started_at>now()-interval '5 minutes') then return null; end if;
 update panel_source_runs set status='error',completed_at=now(),error='Coleta interrompida; tentativa expirada.' where source_id=p_source and status='running';
 insert into panel_source_runs(source_id,config_revision,config_snapshot,status) values(p_source,p_revision,to_jsonb(cfg),'running') returning id into run_id;
 return run_id;
end $$;

create function public.finish_panel_source(p_run uuid,p_rows jsonb,p_error text default null) returns void
language plpgsql security definer set search_path=public as $$
declare run panel_source_runs; cfg panel_data_sources; source_key uuid;
begin
 select source_id into source_key from panel_source_runs where id=p_run;
 if not found then raise exception 'Coleta inexistente'; end if;
 select * into cfg from panel_data_sources where id=source_key for update;
 select * into run from panel_source_runs where id=p_run for update;
 if run.status<>'running' then return; end if;
 if cfg.revision<>run.config_revision then
  update panel_source_runs set status='error',completed_at=now(),error='Configuração alterada durante a coleta.' where id=p_run; return;
 end if;
 if p_error is null then
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'Lote inválido'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r)<>'object' or coalesce(r->>'key','')='' or coalesce(r->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(r->'value') is distinct from 'number') then raise exception 'Observação inválida'; end if;
  if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct r->>'key') from jsonb_array_elements(p_rows) r) then raise exception 'Identificador duplicado no lote'; end if;
  perform (r->>'date')::date from jsonb_array_elements(p_rows) r;
 end if;
 update panel_source_runs set status=case when p_error is null then 'ok' else 'error' end,completed_at=now(),observations=case when p_error is null then p_rows else null end,error=left(p_error,500) where id=p_run;
end $$;
revoke all on function public.claim_panel_source(uuid,integer), public.finish_panel_source(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_panel_source(uuid,integer), public.finish_panel_source(uuid,jsonb,text) to service_role;
