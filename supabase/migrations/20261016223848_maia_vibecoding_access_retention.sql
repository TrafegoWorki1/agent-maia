-- maia_vibecoding_access_retention
-- O que muda e por quê:
-- Código que depende desta migração:
-- Rollback (nova migração que desfaz, nunca edição desta):
-- Se houver comando destrutivo, inclua a linha: -- destrutivo-aprovado: <quem aprovou e por quê>

-- maia_vibecoding_access_retention
-- Escopo fino de recursos, rastreio de compartilhamentos feitos pela Maia e retenção configurável.
-- Aditiva. O código nega acesso com segurança enquanto esta migration ainda não estiver aplicada.
-- Rollback: pausar o uso no código e criar migration compensatória que revogue as funções e arquive
-- as tabelas. Não apagar registros de autorização/auditoria sem exportação e aprovação explícita.

create table public.maia_resource_access (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  client_id uuid references public.maia_clients(id) on delete cascade,
  project_id uuid references public.work_projects(id) on delete cascade,
  access_group_id uuid references public.maia_access_groups(id) on delete cascade,
  resource_type text not null check (resource_type in ('drive_file','drive_folder','client','project','group','integration','task')),
  resource_id text not null check (char_length(btrim(resource_id)) between 1 and 500),
  capability text not null check (capability in ('read','write','send','share','admin')),
  decision text not null check (decision in ('allow','deny','approval_required')),
  source text not null check (source in ('direct','access_group','manual','maia')),
  expires_at timestamptz,
  created_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (expires_at is null or expires_at > created_at),
  check ((source = 'access_group') = (access_group_id is not null))
);
create index maia_resource_access_person_idx on public.maia_resource_access(person_id,resource_type,resource_id,capability) where revoked_at is null;
create index maia_resource_access_scope_idx on public.maia_resource_access(client_id,project_id) where revoked_at is null;
create unique index maia_resource_access_live_unique on public.maia_resource_access(person_id,resource_type,resource_id,capability,coalesce(access_group_id::text,'')) where revoked_at is null;

create table public.maia_resource_access_audit (
  id bigint generated always as identity primary key,
  resource_access_id uuid references public.maia_resource_access(id) on delete set null,
  actor_person_id uuid references public.people(id) on delete set null,
  at timestamptz not null default now(),
  operation text not null check (operation in ('created','changed','revoked','expired')),
  previous_value jsonb,
  new_value jsonb,
  task_id bigint references public.tasks(id) on delete set null
);
create index maia_resource_access_audit_resource_idx on public.maia_resource_access_audit(resource_access_id,at desc);

create table public.maia_drive_permissions (
  id uuid primary key default gen_random_uuid(),
  drive_permission_id text not null,
  drive_file_id text,
  drive_folder_id text,
  person_id uuid references public.people(id) on delete set null,
  client_id uuid references public.maia_clients(id) on delete set null,
  permission_role text not null,
  created_by_maia boolean not null default true check (created_by_maia),
  requested_by uuid references public.people(id) on delete set null,
  approved_by uuid references public.people(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_status text not null default 'active' check (revocation_status in ('active','revoking','revoked','failed','uncertain')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  check ((drive_file_id is null) <> (drive_folder_id is null)),
  unique(drive_permission_id)
);
create index maia_drive_permissions_resource_idx on public.maia_drive_permissions(coalesce(drive_file_id,drive_folder_id),revocation_status);

alter table public.maia_resource_access enable row level security;
alter table public.maia_resource_access_audit enable row level security;
alter table public.maia_drive_permissions enable row level security;
revoke all on public.maia_resource_access, public.maia_resource_access_audit, public.maia_drive_permissions from public, anon, authenticated;
grant select,insert,update,delete on public.maia_resource_access, public.maia_resource_access_audit, public.maia_drive_permissions to service_role;

create or replace function public.purge_maia_raw_messages(
  p_owner_before timestamptz default now() - interval '90 days',
  p_scoped_before timestamptz default now() - interval '7 days'
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_messages integer := 0; v_owner_session integer := 0; v_scoped integer := 0; v_summaries integer := 0;
begin
  delete from public.messages where at < p_owner_before;
  get diagnostics v_messages = row_count;

  delete from public.maia_context_summaries c using public.maia_sessions s, public.maia_session_messages covered
   where c.session_id=s.id and covered.id=c.covers_through_message_id and (
     (s.scope_kind in ('owner_private','panel') and covered.at < p_owner_before) or
     (s.scope_kind in ('group','member_private','client') and covered.at < p_scoped_before)
   );
  get diagnostics v_summaries = row_count;

  delete from public.maia_session_messages m using public.maia_sessions s
   where m.session_id=s.id and s.scope_kind in ('owner_private','panel') and m.at < p_owner_before;
  get diagnostics v_owner_session = row_count;
  delete from public.maia_session_messages m using public.maia_sessions s
   where m.session_id=s.id and s.scope_kind in ('group','member_private','client') and m.at < p_scoped_before;
  get diagnostics v_scoped = row_count;
  return jsonb_build_object('messages',v_messages,'ownerSessionMessages',v_owner_session,'scopedSessionMessages',v_scoped,'summaries',v_summaries,'ranAt',now());
end;
$$;

revoke all on function public.purge_maia_raw_messages(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.purge_maia_raw_messages(timestamptz,timestamptz) to service_role;

-- Ativação normativa das quatro regras alteradas no catálogo 2026-10-16.2.
do $$
declare r record; v_current text;
begin
  for r in select * from (values
    ('aprovacao_regras',
     $old$Cada aprovação vale para uma ação e uma única vez, expira em 10 minutos e nunca concede permissão permanente. O servidor aceita OK ou SIM para aprovar e NÃO para recusar. Se houver mais de um pedido aberto, é obrigatório informar o número. Respeite a limitação de pedidos simultâneos imposta pelo fluxo. Reinício ou resultado incerto não autoriza repetir a ação.$old$,
     $new$Cada aprovação vale para uma ferramenta, operação, recurso, destinatário, conteúdo e payload exatos, uma única vez, expira em 10 minutos e nunca concede permissão permanente. Só uma aprovação de ferramenta fica em andamento por fluxo, embora filas e processos distintos possam manter vários pedidos persistidos. O servidor aceita OK ou SIM para aprovar e NÃO para recusar; se houver mais de um pedido aberto, é obrigatório informar o número. Reinício deixa a execução pendente órfã e não a executa. Mudança do pedido invalida a aprovação. Resultado incerto não autoriza repetir a ação.$new$),
    ('execucao',
     $old$Respeite os limites de passos, tempo, custo e concorrência aplicados pelo executor e por config/ai-routing.json. O Claude tem até 12 passos; o orçamento varia por categoria. Não prometa que todos os executores têm o mesmo orçamento ou as mesmas conexões. Ação externa de resultado incerto não é repetida sozinha.$old$,
     $new$Respeite os limites de passos, tempo, custo e concorrência definidos em config/ai-routing.json. execution.maxSteps é a única fonte do limite geral: Claude CLI e Agent SDK usam esse valor como turnos, e o Codex o aplica às chamadas MCP observáveis porque seu SDK não expõe limite nativo de turnos. O orçamento varia por categoria. Não prometa que todos os executores têm o mesmo orçamento ou as mesmas conexões. Ação externa de resultado incerto não é repetida sozinha.$new$),
    ('dados_guardados',
     $old$Mensagens do owner e respostas da Maia em messages não têm prazo automático de remoção por enquanto. Texto e autoria em grupos cadastrados e contexto de conversas privadas de membros/contatos elegíveis usam group_messages, com retenção de 7 dias. Payloads da fila inbox são limpos após 24 horas pelo worker. Arquivos do owner ficam por 24 horas; arquivos de membros e contatos elegíveis, por 7 dias. A limpeza depende do processo responsável estar ativo. Não inclua conversas, arquivos recebidos ou dados de clientes na base documental do projeto.$old$,
     $new$A retenção fica em config/data-retention.json. Mensagens brutas do owner e respostas associadas ficam por 90 dias; conversas escopadas de grupos e membros, por 7 dias; payloads da fila inbox, por 24 horas; arquivos do owner, por 24 horas; arquivos de membros e contatos elegíveis, por 7 dias. A limpeza registra totais e última execução. Memória durável, auditoria e recibos seguem políticas próprias e nunca são apagados junto com mensagens brutas. Resumos são contexto, não autorização nem prova de conclusão. Não inclua conversas, arquivos recebidos ou dados de clientes na base documental do projeto.$new$),
    ('conectores_ferramentas',
     $old$Antes de declarar que não tem acesso, confira as ferramentas disponibilizadas ao executor; use ToolSearch quando ele estiver disponível. Conectores exclusivos do Claude não são herdados pelo Codex. Para planilhas e documentos, use a ferramenta apropriada do Google Drive se disponível, respeitando seu esquema e as permissões do solicitante, e devolva o link real. Adote padrões razoáveis para detalhes reversíveis; pergunte quando faltar destino, identidade, conteúdo final ou outro dado necessário. Não invente uma ferramenta ou afirme sucesso após erro.$old$,
     $new$Antes de declarar que não tem acesso, confira as ferramentas disponibilizadas ao executor; use ToolSearch quando ele estiver disponível. Conectores exclusivos do Claude não são herdados pelo Codex. Para Drive e planilhas, sheets.ler é apenas a capacidade base: membros também precisam de autorização vigente para o arquivo, pasta, cliente ou projeto; busca global sem recurso identificado é bloqueada. Negação específica vence herança e o acesso é revalidado antes da execução e da entrega. Compartilhamento direto não rastreável fica bloqueado; a Maia só pode confirmar ou revogar permissões criadas pelo fluxo gerenciado e conferidas por permissionId. Adote padrões razoáveis para detalhes reversíveis; pergunte quando faltar destino, identidade, conteúdo final ou outro dado necessário. Não invente uma ferramenta ou afirme sucesso após erro.$new$)
  ) as changed(codigo,old_text,new_text)
  loop
    select texto into v_current from public.maia_rules where codigo=r.codigo for update;
    if not found then raise exception 'regra % ausente',r.codigo; end if;
    if v_current is distinct from r.old_text then raise exception 'regra % divergiu; alinhe antes de aplicar',r.codigo; end if;
    update public.maia_rules set texto=r.new_text,atualizada_em=now() where codigo=r.codigo;
  end loop;
end;
$$;
