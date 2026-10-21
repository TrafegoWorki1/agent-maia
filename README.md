# Agent · Maia

## Contas sociais

Instagram e LinkedIn identificados no painel e nas ferramentas pertencem a **Herickson Maia**, conforme correção do proprietário em 20/10/2026. A integração usa Zernio; a seleção de conta por ID e as aprovações permanecem as existentes.

## GitHub e sites — estado confirmado em 20/10/2026

Repositórios novos são privados por padrão; criar público exige OK do owner. As ferramentas de site aceitam repositório público ou privado informado no pedido. O commit no GitHub exige OK; a publicação na Vercel envia o HTML pela API e não configura deploy automático por git push. Membros dependem de `site.publicar` e continuam sem as ferramentas genéricas `github_*`.

A migração `20261020180000` está aplicada e a implementação/documentação estão na `main` pelo merge `7767b3d`, com publicação Vercel concluída. Ainda faltam atualizar os workers e validar o fluxo com repositório e Vercel reais. A conferência encontrou dois workers anteriores ao commit; o deploy web não atualiza esses processos.

Detalhes e limites: [histórico da conferência](CHANGELOG.md), [migrações](docs/database-migrations.md) e [pendências](TODO.md).


## Segurança por recurso e retenção

O limite geral de execução fica em `config/ai-routing.json`. Acesso de membros ao Google Drive exige a capacidade base `sheets.ler` e uma autorização vigente para arquivo, pasta, cliente ou projeto; buscas globais e ferramentas não mapeadas são bloqueadas. Compartilhamentos só podem ser confirmados pelo fluxo gerenciado que persiste e confere o `permissionId`.

A retenção operacional fica em `config/data-retention.json`. Mensagens brutas do owner têm janela padrão de 90 dias; memória durável, auditoria e recibos não são removidos junto com esse conteúdo. Veja `docs/MAIA_IMPLEMENTACAO_REGRAS_VIBECODING.md` para implantação e reversão.

Painel e assistente operacional da Worki Digital. A Maia atende pedidos pelo WhatsApp, usa ferramentas com permissões por pessoa e registra execução, aprovação e resultado. O painel apresenta pessoas, conexões, tarefas, indicadores e ocorrências reais.

## Funcionamento

A Maia interpreta cada mensagem como parte do diálogo autorizado: “produza as artes, vou enviar o roteiro” seguido do roteiro não exige repetir “crie”. O executor acompanha complementos, correções e cancelamentos. A classificação por palavras orienta a rota, não autoriza nem recusa a fila criativa. Essa capacidade é restrita ao proprietário no WhatsApp privado; publicações seguem aprovação no backend. A conversa recente do mesmo canal tem prioridade no orçamento de contexto. Testes offline verificam esse contrato e os bloqueios; não comprovam a qualidade semântica de respostas de modelos reais.

Evolution recebe mensagens e chama `api/webhook.ts` na Vercel. A rota valida o evento e grava na fila do Supabase. O worker local processa essa fila, chama o executor de IA e entrega a resposta pelo WhatsApp. O painel usa login vinculado ao cadastro real, autorização por escopo no backend e RLS.

O registro de recibos distingue aceite pela Evolution de entrega/leitura; o painel de tarefas mostra os status recebidos. Reenvios de texto idêntico ao mesmo destino em até 24 h exigem OK do owner. Para ativar callbacks, configure `MESSAGES_UPDATE` na Evolution e atualize/reinicie o worker local conforme [confiabilidade dos envios WhatsApp](docs/confiabilidade-envio-whatsapp.md); instalar apenas a Vercel não atualiza o worker local.

Claude é o executor principal, rodando pelo Claude Code CLI (`claude -p`); Codex pode assumir pela contingência configurada. Os dois recebem o mesmo construtor de prompt e passam pelos controles do servidor. Disponibilidade de um conector depende do executor e da conexão atual.

## Painel gerencial

Complementação publicada pelo [PR #34](https://github.com/TrafegoWorki1/agent-maia/pull/34), merge b0bc9fe. Conferência em produção de 20/10/2026 às 23:15 (Brasília): página/gráficos e APIs novas disponíveis, acesso anônimo recusado. Fontes reais e homologação visual continuam com os critérios abertos no plano.

A gestão oferece cartões de KPI, rosca para composição, colunas para comparações, barras empilhadas por área, linhas de evolução e cronograma de entregáveis. Os setores compartilham filtros e os registros autorizados. Há análises de entregas semanais, idade do trabalho, devoluções, encerramentos comerciais, retornos de CS e operação técnica. Financeiro e campanhas permitem comparações explícitas entre fontes compatíveis, incluindo fluxo/margem de caixa, custo por resultado e ROAS; a ausência de fonte ou denominador mantém o resultado indisponível.

O painel lê `/api/panel-collaboration` com histórico por período e busca paginada do histórico de uma tarefa ao abrir seu detalhe. `/api/collaboration` continua atendendo as ações e a leitura completa das ferramentas da Maia. `/api/panel-operations` fornece as séries técnicas exclusivas do proprietário. Esta complementação não exige migração nem reinício do worker.

A implementação e os contratos de indicadores/fontes estão em [painel gerencial](docs/painel-gerencial.md). A versão anterior está preservada em [backup do painel](docs/backup-painel-anterior.md). Fontes reais de vendas, campanhas e financeiro precisam ser configuradas em Administração → Fontes gerenciais. O coletor independente inicia com pnpm panel:collect; não altera o worker da Maia.

## Organização do painel

O menu tem nove áreas. O proprietário entra em Gestão, com Panorama, indicadores e detalhamento; Meu trabalho concentra a execução pessoal. Projetos, Marketing, Comercial e Clientes/CS oferecem visões dos mesmos registros autorizados. Saúde da Maia e Operação da Maia mantêm diagnósticos técnicos exclusivos do proprietário; Financeiro depende da competência e do escopo financeiro. Cadastros globais, acessos, regras e integrações continuam administrativos. Links antigos são preservados; membros não recebem acesso às páginas administrativas por terem acesso à área operacional.

Projetos/Implementações consultam a carteira da Central; Marketing filtra tarefas e calendário; Comercial e CS usam registros internos persistidos com próxima ação, revisão e histórico. As ferramentas `area_registro_salvar` e `oportunidade_converter` são compartilhadas por Claude/Codex, revalidam acesso no banco e não ativam CRM externo. Criação permanece pelo WhatsApp; o painel altera registros existentes. Migração `20261016180722_maia_department_workspace.sql` aplicada ao Supabase e código integrado pelo PR #23 (`5c504d4`); o reinício do worker é separado. Detalhes, matriz e limites em [integração do painel](docs/integracao-painel-maia.md).

A evolução visual dos indicadores organiza cartões por área em até quatro colunas, com população detalhada e indisponibilidade explícita. Meu dia, equipe e coordenação mostram recortes clicáveis; planejamento e capacidade usam barras com denominador válido; projetos exibem contagem de entregáveis concluídos; Comercial oferece colunas reais do funil e Marketing/Projetos, quadro de produção. A taxa de ganho preserva o denominador quando uma etapa do funil é filtrada. Os componentes reutilizam a API e o banco existentes, sem nova migration ou coletor. Esta evolução visual está implementada localmente; publicação é uma etapa separada.

Em Clientes e CS, o proprietário administra clientes e grupos reais do WhatsApp; o acompanhamento operacional segue o escopo da pessoa. Em Equipe e acessos, grupos de permissão compartilham concessões. Eles são distintos das equipes operacionais de planejamento e responsabilidade. Grupos de acesso vinculados a clientes limitam concessões ao cliente correspondente; uma associação operacional não concede administração. Aprovação de ações continua individual. Novos grupos são cadastrados com atendimento pausado, salvo ativação explícita.

O contexto dos grupos de clientes não recebe o histórico privado do proprietário nem conversas de outros grupos. Ferramentas que consultam dados gerais da operação ficam bloqueadas nesse contexto. As permissões são conferidas novamente antes de executar ferramentas, após aprovação e antes de cada parte da resposta, inclusive na retomada da fila. Ao mudar o cliente ou os acessos de um grupo, pedidos anteriores precisam ser refeitos. Documentos de clientes continuam fora da busca do projeto.

No contexto privado do owner, o agente combina conversa recente, histórico persistente autorizado além de 24 horas, resumos e memórias ativas de `owner_memories`, sob orçamento de contexto por executor. A Maia pode buscar e registrar compromissos explícitos; o owner também pode revisar, concluir ou arquivar registros em **Agente Maia > Memória e combinados**. Memória é contexto, não prova de execução nem autorização. A tabela é acessível somente pelo backend e a rota do painel valida a sessão do owner. Consulte [o plano de memória sincronizada](docs/plano-memoria-sincronizada.md) e o [procedimento de migrações](docs/database-migrations.md) antes do rollout.

A evolução local do núcleo acrescenta sessões persistentes por canal, conversa, solicitante e cliente, inclusive para membros autorizados (`conversa.maia`). A recuperação e a busca revalidam o acesso, separadas da memória declarativa. As migrations foram aplicadas ao Supabase do projeto em 16/10/2026; o código publicado e o worker atualizado são necessários para o owner buscar suas sessões em **Agente Maia > Núcleo**. Essa tela não expõe conversas privadas de membros. A gravação do histórico de membros/grupos segue retenção de 7 dias. Skills, rotinas e subagentes são funcionalidades configuráveis, inicialmente desativadas; veja [estado e implantação do núcleo](docs/evolucao-nucleo-maia.md). A aplicação das migrations não ativa essas opções nem reinicia o worker.

O painel **Modelos e Roteamento** também pode mostrar tokens de cache lidos/criados quando o Claude os devolve. Campos ausentes ficam vazios; valores não são inferidos e isso não garante economia.

As estruturas estão nas migrações `20261011185724_maia_client_groups_access.sql` e `20261012014613_maia_response_deliveries_requester.sql`. O histórico remoto foi consultado para reconciliar a primeira; a coluna de entrega pertence somente à segunda. O painel informa quando falta estrutura e impede salvar nesses casos.

Painel colaborativo: veja [documentação de escopos, métricas, evidências e rollout](docs/painel-colaborativo.md). Inclui Meu dia, equipe, coordenação, direção, carteira editável, tarefas com revisão/dependências, calendário, planejamento com baseline imutável e capacidade semanal. A aplicação versionada do banco e o merge foram autorizados pelo proprietário; o estado remoto é registrado no documento. Atualizar/reiniciar o worker é uma etapa separada. Fontes externas sem conexão/mapeamento ficam indisponíveis.

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
pnpm db:guard
pnpm build
```

Para mudar regras: editar catálogo, incrementar versão, gerar documento com `pnpm rules:generate` e preparar a migração de dados. A ativação autorizada deve ser conferida com `pnpm rules:verify`. `pnpm knowledge:sync` atualiza a busca somente quando documento, catálogo e regras ativas correspondem.

Os testes de banco usam PGlite temporário. `pnpm db:guard` compara commits e alterações locais com `origin/main`, incluindo arquivos novos. `pnpm db:drift` consulta o esquema real e grava um relatório local, sem corrigir produção. Com a CLI autenticada no mesmo projeto, `MAIA_DB_READ_VIA_CLI=1` permite a leitura sem copiar tokens para o ambiente.

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
# Administração de acessos pelo WhatsApp

O proprietário autenticado pelo número do servidor pode pedir à Maia para localizar um membro existente, consultar suas capacidades e definir uma capacidade como `permitido`, `bloqueado` ou `aprovacao`. A Maia usa o ID da pessoa cadastrada; nomes ambíguos exigem escolha. Bloqueios individuais prevalecem sobre concessões de equipes. O painel de Pessoas relê os modos salvos no banco. A alteração vale para o acesso **via Maia**; não remove compartilhamentos diretos no Google Drive. A função depende da migração `20261016150000_maia_member_access_modes.sql` e de implantação posterior; não está ativa só por existir no repositório.

A ferramenta recusa capacidades do catálogo que ainda não têm política de execução comprovada. Entrada (`painel.ver`, `conversa.maia`), decisão de aprovar (`escrita.aprovar`) e leitura de indicadores/financeiro não admitem OK pontual: use concessão ou bloqueio explícitos. Nos novos registros de Comercial/CS e na conversão em projeto, a competência deve estar vigente; OK pontual não substitui o escopo nem cria concessão permanente.
