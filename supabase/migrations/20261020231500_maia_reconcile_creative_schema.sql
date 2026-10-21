-- Reconcilia a estrutura criativa ja presente em producao com o historico versionado.
-- Sem remocao de registros ou alteracao de regras da Maia. Rollback: manter estrutura aditiva.
create table if not exists public."creative_assets" (
 "asset_id" uuid default gen_random_uuid() not null,
 "job_id" bigint,
 "job_item_id" bigint,
 "project_id" uuid,
 "client_id" uuid,
 "conversation_id" text not null,
 "source_message_id" text,
 "asset_kind" text not null,
 "sequence_number" integer,
 "sequence_total" integer,
 "title" text not null,
 "filename" text not null,
 "mime_type" text not null,
 "storage_provider" text default 'supabase'::text not null,
 "storage_key" text,
 "thumbnail_key" text,
 "checksum" text,
 "status" text default 'draft'::text not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "approved_at" timestamp with time zone,
 "sent_at" timestamp with time zone,
 "delivery_id" text,
 "delivery_status" text default 'not_sent'::text not null,
 "error_code" text
);
alter table public."creative_assets" enable row level security;
create table if not exists public."creative_asset_deliveries" (
 "id" bigint generated always as identity not null,
 "asset_id" uuid not null,
 "idempotency_key" text not null,
 "channel" text not null,
 "destination_scope" text not null,
 "status" text default 'not_sent'::text not null,
 "delivery_id" text,
 "error_code" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "finished_at" timestamp with time zone
);
alter table public."creative_asset_deliveries" enable row level security;
alter table public.creative_job_items add column if not exists asset_id uuid;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_channel_check' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_channel_check" CHECK (channel = 'whatsapp'::text); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_destination_scope_check' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_destination_scope_check" CHECK (destination_scope = 'owner_private'::text); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_error_code_check' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_error_code_check" CHECK (error_code IS NULL OR length(error_code) <= 80); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_idempotency_key_check' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_idempotency_key_check" CHECK (length(btrim(idempotency_key)) >= 1 AND length(btrim(idempotency_key)) <= 180); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_idempotency_key_key' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_idempotency_key_key" UNIQUE (idempotency_key); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_pkey' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_pkey" PRIMARY KEY (id); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_status_check' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_status_check" CHECK (status = ANY (ARRAY['not_sent'::text, 'prepared'::text, 'accepted'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'uncertain'::text])); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_asset_kind_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_asset_kind_check" CHECK (asset_kind = ANY (ARRAY['image'::text, 'carousel_slide'::text, 'video'::text, 'document'::text, 'archive'::text])); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_check" CHECK (sequence_number IS NULL OR sequence_total IS NULL OR sequence_number <= sequence_total); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_check1' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_check1" CHECK (status = 'missing'::text OR storage_key IS NOT NULL); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_check2' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_check2" CHECK (job_id IS NULL AND job_item_id IS NULL OR job_id IS NOT NULL AND job_item_id IS NOT NULL); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_checksum_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_checksum_check" CHECK (checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'::text); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_delivery_status_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_delivery_status_check" CHECK (delivery_status = ANY (ARRAY['not_sent'::text, 'accepted'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'uncertain'::text])); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_error_code_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_error_code_check" CHECK (error_code IS NULL OR length(error_code) <= 80); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_filename_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_filename_check" CHECK (length(btrim(filename)) >= 1 AND length(btrim(filename)) <= 160); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_mime_type_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_mime_type_check" CHECK (length(btrim(mime_type)) >= 1 AND length(btrim(mime_type)) <= 120); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_pkey' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_pkey" PRIMARY KEY (asset_id); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_sequence_number_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_sequence_number_check" CHECK (sequence_number IS NULL OR sequence_number > 0); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_sequence_total_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_sequence_total_check" CHECK (sequence_total IS NULL OR sequence_total > 0); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_status_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'pending_approval'::text, 'approved'::text, 'rejected'::text, 'published'::text, 'missing'::text, 'archived'::text])); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_title_check' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 200); end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_job_items_asset_id_fkey' and conrelid='public.creative_job_items'::regclass) then alter table public."creative_job_items" add constraint "creative_job_items_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES creative_assets(asset_id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_asset_deliveries_asset_id_fkey' and conrelid='public.creative_asset_deliveries'::regclass) then alter table public."creative_asset_deliveries" add constraint "creative_asset_deliveries_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES creative_assets(asset_id) ON DELETE CASCADE; end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_client_id_fkey' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_client_id_fkey" FOREIGN KEY (client_id) REFERENCES maia_clients(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_job_id_fkey' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_job_id_fkey" FOREIGN KEY (job_id) REFERENCES creative_jobs(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_job_item_id_fkey' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_job_item_id_fkey" FOREIGN KEY (job_item_id) REFERENCES creative_job_items(id) ON DELETE SET NULL; end if; end $$;
do $$ begin if not exists(select 1 from pg_constraint where conname='creative_assets_project_id_fkey' and conrelid='public.creative_assets'::regclass) then alter table public."creative_assets" add constraint "creative_assets_project_id_fkey" FOREIGN KEY (project_id) REFERENCES work_projects(id) ON DELETE SET NULL; end if; end $$;
CREATE INDEX IF NOT EXISTS creative_asset_deliveries_asset_recent ON public.creative_asset_deliveries USING btree (asset_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS creative_asset_delivery_one_open ON public.creative_asset_deliveries USING btree (asset_id) WHERE (status = ANY (ARRAY['prepared'::text, 'accepted'::text, 'sent'::text, 'uncertain'::text]));
CREATE UNIQUE INDEX IF NOT EXISTS creative_assets_job_item_unique ON public.creative_assets USING btree (job_item_id) WHERE (job_item_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS creative_assets_conversation_recent ON public.creative_assets USING btree (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_assets_job_sequence ON public.creative_assets USING btree (job_id, sequence_number);
CREATE INDEX IF NOT EXISTS creative_assets_project_recent ON public.creative_assets USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_assets_client_recent ON public.creative_assets USING btree (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_assets_title_search ON public.creative_assets USING gin (to_tsvector('simple'::regconfig, title));
CREATE INDEX IF NOT EXISTS creative_assets_status_recent ON public.creative_assets USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS creative_assets_delivery_id ON public.creative_assets USING btree (delivery_id) WHERE (delivery_id IS NOT NULL);
CREATE OR REPLACE FUNCTION public.validate_creative_asset_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
do $$ begin if not exists(select 1 from pg_trigger where tgname='creative_assets_scope' and tgrelid='public.creative_assets'::regclass) then CREATE TRIGGER creative_assets_scope BEFORE INSERT OR UPDATE OF job_id, job_item_id, project_id, client_id ON public.creative_assets FOR EACH ROW EXECUTE FUNCTION validate_creative_asset_scope(); end if; end $$;
revoke all on public.creative_assets,public.creative_asset_deliveries from anon,authenticated;
grant all on public.creative_assets,public.creative_asset_deliveries to service_role;
grant usage,select on sequence public.creative_asset_deliveries_id_seq to service_role;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='creative_resend_idempotency' and policyname='service_role_only') then create policy service_role_only on public.creative_resend_idempotency for all to public using(auth.role()='service_role') with check(auth.role()='service_role'); end if; end $$;
