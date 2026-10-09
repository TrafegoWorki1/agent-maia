# Migrações do banco (Supabase)

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

| Comando | O que faz |
|---|---|
| `pnpm db:new nome_em_snake_case` | Cria `supabase/migrations/AAAAMMDDHHMMSS_nome.sql` com o cabeçalho padrão |
| `pnpm db:validate` | Aplica **todas** as migrações do zero num Postgres temporário (PGlite), confere tabelas, funções RPC, constraints, RLS e políticas essenciais, e confere que toda tabela/função usada pelo código existe nas migrações |
| `pnpm db:guard` | (PR) Falha se migração existente foi alterada/apagada, se há comando destrutivo sem marcação ou se faltou o CHANGELOG. Usa `BASE_REF` (padrão `origin/main`) |
| `pnpm db:drift` | Compara o Supabase **real** com o que as migrações produzem. Somente leitura. Grava `db-drift-report.md` |
| `pnpm test` | Inclui `tests/db.migrations.test.ts` (reconstrução do zero, RPCs, RLS, constraints, drift) |

`db:drift` precisa de `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` (ou `SUPABASE_URL`) no ambiente. O token nunca é impresso.
No `.env` local o nome gravado hoje é `SUPABASE_ACCESS_TOKKEN` (com erro de digitação); o script aceita os dois nomes. Corrija quando puder.

## Fluxo de uma mudança no banco

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
