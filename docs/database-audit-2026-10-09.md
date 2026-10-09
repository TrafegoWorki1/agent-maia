# Auditoria do banco: diagnóstico inicial (09/10/2026)

Projeto Supabase: Agent Maia (`cwiidfyzrirphalglaep`). Auditoria somente de leitura.

## Resultado em uma frase

O banco real **não** tem estrutura "solta": ele bate com o que o histórico de migrações do Supabase aplicou (449 objetos
comparados, 0 divergências). O problema era o **repositório**: das 18 migrações aplicadas, só 2 tinham arquivo no GitHub
(e sem versão, com SQL reformatado). As outras 16 existiam apenas no histórico do Supabase.

## 1. Migrações

| Situação | Quantidade |
|---|---|
| Aplicadas no Supabase (`schema_migrations`) | 18 |
| Com arquivo no repositório antes desta auditoria | 2 (`maia_scheduled_actions_v1`, `maia_conversations_contacts_v1`), sem prefixo de versão |
| Ausentes no repositório | 16 |

Recuperadas **exatamente** a partir de `supabase_migrations.schema_migrations.statements` (o SQL realmente aplicado), com o
nome `AAAAMMDDHHMMSS_nome.sql` igual ao histórico. As duas migrações antigas do repositório foram substituídas pelas versões
exatas e com prefixo (eram cópias reformatadas, não o SQL aplicado).

## 2. Esquema real x migrações

Método: as 18 migrações foram aplicadas do zero num Postgres temporário e o retrato do esquema foi comparado, objeto a
objeto, com o retrato do Supabase real (mesmo SQL de inspeção nos dois). Compara tabelas, colunas, constraints, índices,
funções (corpo, segurança, privilégios de execução), gatilhos, políticas RLS, privilégios de tabela e a extensão `vector`.

- Existe no banco e falta nas migrações: **nenhum objeto**.
- Existe nas migrações e falta no banco: **nenhum objeto**.
- Diferenças de coluna, função, constraint ou política: **nenhuma**.
- Ruído tratado de propósito (não é drift): versão da extensão `vector` (0.8.1 local x 0.8.2 plataforma), função
  `rls_auto_enable()` (criada pela plataforma, comparada só pelos privilégios) e NOT NULL listado como constraint no PG 18.

Inventário (28 tabelas): `inbox`, `events`, `messages`, `tasks`, `task_events`, `approvals`, `agent_runs`,
`message_batches`, `batch_items`, `people`, `person_numbers`, `person_permissions`, `permission_catalog`, `maia_rules`,
`maia_groups`, `group_messages`, `contacts`, `outreach`, `scheduled_actions`, `knowledge_sources`, `knowledge_chunks`,
`provider_health`, `image_quota`, `jev_triage`, `group_activity`, `snapshots`, `seen_messages`, `kv`.
Funções RPC (11 do projeto + 1 da plataforma): `claim_inbox`, `purge_inbox_payloads`, `record_group_activity`, `add_batch_item`,
`due_owner_batches`, `search_knowledge`, `claim_image_quota`, `release_image_quota`, `claim_due_actions`,
`purge_group_messages`, `is_owner`. RLS ligado em todas as tabelas; políticas só para o fluxo do painel autenticado
(`people`, `person_numbers`, `person_permissions`, `permission_catalog`, `maia_rules`). Extensão usada: `vector` (schema `extensions`).

## 3. Código x banco

Todas as 28 tabelas e 11 funções chamadas pelo código (`.from("x")`, `.rpc("x")`) existem nas migrações. Verificação
automática em `pnpm db:validate`.

## 4. Riscos e achados

1. **Migração dependia de objeto da plataforma**: `maia_revoke_rls_auto_enable_public` referencia `public.rls_auto_enable()`,
   criada pelo Supabase. Num banco novo fora do Supabase ela não existe; o bootstrap de teste a recria. Sem alteração na produção.
2. **Migração com dados**: `maia_people_permissions_v1` insere pessoas e números do owner e do aprovador (e a de grupos, o
   grupo operacional). Os números hoje estão trocados em relação ao SQL (foi corrigido por UPDATE direto em 08/10, fora de
   migração). É diferença de **dados**, não de esquema; o detector de drift compara só estrutura. Os dados atuais mandam.
3. **Edge Function `embed` só existia no Supabase.** Agora versionada em `supabase/functions/embed/index.ts`.
4. **Configuração de Auth e Vercel não está versionada** (fica nos painéis).
5. `claim_due_actions` e `purge_group_messages` são `security invoker` (as demais internas são `security definer`). Funciona
   porque só o `service_role` as executa; vale padronizar numa migração futura (não feita aqui, para não mexer na produção).
6. O token do Supabase no `.env` local se chama `SUPABASE_ACCESS_TOKKEN` (typo). Os scripts aceitam os dois nomes.
7. O deploy da Vercel acontece no merge em `main`: sem disciplina, o código chega antes da migração. A regra 6 do
   `docs/database-migrations.md` e o checklist do PR tratam disso; não há como a Vercel esperar a migração automaticamente.

## 5. Dependências para ativar a CI no GitHub

Segredos do repositório: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (workflow de drift). Ambiente `production` com
revisor obrigatório e segredos `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (workflow de aplicação).
Proteção da branch `main` exigindo o check "CI / validate". Isso é configuração do GitHub e não foi alterado.
