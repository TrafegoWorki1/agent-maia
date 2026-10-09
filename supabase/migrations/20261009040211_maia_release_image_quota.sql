create or replace function public.release_image_quota(p_dia date)
returns void
language sql
security definer
set search_path = public
as $$
  update public.image_quota set usadas = greatest(usadas - 1, 0) where dia = p_dia;
$$;

revoke execute on function public.release_image_quota(date) from public, anon, authenticated;
grant execute on function public.release_image_quota(date) to service_role;
