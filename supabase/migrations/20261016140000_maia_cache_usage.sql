-- Registra apenas contadores de cache explicitamente reportados pelo Claude.
alter table public.agent_runs
  add column cache_read_tokens integer,
  add column cache_creation_tokens integer;
