## O que muda

<!-- Resumo curto. -->

## Banco de dados (Supabase)

- [ ] Esta mudança **não** altera estrutura do banco (tabela, coluna, índice, constraint, função, política, extensão).
- [ ] Esta mudança altera o banco e a migração está em `supabase/migrations/` **neste mesmo PR** (`pnpm db:new nome`).
- [ ] Nenhuma migração existente foi editada, renomeada ou apagada (migrações aplicadas são imutáveis).
- [ ] A migração é compatível com o código antigo (adicionar primeiro, remover depois).
- [ ] Comando destrutivo (drop, truncate, mudança de tipo)? Inclui `-- destrutivo-aprovado: <quem e por quê>` e a aprovação do owner está linkada aqui.
- [ ] A migração foi **aplicada em produção antes do merge**, com aprovação do owner (workflow "Aplicar migrações" ou `supabase db push`). Evidência: <!-- link / saída -->

## Evidências de validação

- [ ] `pnpm typecheck`
- [ ] `pnpm db:validate` (migrações aplicam do zero; código só usa o que elas criam)
- [ ] `pnpm test` (inclui testes de banco)
- [ ] `CHANGELOG.md` atualizado

<!-- Cole a saída resumida dos comandos acima. -->
