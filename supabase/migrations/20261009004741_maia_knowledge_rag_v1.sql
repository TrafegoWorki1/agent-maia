create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_sources (
  id bigint generated always as identity primary key,
  slug text not null unique,
  titulo text not null,
  origem text not null,
  checksum text not null,
  escopo text not null default 'operacao',
  ativo boolean not null default true,
  indexed_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id bigint generated always as identity primary key,
  source_id bigint not null references public.knowledge_sources(id) on delete cascade,
  ordem integer not null,
  secao text not null default '',
  conteudo text not null,
  embedding extensions.vector(384) not null,
  fts tsvector generated always as (to_tsvector('portuguese', coalesce(secao, '') || ' ' || conteudo)) stored
);
create index if not exists knowledge_chunks_source_idx on public.knowledge_chunks (source_id, ordem);
create index if not exists knowledge_chunks_fts_idx on public.knowledge_chunks using gin (fts);
create index if not exists knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Busca híbrida: semântica (vetor) + palavra-chave (português), combinadas por RRF.
create or replace function public.search_knowledge(p_query text, p_embedding extensions.vector(384), p_limit integer default 6)
returns table (chunk_id bigint, titulo text, secao text, conteudo text, origem text, score double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with sem as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as r
      from public.knowledge_chunks c join public.knowledge_sources s on s.id = c.source_id
     where s.ativo
     order by c.embedding <=> p_embedding
     limit 30
  ),
  kw as (
    select c.id, row_number() over (order by ts_rank(c.fts, websearch_to_tsquery('portuguese', p_query)) desc) as r
      from public.knowledge_chunks c join public.knowledge_sources s on s.id = c.source_id
     where s.ativo and c.fts @@ websearch_to_tsquery('portuguese', p_query)
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

alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
