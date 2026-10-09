-- Simula o que a plataforma Supabase já entrega antes das migrações do projeto.
-- Só serve para bancos temporários de teste (CI e desenvolvimento). NUNCA aplicar em produção.
-- Mantenha este arquivo mínimo: tudo que o projeto cria deve estar em supabase/migrations.

-- Papéis padrão da plataforma
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Esquemas da plataforma
create schema if not exists extensions;
create schema if not exists auth;
grant usage on schema public, extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- auth.users e auth.uid() (a plataforma define os dois; aqui só o mínimo que o projeto referencia)
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Privilégios padrão do schema public na plataforma (novas tabelas e funções ficam acessíveis aos três papéis;
-- quem protege é o RLS e os REVOKE das migrações)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Função criada pela plataforma (gatilho de RLS automático); a migração maia_revoke_rls_auto_enable_public a referencia
create or replace function public.rls_auto_enable() returns void language plpgsql as $$ begin null; end $$;
