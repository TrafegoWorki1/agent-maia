-- Etapa 0: vínculos opcionais de contexto organizacional em work_tasks.
-- Aditivo: compatível com código existente; todos os campos são nullable.
-- FK para maia_clients será adicionada quando a tabela for criada (Etapa 2).

alter table public.work_tasks
  add column if not exists area text
    check (area is null or area in (
      'marketing','comercial','projetos','implementacoes',
      'clientes_cs','financeiro','administracao','agente_sistema'
    )),
  add column if not exists client_id text,
  add column if not exists project_id text;

comment on column public.work_tasks.area is 'Departamento operacional da tarefa (OperationalArea)';
comment on column public.work_tasks.client_id is 'ID do cliente associado (maia_clients.id quando existir)';
comment on column public.work_tasks.project_id is 'ID ou referência do projeto associado';
