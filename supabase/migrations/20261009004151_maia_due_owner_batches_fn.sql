create or replace function public.due_owner_batches()
returns setof bigint
language sql
security definer
set search_path = public
as $$
  select id from public.message_batches
   where conversa = 'owner:whatsapp'
     and status = 'aguardando_mensagens'
     and (ready_at <= now() or deadline_at <= now())
   order by id;
$$;

revoke execute on function public.due_owner_batches() from public, anon, authenticated;
grant execute on function public.due_owner_batches() to service_role;
