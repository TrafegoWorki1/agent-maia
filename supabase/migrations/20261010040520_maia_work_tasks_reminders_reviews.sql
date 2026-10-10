-- Plano de eficácia autorizado pelo owner em 10/10/2026. Mudanças aditivas.
-- Código: workTasks.ts, taskReminders.ts, responseDelivery.ts, effectiveness.ts.
-- Rollback: voltar o código; manter tabelas e histórico, sem apagar dados.
create table public.work_tasks (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 title text not null check(length(btrim(title)) between 1 and 200),
 responsible text not null check(length(btrim(responsible)) between 1 and 100),
 status text not null default 'pendente' check(status in ('pendente','em_andamento','concluida')),
 due_at timestamptz,
 timezone text not null default 'America/Sao_Paulo' check(timezone = 'America/Sao_Paulo'),
 completion_evidence text check(length(completion_evidence) <= 2000), completed_at timestamptz,
 revision integer not null default 1, source_task_id bigint references public.tasks(id), request_key text not null unique,
 check(status <> 'concluida' or (completed_at is not null and coalesce(length(btrim(completion_evidence)),0) > 0))
);
create index work_tasks_open_due on public.work_tasks(due_at,id) where status <> 'concluida';
alter table public.work_tasks enable row level security;
create table public.work_task_updates (
 id bigint generated always as identity primary key, work_task_id bigint not null references public.work_tasks(id),
 at timestamptz not null default now(), revision integer not null, detail jsonb not null
);
create index work_task_updates_task on public.work_task_updates(work_task_id,id);
alter table public.work_task_updates enable row level security;
create table public.task_reminders (
 id bigint generated always as identity primary key, work_task_id bigint not null references public.work_tasks(id),
 created_at timestamptz not null default now(), run_at timestamptz not null,
 kind text not null check(kind in ('prazo','manual')), request_key text not null unique,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','cancelled')),
 claimed_at timestamptz, finished_at timestamptz, message_id text, error text,
 check(status <> 'sent' or message_id is not null)
);
create unique index task_reminders_due_unique on public.task_reminders(work_task_id) where kind = 'prazo';
create index task_reminders_pending on public.task_reminders(run_at,id) where status = 'pending';
alter table public.task_reminders enable row level security;
-- Revalida sob lock: concluir uma tarefa não pode concorrer com um lembrete novo pendente.
create function public.guard_task_reminder() returns trigger language plpgsql security invoker set search_path = public as $$
declare task_status text;
begin
 if NEW.status = 'pending' then
  select status into task_status from work_tasks where id = NEW.work_task_id for update;
  if task_status = 'concluida' then raise exception 'A tarefa já está concluída'; end if;
 end if;
 return NEW;
end $$;
create trigger reminder_before before insert or update on public.task_reminders for each row execute function public.guard_task_reminder();
create function public.track_work_task() returns trigger language plpgsql security invoker set search_path = public as $$
begin
 if TG_OP = 'UPDATE' then
  NEW.revision := OLD.revision + 1; NEW.updated_at := now();
  if NEW.due_at is distinct from OLD.due_at and exists(select 1 from task_reminders where work_task_id = NEW.id and kind = 'prazo' and status = 'sending') then
   raise exception 'Lembrete em envio; aguarde antes de alterar o prazo';
  end if;
 end if;
 if NEW.status = 'concluida' then NEW.completed_at := coalesce(NEW.completed_at,now());
 else NEW.completed_at := null; NEW.completion_evidence := null; end if;
 return NEW;
end $$;
create trigger work_task_before before insert or update on public.work_tasks for each row execute function public.track_work_task();
create function public.audit_work_task() returns trigger language plpgsql security invoker set search_path = public as $$
begin
 insert into work_task_updates(work_task_id,revision,detail) values(NEW.id,NEW.revision,to_jsonb(NEW) - 'request_key');
 if NEW.status = 'concluida' or NEW.due_at is null then
  update task_reminders set status = 'cancelled', finished_at = now() where work_task_id = NEW.id and status = 'pending' and (NEW.status = 'concluida' or kind = 'prazo');
 elsif TG_OP = 'INSERT' or NEW.due_at is distinct from OLD.due_at or OLD.status = 'concluida' then
  insert into task_reminders(work_task_id,run_at,kind,request_key) values(NEW.id,NEW.due_at,'prazo','prazo:' || NEW.id)
   on conflict(request_key) do update set run_at = excluded.run_at,status = 'pending',claimed_at = null,finished_at = null,message_id = null,error = null;
 end if;
 return NEW;
end $$;
create trigger work_task_after after insert or update on public.work_tasks for each row execute function public.audit_work_task();
create function public.claim_task_reminders(p_limit integer default 10) returns setof public.task_reminders
language sql security invoker set search_path = public as $$
 update task_reminders set status = 'sending',claimed_at = now() where id in (
  select r.id from task_reminders r join work_tasks t on t.id = r.work_task_id
  where r.status = 'pending' and r.run_at <= now() and t.status <> 'concluida'
  order by r.run_at,r.id limit greatest(1,least(p_limit,50)) for update of r skip locked
 ) returning *;
$$;
create table public.response_deliveries (
 id bigint generated always as identity primary key, task_id bigint not null references public.tasks(id),part integer not null,
 recipient text not null,text text,request_text text,created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain')),
 claimed_at timestamptz,finished_at timestamptz,message_id text,error text,unique(task_id,part),
 check(status <> 'sent' or message_id is not null)
);
create index response_deliveries_pending on public.response_deliveries(id) where status = 'pending';
alter table public.response_deliveries enable row level security;
create function public.claim_response_delivery(p_task_id bigint default null) returns setof public.response_deliveries
language sql security invoker set search_path = public as $$
 update response_deliveries set status = 'sending',claimed_at = now() where id in (
  select r.id from response_deliveries r where r.status = 'pending' and r.text is not null and (p_task_id is null or r.task_id = p_task_id)
  and not exists(select 1 from response_deliveries prior where prior.task_id = r.task_id and
   (prior.status in ('failed','uncertain','sending') or (prior.part < r.part and prior.status <> 'sent')))
  order by r.id limit 1 for update skip locked
 ) returning *;
$$;
create table public.task_evaluations (
 task_id bigint primary key references public.tasks(id),reviewed_at timestamptz not null default now(),reviewer text not null,
 relevant boolean not null,resolution text not null check(resolution in ('resolvido','parcial','nao_resolvido')),
 expected text not null check(length(btrim(expected)) between 1 and 2000),evidence text not null check(length(btrim(evidence)) between 1 and 2000)
);
alter table public.task_evaluations enable row level security;
revoke all on public.work_tasks,public.work_task_updates,public.task_reminders,public.response_deliveries,public.task_evaluations from anon,authenticated;
grant all on public.work_tasks,public.work_task_updates,public.task_reminders,public.response_deliveries,public.task_evaluations to service_role;
grant usage,select on sequence public.work_tasks_id_seq,public.work_task_updates_id_seq,public.task_reminders_id_seq,public.response_deliveries_id_seq to service_role;
revoke all on function public.guard_task_reminder(),public.track_work_task(),public.audit_work_task(),public.claim_task_reminders(integer),public.claim_response_delivery(bigint) from public,anon,authenticated;
grant execute on function public.guard_task_reminder(),public.track_work_task(),public.audit_work_task(),public.claim_task_reminders(integer),public.claim_response_delivery(bigint) to service_role;

