-- creative_asset_catalog
-- Catálogo privado e durável dos originais de trabalhos criativos. Os bytes usam o bucket privado
-- midia-recebida já usado pela aplicação; esta migration não publica bucket nem abre acesso cliente.
-- Rollback do código mantém assets/histórico; remoção exige migration compensatória e autorização.

create table public.creative_assets (
  asset_id uuid primary key default gen_random_uuid(),
  job_id bigint references public.creative_jobs(id) on delete set null,
  job_item_id bigint references public.creative_job_items(id) on delete set null,
  project_id uuid references public.work_projects(id) on delete set null,
  client_id uuid references public.maia_clients(id) on delete set null,
  conversation_id text not null,
  source_message_id text,
  asset_kind text not null check (asset_kind in ('image','carousel_slide','video','document','archive')),
  sequence_number integer check (sequence_number is null or sequence_number > 0),
  sequence_total integer check (sequence_total is null or sequence_total > 0),
  title text not null check (length(btrim(title)) between 1 and 200),
  filename text not null check (length(btrim(filename)) between 1 and 160),
  mime_type text not null check (length(btrim(mime_type)) between 1 and 120),
  storage_provider text not null default 'supabase',
  storage_key text,
  thumbnail_key text,
  checksum text check (checksum is null or checksum ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','rejected','published','missing','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  delivery_id text,
  delivery_status text not null default 'not_sent' check (delivery_status in ('not_sent','accepted','sent','delivered','failed','uncertain')),
  error_code text check (error_code is null or length(error_code) <= 80),
  check (sequence_number is null or sequence_total is null or sequence_number <= sequence_total),
  check (status = 'missing' or storage_key is not null),
  check ((job_id is null and job_item_id is null) or (job_id is not null and job_item_id is not null))
);
create unique index creative_assets_job_item_unique on public.creative_assets(job_item_id) where job_item_id is not null;
create index creative_assets_conversation_recent on public.creative_assets(conversation_id,created_at desc);
create index creative_assets_job_sequence on public.creative_assets(job_id,sequence_number);
create index creative_assets_project_recent on public.creative_assets(project_id,created_at desc);
create index creative_assets_client_recent on public.creative_assets(client_id,created_at desc);
create index creative_assets_title_search on public.creative_assets using gin (to_tsvector('simple',title));
create index creative_assets_status_recent on public.creative_assets(status,created_at desc);
create index creative_assets_delivery_id on public.creative_assets(delivery_id) where delivery_id is not null;

alter table public.creative_job_items add column asset_id uuid references public.creative_assets(asset_id) on delete set null;

create table public.creative_asset_deliveries (
  id bigint generated always as identity primary key,
  asset_id uuid not null references public.creative_assets(asset_id) on delete cascade,
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 180),
  channel text not null check (channel = 'whatsapp'),
  destination_scope text not null check (destination_scope = 'owner_private'),
  status text not null default 'not_sent' check (status in ('not_sent','prepared','accepted','sent','delivered','failed','uncertain')),
  delivery_id text,
  error_code text check (error_code is null or length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index creative_asset_deliveries_asset_recent on public.creative_asset_deliveries(asset_id,created_at desc);
create unique index creative_asset_delivery_one_open on public.creative_asset_deliveries(asset_id)
  where status in ('prepared','accepted','sent','uncertain');

alter table public.creative_assets enable row level security;
alter table public.creative_asset_deliveries enable row level security;
revoke all on public.creative_assets,public.creative_asset_deliveries from public,anon,authenticated;
grant all on public.creative_assets,public.creative_asset_deliveries to service_role;
grant usage,select on sequence public.creative_asset_deliveries_id_seq to service_role;

create or replace function public.validate_creative_asset_scope() returns trigger language plpgsql set search_path='' as $$
declare v_project_client uuid; v_source_task bigint;
begin
  if NEW.project_id is not null then
    select client_id into v_project_client from public.work_projects where id=NEW.project_id;
    if not found then raise exception 'Projeto de ativo não encontrado'; end if;
    if NEW.client_id is not null and NEW.client_id is distinct from v_project_client then raise exception 'Projeto e cliente do ativo não correspondem'; end if;
    NEW.client_id := v_project_client;
  end if;
  if NEW.job_item_id is not null then
    select j.source_task_id into v_source_task from public.creative_job_items i join public.creative_jobs j on j.id=i.job_id where i.id=NEW.job_item_id and j.id=NEW.job_id;
    if v_source_task is null then raise exception 'Item e trabalho criativo não correspondem'; end if;
  end if;
  return NEW;
end;
$$;
create trigger creative_assets_scope before insert or update of job_id,job_item_id,project_id,client_id on public.creative_assets
for each row execute function public.validate_creative_asset_scope();
