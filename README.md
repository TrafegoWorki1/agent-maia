# Agent · Maia

Painel e assistente operacional da Worki Digital. A Maia atende pedidos pelo WhatsApp, usa ferramentas com permissões por pessoa e registra execução, aprovação e resultado. O painel apresenta pessoas, conexões, tarefas, indicadores e ocorrências reais.

## Funcionamento

Evolution recebe mensagens e chama `api/webhook.ts` na Vercel. A rota valida o evento e grava na fila do Supabase. O worker local processa essa fila, chama o executor de IA e entrega a resposta pelo WhatsApp. O painel publicado usa autenticação do proprietário e RLS.

O registro de recibos distingue aceite pela Evolution de entrega/leitura; o painel de tarefas mostra os status recebidos. Reenvios de texto idêntico ao mesmo destino em até 24 h exigem OK do owner. Para ativar callbacks, configure `MESSAGES_UPDATE` na Evolution e atualize/reinicie o worker local conforme [confiabilidade dos envios WhatsApp](docs/confiabilidade-envio-whatsapp.md); instalar apenas a Vercel não atualiza o worker local.

Claude é o executor principal, rodando pelo Claude Code CLI (`claude -p`); Codex pode assumir pela contingência configurada. Os dois recebem o mesmo construtor de prompt e passam pelos controles do servidor. Disponibilidade de um conector depende do executor e da conexão atual.

## Organização do painel

O menu reúne as telas em sete áreas: Visão geral; Marketing; Execução; Grupos e clientes; Equipe e acessos; Agente Maia; Sistema e integrações. As páginas de cada área aparecem em abas. Links antigos continuam funcionando. O cabeçalho usa a identidade do login e o proprietário tem acesso ao painel operacional também na versão publicada.

Em Grupos e clientes, cadastre o cliente e associe os grupos reais do WhatsApp. Em Equipe e acessos, crie equipes com membros e permissões compartilhadas. Grupos de acesso vinculados a clientes concedem permissões somente nos grupos desse cliente; equipes internas somam permissões em toda a operação. Aprovação de ações continua individual. Novos grupos são cadastrados com atendimento pausado, salvo ativação explícita.

O contexto dos grupos de clientes não recebe o histórico privado do proprietário nem conversas de outros grupos. Ferramentas que consultam dados gerais da operação ficam bloqueadas nesse contexto. As permissões são conferidas novamente antes de executar ferramentas, após aprovação e antes de cada parte da resposta, inclusive na retomada da fila. Ao mudar o cliente ou os acessos de um grupo, pedidos anteriores precisam ser refeitos. Documentos de clientes continuam fora da busca do projeto.

No contexto privado do owner, o agente inclui até 48 falas recentes dentro de 24 horas, limitado por orçamento de caracteres, e as memórias ativas de `owner_memories`. A Maia pode buscar e registrar compromissos explícitos; o owner também pode revisar, concluir ou arquivar registros em **Agente Maia > Memória e combinados**. Memória é contexto, não prova de execução nem autorização. A tabela é acessível somente pelo backend e a rota do painel valida a sessão do owner. Consulte [o plano de memória sincronizada](docs/plano-memoria-sincronizada.md) e o [procedimento de migrações](docs/database-migrations.md) antes do rollout.

As estruturas estão nas migrações `20261011185724_maia_client_groups_access.sql` e `20261012014613_maia_response_deliveries_requester.sql`. O histórico remoto foi consultado para reconciliar a primeira; a coluna de entrega pertence somente à segunda. O painel informa quando falta estrutura e impede salvar nesses casos.

## Execução

Requisitos: Node.js compatível com execução dos arquivos TypeScript do projeto e pnpm 11.25.0. As dependências e o launcher devem usar as versões instaladas e testadas no ambiente.

```powershell
pnpm install
pnpm start
```

`pnpm start` e `Iniciar Maia.bat` iniciam o worker pelo launcher atual. O painel é o publicado na Vercel. Sem o worker ativo, mensagens ficam na fila e tarefas periódicas aguardam seu retorno.

Para desenvolver o painel local: `pnpm dev`, em `http://127.0.0.1:3000`. Para executar somente o worker, sem launcher: `pnpm worker`. Não iniciar duas cópias da operação para conferir uma mudança.

`pnpm start:legacy` mantém o fluxo antigo com webhook local e túnel; ele não oferece a mesma cobertura do caminho Vercel/fila para grupos. Não usá-lo como substituto automático da operação atual.

### Executor do Claude (Claude Code CLI)

O Claude roda pelo `claude -p` (Claude Code), com as ferramentas da Maia e as aprovações do servidor acessadas por um MCP local só em 127.0.0.1. Requisitos: `claude` instalado e logado na conta (ou `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` no ambiente do worker). Conferir com `pnpm smoke:claude-cli` e `pnpm smoke:claude-simple` (gastam centavos) e `pnpm smoke:maia-tools` (offline). A atualização do painel (Gmail, Meta, Sheets, Agenda) usa o mesmo executor.

| Variável (opcional) | Uso |
| --- | --- |
| `MAIA_CLAUDE_EXECUTOR` | `cli` (padrão) ou `sdk` para voltar ao Agent SDK sem mudar código; vale mais que a config |
| `MAIA_CLAUDE_BIN` | caminho do `claude` quando não está no PATH (VPS) |
| `MAIA_CLAUDE_WORKDIR` | pasta de trabalho do CLI (padrão: a do worker) |
| `MAIA_CLAUDE_ADD_DIRS` | repositórios extras de leitura, só para o owner (`:` no Linux, `;` no Windows) |

O CLI nasce restrito: sem Bash/PowerShell, Edit, Write, web nem servidores MCP do computador; segredos (`.env`, `.git`, `.ssh`) não são lidos. Se o CLI não existir, a chamada cai no SDK antes de qualquer ação. O padrão também está em `providers.claude.executor` de `config/ai-routing.json`.

O ambiente do servidor contém as credenciais de Supabase, Evolution, Whisper e Zernio quando configurados. Mantenha-as no ambiente privado; não cole segredos no repositório, painel ou chat. A autenticação local dos executores de IA é independente da autenticação do painel.

## Documentação e regras

- [Regras vigentes](docs/regras-da-maia.md): comportamento aprovado, gerado do catálogo.
- [Preferências permanentes do owner](docs/owner-preferences.md): proposta, confirmação explícita e limites do que pode mudar.
- `config/maia-rules.json`: origem versionada das regras e da reserva do prompt.
- [Instruções de desenvolvimento](CLAUDE.md): arquitetura, limites e fluxo de alteração.
- [Pendências atuais](TODO.md): o que ainda falta verificar ou implementar.
- [Migrações](docs/database-migrations.md): contrato de mudanças no banco.
- [Changelog](CHANGELOG.md) e [resumo de erros e melhorias](docs/erros-e-mudancas.md): registros históricos.
- [Evolução do núcleo](docs/evolucao-nucleo-maia.md): sessões, contexto, skills, planos, subagentes, rotinas e extensibilidade segura.
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
- `server/sessions.ts`, `server/skills.ts`, `server/subagents.ts` e `server/scheduler.ts`: contratos do núcleo persistente; a ativação operacional depende da migration e da configuração autorizada.
- `skills/`: procedimentos Markdown versionados; propostas precisam de aprovação antes de se tornarem ativas.
- `supabase/migrations/`: evolução versionada do banco.
- `tests/`: comportamento, interface e banco temporário.

A interface não substitui as permissões do servidor. Aprovações valem para uma ação, e resultados incertos não são repetidos automaticamente.
