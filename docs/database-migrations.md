# Migrações do banco (Supabase)

## Pendente — regras de vibecoding

`20261016223848_maia_vibecoding_access_retention.sql` cria autorizações por recurso, auditoria, registro de permissões do Drive e a limpeza configurável de mensagens brutas. É aditiva, mantém RLS habilitada e concede acesso somente ao `service_role`. Aplicar na ordem do diretório antes de habilitar acesso Drive de membros; depois executar `pnpm rules:verify`. Reversão deve ser por migration compensatória, preservando registros de autorização e auditoria.

Regra permanente: **as migrações em `supabase/migrations/` são a fonte de verdade do esquema.** Toda mudança estrutural
no banco entra em uma migração SQL versionada, **no mesmo PR** que altera o código dependente. Uma funcionalidade que
mexe no banco sem migração não está concluída.

## Regras

1. Nenhuma feature cria ou altera tabela, coluna, índice, constraint, função, política RLS ou extensão direto em produção
   (SQL Editor, MCP, `execute_sql`, painel). Isso vale para pessoas e para agentes de IA.
2. **Migração aplicada é imutável.** Não edite, renomeie nem apague. Para corrigir, crie uma nova migração.
3. Antes de escrever código, confira: "isto exige mudança no banco?" Se sim, comece pela migração.
4. Mudança **destrutiva** (`drop table/column`, `truncate`, `delete` sem `where`, mudança de tipo, desligar RLS) exige
   aprovação explícita do owner e a linha `-- destrutivo-aprovado: <quem aprovou e por quê>` na migração.
5. O PR traz as evidências: saída de `pnpm typecheck`, `pnpm db:validate` e `pnpm test`, e o `CHANGELOG.md` atualizado.
6. **Merge de código não autoriza alterar a produção.** A migração é aplicada em produção só com aprovação do owner,
   **antes** do merge do código que depende dela (a Vercel faz o deploy ao entrar em `main`).
7. Migrações devem ser compatíveis com o código antigo: primeiro **adicionar** (coluna nova, com default ou nula), depois
   o código passa a usar, e só então uma migração posterior **remove** o que ficou sem uso.
8. Sem segredos, tokens ou dados de clientes nas migrações. Dados iniciais só do que o sistema precisa (catálogo de permissões, regras).
9. Preserve o RLS: tabela nova nasce com `alter table ... enable row level security` e função interna com `revoke ... from public, anon, authenticated`.

## Comandos

Para o comportamento da Maia, `config/maia-rules.json` versiona o catálogo aprovado e `maia_rules` guarda a versão ativada. `pnpm rules:generate` atualiza somente o documento gerado; não grava no banco. A migração de alinhamento compara o valor anterior de cada regra antes de atualizar e interrompe diante de edição concorrente, inclusive desativação. Regras desconhecidas são preservadas; `pnpm rules:verify` acusa divergência para revisão. Alterações futuras exigem nova migração e versão do catálogo, sem editar a migração já aplicada.

A atualização do conhecimento usa `replace_knowledge_document`, RPC exclusiva do servidor, que troca trechos e checksum na mesma transação com comparação da versão anterior. Fontes históricas são desativadas somente após indexação bem-sucedida das regras vigentes; seus trechos são mantidos para reversão. `pnpm knowledge:sync` faz essa sincronização e deve ser executado apenas dentro de uma atualização autorizada.

Preferências persistentes do owner são um mecanismo separado, não um editor de `maia_rules`. A migração `20261011012443_maia_owner_preferences_v1.sql` cria propostas e preferências com RLS, bloqueia `anon`/`authenticated` e concede execução da RPC de ativação ao `service_role`. O owner confirma uma proposta pendente em até 10 minutos; a função ativa o texto atomicamente e substitui o valor anterior do mesmo escopo. A Maia não recebe acesso a SQL livre. **Exceção pontual de 11/10/2026:** o owner autorizou a aplicação direta via MCP porque os segredos do ambiente GitHub `production` não estavam configurados; o Supabase registrou a versão `20261011012443` e o arquivo local foi alinhado a esse histórico. A exceção não altera a regra padrão: futuras migrações devem usar o workflow aprovado abaixo ou `supabase db push`, antes de publicar código dependente.

Memória conversacional durável vive em `owner_memories` (migração `20261015005000_maia_owner_memory.sql`): compromissos, contexto e preferências explicitamente registrados, com origem, prazo, estado e revisão otimista. RLS é habilitado sem acesso de cliente direto; agente e painel usam endpoints/server com `service_role`, e o endpoint do painel valida owner. A migração deve ser aplicada antes do deploy que a consome. Não aplique diretamente em produção por MCP/SQL Editor; siga o fluxo aprovado abaixo.

O núcleo persistente vive na migração aditiva `20261016120000_maia_nucleus_v1.sql`: sessões e mensagens com escopo, resumos com linhagem, skills/propostas/uso, etapas de plano com lease, subagentes, rotinas/agendas, servidores MCP e execuções controladas. Todas as tabelas bloqueiam `anon`/`authenticated` e as reservas usam as RPCs `claim_maia_plan_step` e `claim_maia_schedule_run`. Aplicada ao Supabase do projeto em 16/10/2026, antes do código dependente.

A correção seguinte, `20261016130000_maia_nucleus_safety.sql`, foi aplicada **depois** da `v1` e antes do código dependente em 16/10/2026. Ela troca a unicidade antiga de sessões/MCP por índices que tratam `client_id` nulo, permite arquivar várias sessões, adiciona retenção de mensagens de membros/grupos, aprovação atômica de skills, reserva de eventos de plano e subagentes, e impede replay de leases/resultados externos incertos. Não editar a `v1` aplicada. Para reverter o código, desligar flags e voltar o worker; ajustes de esquema exigem nova migration compensatória, sem apagar histórico.

A migration `20261016140000_maia_cache_usage.sql` adiciona colunas nullable para contadores `cache_read_input_tokens` e `cache_creation_input_tokens` retornados pelo Claude. A ausência do contador não é estimada. Foi aplicada depois das migrations do núcleo em 16/10/2026, antes do deploy que grava essas colunas.

Recibos de mensagens WhatsApp vivem em `outbound_receipts` (migration `20261015123609_outbound_message_receipts.sql`): ID, destinatário, estado e HMAC do texto (chave `EVOLUTION_API_KEY`), sem texto claro. A RPC `record_outbound_receipt` é exclusiva do servidor. `purge_outbound_receipts()` apaga apenas esses metadados após 30 dias, no ciclo de limpeza do worker. Aplicar a migration antes do código que grava/consulta recibos; depois habilitar `MESSAGES_UPDATE` no webhook Evolution, atualizar/reiniciar o worker local e testar o ciclo de aceite → entrega/leitura. Detalhes e limites em [confiabilidade dos envios](confiabilidade-envio-whatsapp.md). A migration de regras `20261015124400_maia_rules_reliable_sends.sql` exige OK do owner antes de ir à produção e antes do merge do código dependente.

Se `supabase db push --dry-run` informar versões remotas não encontradas localmente, **pare**: não rode `db pull` ou `migration repair` por tentativa. Compare versões, nomes e efeitos do SQL no schema real somente por leitura; alinhe o ledger apenas com autorização explícita do owner e pelo workflow protegido. O workflow aceita `reconciliar_historico=true` somente para as quatro versões específicas já verificadas neste incidente; a opção padrão continua `false`.

| Comando | O que faz |
|---|---|
| `pnpm db:new nome_em_snake_case` | Cria `supabase/migrations/AAAAMMDDHHMMSS_nome.sql` com o cabeçalho padrão |
| `pnpm db:validate` | Aplica **todas** as migrações do zero num Postgres temporário (PGlite), confere tabelas, funções RPC, constraints, RLS e políticas essenciais, e confere que toda tabela/função usada pelo código existe nas migrações |
| `pnpm db:guard` | (PR) Falha se migração existente foi alterada/apagada, se há comando destrutivo sem marcação ou se faltou o CHANGELOG. Usa `BASE_REF` (padrão `origin/main`) |
| `pnpm db:drift` | Compara o Supabase **real** com o que as migrações produzem. Somente leitura. Grava `db-drift-report.md` |
| `pnpm test` | Inclui `tests/db/migrations.nodetest.ts` (executor nativo do Node: `pnpm test:db`) (reconstrução do zero, RPCs, RLS, constraints, drift) |

`db:drift` precisa de `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` (ou `SUPABASE_URL`) no ambiente. O token nunca é impresso.
No `.env` local o nome gravado hoje é `SUPABASE_ACCESS_TOKKEN` (com erro de digitação); o script aceita os dois nomes. Corrija quando puder.

## Painel colaborativo — aplicado em 16/10/2026

`20261016160000_maia_collaborative_operations.sql` cria equipes operacionais distintas dos grupos de acesso, papéis por escopo, contratos/projetos/entregáveis, workflow/auditoria, planos com baseline original preservada, capacidade e catálogo de métricas. `20261016161000_maia_rules_collaborative_panel.sql` versiona a regra aprovada pelo fluxo `rules:generate`. Ambas foram aplicadas por `supabase db push --linked` com autorização do proprietário em 16/10/2026, antes do merge. Drift posterior comparou 1697 objetos em cada lado sem divergência; 40 regras alinhadas ao catálogo. Evidências em [painel colaborativo](painel-colaborativo.md). Reversão do recurso é por rollback de código mantendo tabelas e histórico; não apagar dados por rollback.

## Fluxo de uma mudança no banco

`20261016180722_maia_department_workspace.sql` foi aplicada ao projeto Supabase `Agent Maia` em 16/10/2026, antes do merge do código dependente. O dry-run listou somente essa versão pendente e `supabase migration list --linked` confirmou igualdade local/remota. Adiciona `work_department_records`, autorização por escopo, gravação auditada e conversão idempotente em projeto; reutiliza carteira, tarefas e histórico existentes. `pnpm db:drift` não concluiu: a Management API respondeu HTTP 401, portanto a comparação de schema remoto segue pendente. Nenhuma migration aplicada foi editada. Rollback de código preserva registros e trilha; remoção exige nova migração e autorização. Detalhes em [integração do painel](integracao-painel-maia.md).

1. `pnpm db:new descricao_da_mudanca` e escreva o SQL (compatível com o código antigo).
2. Escreva o código que usa a estrutura nova e o teste.
3. `pnpm typecheck && pnpm db:validate && pnpm test`. Atualize o `CHANGELOG.md`.
4. Abra o PR (o modelo tem o checklist). A CI roda `typecheck`, `db:validate`, `db:guard` e `test`.
5. **Peça a aprovação do owner** para aplicar em produção. Aplique com o workflow *Aplicar migrações (produção)*
   (primeiro simulação, depois aplicação) ou `supabase db push`. Confirme com `pnpm db:drift`.
6. Só então faça o merge. Um merge antes da migração quebra a Maia em produção.

## Migrações históricas e a baseline

As 18 migrações aplicadas até 09/10/2026 estão em `supabase/migrations/` com a **mesma versão e o mesmo SQL** que o
histórico do Supabase (`supabase_migrations.schema_migrations`). Por isso `supabase db push` as reconhece como já
aplicadas e não reaplica nada. Não houve `db reset` nem reaplicação em produção.

## Detecção de divergência (drift)

O workflow *Schema drift* roda todo dia e sob demanda. Ele constrói o esquema esperado a partir das migrações e compara
com o Supabase real (tabelas, colunas, constraints, índices, funções e privilégios, gatilhos, políticas, RLS, extensão `vector`).
Se alguém alterar algo à mão, o job falha e o relatório lista os objetos divergentes. **Nunca corrige a produção sozinho.**
A correção é uma nova migração (ou reverter a alteração manual, com aprovação do owner).

## O que o banco temporário assume da plataforma

`supabase/ci/bootstrap.sql` recria só o que a plataforma Supabase entrega antes das migrações: papéis `anon`,
`authenticated`, `service_role`, esquemas `auth` e `extensions`, `auth.uid()`, `auth.users`, privilégios padrão de `public`
e a função `public.rls_auto_enable()`. Esse arquivo é só para testes. Se uma migração passar a depender de outra coisa da
plataforma, acrescente aqui (e explique no PR).

## Fora do banco (também versionado)

- Edge Function `embed`: `supabase/functions/embed/index.ts` (vetores gte-small de 384 dimensões). Implantação: `supabase functions deploy embed`.
- Configuração do Auth (e-mail, senha, tela de login) **não** está versionada: fica no painel do Supabase.
# Migração de administração de acessos

`20261016150000_maia_member_access_modes.sql` foi aplicada depois das migrações do núcleo, em 16/10/2026, antes de iniciar código novo. Cria modos individuais, trilha de auditoria e a função transacional `set_maia_member_access_mode`; amplia os estados de aprovação com `consumed`. A existência das tabelas, da função e da RLS foi conferida no remoto; o comportamento com dados reais requer validação operacional depois do deploy. Reversão operacional: voltar o código anterior, manter tabelas e auditoria para preservar evidências; qualquer remoção de esquema exige migração posterior e backup.

Exceção histórica do guard: essa versão já aplicada substitui a constraint `approvals_status_check` usando `DROP CONSTRAINT IF EXISTS`, mas foi aplicada sem a marca textual de ação destrutiva. Como uma migração aplicada é imutável, `scripts/db/guard.ts` aceita somente o SHA-256 exato desse arquivo, autorizado pelo owner em 16/10/2026. Qualquer byte diferente ou futura migração destrutiva continua exigindo a marca e aprovação próprias.
