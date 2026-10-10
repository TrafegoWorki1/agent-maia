# OperaFlow · Maia

Painel e assistente operacional da Worki Digital. A Maia atende pedidos pelo WhatsApp, usa ferramentas com permissões por pessoa e registra execução, aprovação e resultado. O painel apresenta pessoas, conexões, tarefas, indicadores e ocorrências reais.

## Funcionamento

Evolution recebe mensagens e chama `api/webhook.ts` na Vercel. A rota valida o evento e grava na fila do Supabase. O worker local processa essa fila, chama o executor de IA e entrega a resposta pelo WhatsApp. O painel publicado usa autenticação do proprietário e RLS.

Claude é o executor principal; Codex pode assumir pela contingência configurada. Os dois recebem o mesmo construtor de prompt e passam pelos controles do servidor. Disponibilidade de um conector depende do executor e da conexão atual.

## Execução

Requisitos: Node.js compatível com execução dos arquivos TypeScript do projeto e pnpm 11.25.0. As dependências e o launcher devem usar as versões instaladas e testadas no ambiente.

```powershell
pnpm install
pnpm start
```

`pnpm start` e `Iniciar Maia.bat` iniciam o worker pelo launcher atual. O painel é o publicado na Vercel. Sem o worker ativo, mensagens ficam na fila e tarefas periódicas aguardam seu retorno.

Para desenvolver o painel local: `pnpm dev`, em `http://127.0.0.1:3000`. Para executar somente o worker, sem launcher: `pnpm worker`. Não iniciar duas cópias da operação para conferir uma mudança.

`pnpm start:legacy` mantém o fluxo antigo com webhook local e túnel; ele não oferece a mesma cobertura do caminho Vercel/fila para grupos. Não usá-lo como substituto automático da operação atual.

O ambiente do servidor contém as credenciais de Supabase, Evolution, Whisper e Zernio quando configurados. Mantenha-as no ambiente privado; não cole segredos no repositório, painel ou chat. A autenticação local dos executores de IA é independente da autenticação do painel.

## Documentação e regras

- [Regras vigentes](docs/regras-da-maia.md): comportamento aprovado, gerado do catálogo.
- `config/maia-rules.json`: origem versionada das regras e da reserva do prompt.
- [Instruções de desenvolvimento](CLAUDE.md): arquitetura, limites e fluxo de alteração.
- [Pendências atuais](TODO.md): o que ainda falta verificar ou implementar.
- [Migrações](docs/database-migrations.md): contrato de mudanças no banco.
- [Changelog](CHANGELOG.md) e [resumo de erros e melhorias](docs/erros-e-mudancas.md): registros históricos.
- `plan.md` e planos identificados como históricos documentam etapas anteriores; não definem permissões atuais.

O banco `maia_rules` contém a versão ativada. Editar Markdown não altera o agente automaticamente. O painel de regras é somente leitura. A busca operacional indexa apenas as regras vigentes; histórico e planos não são fontes de autorização.

## Qualidade e atualização

```powershell
pnpm rules:check
pnpm typecheck
pnpm test
pnpm db:validate
pnpm build
```

Para mudar regras: editar catálogo, incrementar versão, gerar documento com `pnpm rules:generate` e preparar a migração de dados. A ativação autorizada deve ser conferida com `pnpm rules:verify`. `pnpm knowledge:sync` atualiza a busca somente quando documento, catálogo e regras ativas correspondem.

Os testes de banco usam PGlite temporário. `pnpm db:guard` compara commits com `origin/main`; executar também depois do commit para incluir as mudanças novas. `pnpm db:drift` consulta o esquema real e grava um relatório local, sem corrigir produção.

## Estrutura principal

- `src/`: painel React.
- `api/`: rotas publicadas e entrada do webhook.
- `server/inboxWorker.ts`: fila e trabalhos periódicos.
- `server/access.ts` e `server/approvalPolicy.ts`: autorização.
- `server/rules.ts` e `server/ruleCatalog.ts`: prompt e contrato documental.
- `server/knowledge.ts` e `server/knowledgeSync.ts`: busca e indexação.
- `server/ai/`: roteamento, executores e contingência.
- `supabase/migrations/`: evolução versionada do banco.
- `tests/`: comportamento, interface e banco temporário.

A interface não substitui as permissões do servidor. Aprovações valem para uma ação, e resultados incertos não são repetidos automaticamente.
