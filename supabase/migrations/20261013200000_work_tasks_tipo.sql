-- work_tasks_tipo
-- O que muda e por quê: adiciona coluna `tipo` (nullable) em work_tasks para categorizar tarefas
-- como melhoria, bug, conteudo, operacional ou outro. Nullable para não quebrar tarefas existentes;
-- a Maia pode preencher ao criar e o owner pode editar no painel. Filtro no painel usa este campo.

alter table public.work_tasks
  add column if not exists tipo text
  check (tipo is null or tipo in ('melhoria','bug','conteudo','operacional','outro'));
