-- maia_resumable_creative_jobs
-- Cada arte é uma unidade de trabalho persistente; reinícios retomam o primeiro item ainda não iniciado.
-- Imagens são pré-visualizações privadas para o owner. Esta fila nunca publica em redes sociais.
-- Rollback: retirar consumidores e adicionar migration reversa; não apagar o histórico de artes.

create table public.creative_jobs (
  id bigint generated always as identity primary key,
  source_task_id bigint not null unique references public.tasks(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  status text not null default 'queued' check (status in ('queued','running','review','partial','uncertain')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index creative_jobs_recent on public.creative_jobs(created_at desc);
create index creative_jobs_active on public.creative_jobs(status,created_at) where status in ('queued','running');

create table public.creative_job_items (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.creative_jobs(id) on delete cascade,
  seq integer not null check (seq between 1 and 10),
  briefing text not null check (length(btrim(briefing)) between 1 and 2000),
  format text not null check (format in ('feed','story','quadrado')),
  refs text[] not null default '{}',
  status text not null default 'queued' check (status in ('queued','generating','artifact_ready','preview_sending','ready_for_review','failed','uncertain')),
  artifact_path text,
  message_id text,
  error text check (error is null or length(error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(job_id,seq),
  check (cardinality(refs) <= 4),
  check (status not in ('artifact_ready','preview_sending','ready_for_review') or artifact_path is not null),
  check (status <> 'ready_for_review' or message_id is not null)
);
create index creative_job_items_queue on public.creative_job_items(job_id,seq) where status in ('queued','artifact_ready');
create index creative_job_items_stale on public.creative_job_items(updated_at) where status in ('generating','preview_sending');

alter table public.creative_jobs enable row level security;
alter table public.creative_job_items enable row level security;
revoke all on public.creative_jobs,public.creative_job_items from public,anon,authenticated;
grant all on public.creative_jobs,public.creative_job_items to service_role;
grant usage,select on sequence public.creative_jobs_id_seq,public.creative_job_items_id_seq to service_role;

create function public.create_creative_job(p_source_task_id bigint,p_title text,p_items jsonb)
returns bigint language plpgsql security invoker set search_path = public as $$
declare
  v_job_id bigint;
  v_item jsonb;
  v_seq integer := 0;
begin
  if p_source_task_id is null or length(btrim(coalesce(p_title,''))) not between 1 and 160 then
    raise exception 'Trabalho criativo inválido';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 10 then
    raise exception 'Um trabalho criativo deve conter de 1 a 10 artes';
  end if;
  insert into public.creative_jobs(source_task_id,title)
  values(p_source_task_id,btrim(p_title))
  on conflict(source_task_id) do nothing
  returning id into v_job_id;
  if v_job_id is null then
    select id into v_job_id from public.creative_jobs where source_task_id=p_source_task_id;
    return v_job_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_seq := v_seq + 1;
    if jsonb_typeof(v_item) <> 'object'
       or length(btrim(coalesce(v_item->>'briefing',''))) not between 1 and 2000
       or coalesce(v_item->>'format','') not in ('feed','story','quadrado')
       or (case when jsonb_typeof(v_item->'refs')='array' then jsonb_array_length(v_item->'refs') else 0 end) > 4 then
      raise exception 'Dados inválidos na arte %',v_seq;
    end if;
    insert into public.creative_job_items(job_id,seq,briefing,format,refs)
    values(v_job_id,v_seq,btrim(v_item->>'briefing'),v_item->>'format',
      case when jsonb_typeof(v_item->'refs')='array' then array(select jsonb_array_elements_text(v_item->'refs')) else '{}'::text[] end);
  end loop;
  return v_job_id;
end;
$$;

create function public.claim_next_creative_item()
returns table(id bigint,job_id bigint,seq integer,briefing text,format text,refs text[],prior_status text,artifact_path text,title text,item_count integer,source_task_id bigint)
language plpgsql security invoker set search_path = public as $$
declare
  v_id bigint;
  v_prior text;
  v_item public.creative_job_items%rowtype;
begin
  if not pg_try_advisory_xact_lock(hashtext('maia:creative-generator')::bigint) then return; end if;
  select i.id,i.status into v_id,v_prior
  from public.creative_job_items i
  join public.creative_jobs j on j.id=i.job_id
  where i.status in ('queued','artifact_ready') and j.status in ('queued','running')
    and not exists(select 1 from public.creative_job_items active where active.status in ('generating','preview_sending'))
  order by j.created_at,i.seq
  limit 1
  for update of i skip locked;
  if v_id is null then return; end if;
  update public.creative_job_items i
     set status=case when v_prior='queued' then 'generating' else 'preview_sending' end,
         updated_at=now(),error=null
   where i.id=v_id returning i.* into v_item;
  update public.creative_jobs set status='running',updated_at=now() where creative_jobs.id=v_item.job_id;
  return query
    select v_item.id,v_item.job_id,v_item.seq,v_item.briefing,v_item.format,v_item.refs,v_prior,v_item.artifact_path,
      j.title,(select count(*)::integer from public.creative_job_items ci where ci.job_id=j.id),j.source_task_id
    from public.creative_jobs j where j.id=v_item.job_id;
end;
$$;

revoke all on function public.create_creative_job(bigint,text,jsonb),public.claim_next_creative_item() from public,anon,authenticated;
grant execute on function public.create_creative_job(bigint,text,jsonb),public.claim_next_creative_item() to service_role;
