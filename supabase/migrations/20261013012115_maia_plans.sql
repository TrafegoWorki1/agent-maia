-- maia_plans
-- O que muda e por quê: planos de várias etapas do dono (pedido do owner, 13/10/2026). Quando o dono manda um pedido com
-- vários passos ("crie o grupo, mande o link, dê boas-vindas quando ele entrar..."), a Maia grava o plano aqui. Cada etapa
-- que depende de um evento (aprovação concluída, alguém entrar no grupo) fica em `waiting`; quando o evento acontece, o
-- worker chama a Maia de volta com o plano e ela executa a etapa seguinte, dentro do que o dono pediu.
-- Código que depende desta migração: server/plans.ts, server/groups.ts, server/groupJoin.ts, server/maiaImageTool.ts.
-- Rollback (nova migração que desfaz, nunca edição desta): desativar os gatilhos no código e, depois, remover a tabela.
-- Só adiciona uma tabela: compatível com o código antigo. RLS ligada e acesso só pelo servidor (service_role).

create table public.maia_plans (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (char_length(title) between 3 and 120),
  request text not null default '' check (char_length(request) <= 4000),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  status text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  waiting jsonb check (waiting is null or jsonb_typeof(waiting) = 'object'),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  task_id bigint
);

create index maia_plans_active_idx on public.maia_plans (status) where status = 'active';

alter table public.maia_plans enable row level security;
revoke all on public.maia_plans from public, anon, authenticated;
grant select, insert, update, delete on public.maia_plans to service_role;
