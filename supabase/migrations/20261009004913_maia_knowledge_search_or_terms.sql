create or replace function public.search_knowledge(p_query text, p_embedding extensions.vector(384), p_limit integer default 6)
returns table (chunk_id bigint, titulo text, secao text, conteudo text, origem text, score double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with terms as (
    select array_agg(distinct w) filter (where length(w) > 2) as ws
      from regexp_split_to_table(lower(regexp_replace(p_query, '[^[:alnum:][:space:]]', ' ', 'g')), '\s+') as w
  ),
  q as (
    select to_tsquery('portuguese', coalesce(array_to_string(ws, ' | '), 'sem-termos')) as t from terms
  ),
  sem as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as r
      from public.knowledge_chunks c join public.knowledge_sources s on s.id = c.source_id
     where s.ativo
     order by c.embedding <=> p_embedding
     limit 30
  ),
  kw as (
    select c.id, row_number() over (order by ts_rank(c.fts, q.t) desc) as r
      from public.knowledge_chunks c join public.knowledge_sources s on s.id = c.source_id
      cross join q
     where s.ativo and c.fts @@ q.t
     limit 30
  ),
  fused as (
    select coalesce(sem.id, kw.id) as id,
           coalesce(1.0 / (60 + sem.r), 0) + coalesce(1.0 / (60 + kw.r), 0) as score
      from sem full outer join kw on sem.id = kw.id
  )
  select c.id, s.titulo, c.secao, c.conteudo, s.origem, f.score
    from fused f
    join public.knowledge_chunks c on c.id = f.id
    join public.knowledge_sources s on s.id = c.source_id
   order by f.score desc
   limit p_limit;
$$;

revoke execute on function public.search_knowledge(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function public.search_knowledge(text, extensions.vector, integer) to service_role;
