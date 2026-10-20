-- Impede avisos simultâneos para a mesma tarefa e instante, inclusive prazo e manual.
-- Preserva histórico; rollback por nova migração restaurando guard_task_reminder.
create or replace function public.guard_task_reminder() returns trigger
language plpgsql security invoker set search_path = public as $$
declare task_status text;
begin
 if NEW.status = 'pending' then
  select status into task_status from work_tasks where id = NEW.work_task_id for update;
  if task_status = 'concluida' then raise exception 'A tarefa já está concluída'; end if;
  if exists (
   select 1 from task_reminders r
   where r.work_task_id = NEW.work_task_id and r.run_at = NEW.run_at
    and r.status in ('pending', 'sending', 'sent', 'uncertain')
    and r.id <> NEW.id and r.request_key <> NEW.request_key
  ) then
   raise exception 'Já existe lembrete para esta tarefa e horário' using errcode = '23505';
  end if;
 end if;
 return NEW;
end $$;

