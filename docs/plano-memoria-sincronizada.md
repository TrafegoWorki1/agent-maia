# Plano: memória sincronizada da Maia

## Objetivo

Evitar que a Maia deixe de considerar uma conversa recente ou um combinado que ela própria registrou. O painel e o agente devem consultar e atualizar a mesma fonte no Supabase, sem expor essas informações a membros, grupos ou outros clientes.

## Implementação

1. **Recuperação do histórico (backend):** aumentar a busca de mensagens recentes e selecionar contexto por janela temporal e orçamento máximo de caracteres, em vez de depender de apenas 14 falas. Preservar ordem cronológica e filtrar a mensagem atual.
2. **Memória durável (Supabase):** adicionar uma tabela versionada para combinados, fatos de continuidade e preferências explicitamente registradas, com status, prazo opcional, origem/tarefa, revisão e RLS habilitado sem acesso direto de `anon`/`authenticated`.
3. **Agente (Claude/Codex):** carregar memória ativa junto ao contexto privado do owner; fornecer ferramentas de busca e gravação somente no contexto de owner. A Maia deve registrar apenas compromissos claros, pendências e preferências solicitadas, não inferências ou segredos.
4. **Painel:** adicionar tela “Memória e combinados”, conectada ao mesmo endpoint autenticado do painel, para consultar, registrar, editar, concluir ou arquivar itens. Exibir estado de sincronização/erros e revisão concorrente.
5. **Validação:** testes para recorte com muitas mensagens, orçamento de contexto, ferramentas/validação, RLS e migração. Executar typecheck, build, validação de banco e testes completos.
6. **Documentação:** atualizar README, contrato de migrações e changelog com limites, privacidade, rollout e procedimento de produção.

## Rollout seguro

- A migração `20261015005000_maia_owner_memory.sql` foi aplicada em produção após aprovação do owner. Workflow `38664184391` concluiu a aplicação e o `db:drift`; a tabela e o RLS foram conferidos por leitura.
- O ledger tinha quatro versões remotas com timestamps distintos dos quatro arquivos locais homônimos. Após confirmar os efeitos no schema e o hash da regra, a reconciliação autorizada foi executada pelo workflow `38664093265`; o dry-run subsequente listou somente a migration de memória.
- O código de agente e painel está no PR #14, com CI e preview aprovados. Integrar o PR para publicar o código somente depois da migration — essa ordem já foi cumprida — e realizar smoke test do agente privado e da tela do painel.
- Em caso de falha de leitura da memória durável, o agente deve continuar usando o histórico recente e o painel deve mostrar erro, sem apagar ou sobrescrever dados.

## Critérios de aceite

- Mensagens dentro da janela definida não desaparecem só por excederem 14 linhas; o tamanho total continua limitado.
- Combinados ativos aparecem no contexto privado do owner, independentemente do limite de mensagens recentes.
- Gravação exige informação explícita e mantém origem e estado; não há exclusão física pela interface.
- O painel lista e atualiza os mesmos registros do backend; conflitos de revisão não sobrescrevem silenciosamente.
- Usuários sem papel de owner não recebem as memórias pelo agente nem pelo endpoint do painel.
- Migrações são reproduzíveis em banco temporário; verificações e testes passam.
- A solução evita cortes no contexto e preserva combinados novos, mas não recria mensagens antigas que já tenham sido removidas de `messages` ou `inbox`.
