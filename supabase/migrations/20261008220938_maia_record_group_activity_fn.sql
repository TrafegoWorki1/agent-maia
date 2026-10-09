create or replace function public.record_group_activity(p_jid text, p_at timestamptz)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.group_activity (jid, last_at, messages) values (p_jid, p_at, 1)
  on conflict (jid) do update set last_at = excluded.last_at, messages = public.group_activity.messages + 1;
$$;

revoke execute on function public.record_group_activity(text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_group_activity(text, timestamptz) to service_role;
