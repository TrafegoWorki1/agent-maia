# Auditoria do painel e do banco — Maia

Data: 20/10/2026, aproximadamente 17h de Brasília.
Ambiente publicado: https://agent-maia.vercel.app/.
Referência remota conferida: main em `2af93da`. As fontes de src/api/server da cópia local coincidem com a main; a cópia local contém alterações documentais já publicadas.
Escopo: análise das 32 telas, contratos de API, consultas autenticadas, esquema real, permissões de leitura e testes isolados. Nenhuma correção de código, migração, publicação ou escrita de negócio foi executada nesta auditoria.

## Conclusão

O painel tem uma base funcional de autenticação, leitura e trabalho compartilhado, mas não está totalmente funcional nem integralmente alinhado com o versionamento do banco. As APIs principais carregam; integrações, partes do financeiro/vendas, entrada de membros e reenvio de artes têm limitações ou falhas concretas.

Os testes automatizados aprovados não substituem homologação visual nem testes de salvamento em produção. O navegador integrado não disponibilizou nenhum navegador nesta sessão; por isso não foi possível clicar pelas 32 telas ou conferir o layout.

## Evidências que passaram

- Login do proprietário realizado com o ambiente local, sem registrar credenciais no relatório.
- HTTP 200 em `/api/collaboration?identity=1`, `/api/collaboration`, `/api/snapshot`, `/api/organization`, `/api/workspace` e `/api/nucleus`.
- A página inicial e o bundle publicado responderam. O hash do bundle principal corresponde ao build local conferido.
- Leituras diretas usadas por Acessos (pessoas, catálogo, modos individuais, membros/grupos/permissões herdadas) passaram usando o login do proprietário, sem usar service_role para essas leituras.
- Sem login, as cinco APIs de dados retornaram 401; POST anônimo em `/api/refresh` retornou 401.
- Comandos com ação inválida foram rejeitados antes de qualquer gravação de negócio nas quatro APIs de alteração. Núcleo devolve 503 para entrada inválida, em vez de distinguir erro de validação com 400.
- `pnpm exec vitest run --maxWorkers=2`: 721 testes em 100 arquivos aprovados.
- `pnpm test:db`: 77 testes em 16 suítes aprovados, incluindo transações, escopos, revisão, baseline, RLS e alterações cruzadas WhatsApp/painel em banco temporário.
- `pnpm build`: tipos e compilação aprovados.
- `pnpm rules:verify`: 46 regras alinhadas, catálogo `2026-10-20.6`.
- RLS habilitada nas 91 tabelas públicas do banco real. Isto não constitui revisão completa de cada política.
- 21 tarefas retornadas tanto pela Central como pelo workspace; nenhuma incompatibilidade encontrada entre os estados legados e os estados colaborativos verificados na consulta.

## Achados prioritários

### A1 — Evolution falha no ambiente publicado

**Confirmado por chamada real.** O snapshot hospedado retorna `Evolution respondeu HTTP 404` para estado da instância e lista de grupos. A consulta equivalente com a configuração local retorna HTTP 200 e estado `open`.

Impacto: o painel acusa falha na conexão e não carrega a lista ao vivo; o recebimento de webhooks continua tendo eventos recentes. Isso não comprova que o WhatsApp esteja desconectado.

Próxima ação: conferir URL, instância e chave da Evolution no ambiente Production da Vercel contra a configuração local válida, sem expor seus valores. Após ajuste, repetir os GETs.

Referências: `server/snapshot.ts:34`, `server/groups.ts:31`.

### A2 — Banco real tem estruturas fora das migrações da main

**Confirmado por comparação estrutural somente leitura.** `pnpm db:drift` aplicou 64 migrações em banco temporário e comparou 1.905 objetos esperados contra 1.993 reais. Encontrou 88 objetos adicionais no remoto; não relatou objetos esperados ausentes ou definições esperadas diferentes.

Entre as diferenças:
- tabelas `creative_assets` e `creative_asset_deliveries`;
- coluna `creative_job_items.asset_id`, índices, constraints e gatilho relacionados;
- função `validate_creative_asset_scope()`;
- política adicional em `creative_resend_idempotency`.

As duas tabelas adicionais estavam vazias na consulta. O histórico remoto termina em `20261020180000`, como as migrações disponíveis na main. A comparação não determina quem criou as estruturas nem se existe desenvolvimento concorrente ainda não enviado.

Impacto: recriar o banco pelas migrações não reproduz integralmente produção. A diferença é aditiva e não impediu as leituras atuais, mas o alinhamento integral não está comprovado.

Próxima ação: verificar a origem dessas estruturas e versionar sua definição em nova migração, preservando as já aplicadas. Relatório detalhado: [db-drift-report.md](../db-drift-report.md).

### A3 — Fontes externas sem atualização válida recente

**Confirmado em dados de produção.** Gmail, Meta e Sheets têm snapshots com erro de 09/10; Calendar conserva snapshot de sucesso também de 09/10, portanto desatualizado.

Impacto: dados de campanhas e informações dependentes dessas fontes não representam a situação atual. Disponibilidade das ferramentas da Maia e coleta do painel são fluxos diferentes.

**Evidência de código:** a chamada de `scheduleRefresh` está ligada ao servidor de desenvolvimento em `vite.config.ts:43`; o worker operacional não chama esse agendador. O botão de atualização é ocultado quando o build usa `VITE_MAIA_HOSTED=1`. A falha de coleta também pode preservar snapshots anteriores.

Próxima ação: corrigir a execução da coleta no processo operacional apropriado e validar as permissões dos conectores. Não foi disparada coleta por IA nesta análise.

Referências: `server/refreshJob.ts`, `src/features/connections/ConnectionsPage.tsx`.

### A4 — Reenvio de arte pelo painel hospedado não fecha o fluxo

**Código e reprodução em memória.** A interface oferece confirmação para item incerto. Mesmo com `confirmUncertain=true`, o executor interno rejeita um item cujo status seja `uncertain`. A reprodução retornou `state: blocked` sem usar produção ou enviar mensagens.

**Consulta real:** 10 itens criativos; oito têm caminhos absolutos do Windows; um está em falha e um incerto. O código de reenvio usa `existsSync(artifact_path)` no processo que atende a API. Na Vercel esse processo não acessa arquivos do computador do worker.

Impacto: o botão pode ser exibido e a confirmação aceita pela interface sem conseguir reenviar o arquivo no ambiente hospedado. O sucesso visual também é mantido em estado do componente, sem atualizar o estado do item criativo nesse executor.

Próxima ação: definir armazenamento acessível ao servidor ou enfileirar o envio ao worker e alinhar confirmação, estado persistido e idempotência antes de testar envio real.

Referências: `src/features/operacao/TarefasPage.tsx`, `server/workspaceApi.ts`, `server/creativeAssetResolver.ts:224`, `server/creativeAssetResolver.ts:287`, `server/creativeAssetResolver.ts:296`.

### A5 — Vendas e financeiro ainda não entregam módulos completos

**Código e banco real.**
- Vendas e comunidade exibe texto fixo dizendo que nenhuma planilha foi configurada. Não há leitura de uma planilha de vendas vinculada nem cálculo de totais nessa tela; apenas a contagem de planilhas no snapshot.
- Não há observações em `external_metric_observations`.
- O catálogo financeiro contém apenas `finance.received` e `finance.overdue`. A tela também espera `finance.expected`, `finance.costs` e `finance.expenses`, que não estão cadastradas.
- A API retornou 20 métricas gerais, das quais quatro disponíveis e 16 indisponíveis, com motivos explicitados.

Impacto: Receitas funciona como visualização das observações autorizadas quando existirem; Custos e despesas não tem métricas catalogadas para mostrar no estado atual. Isso não é resolvido apenas recarregando o painel.

Próxima ação: completar fontes, vínculo por escopo e catálogo financeiro; implementar o vínculo e a agregação de vendas, conforme o produto desejado.

Referências: `src/features/operacao/OperacaoPages.tsx:229`, `src/features/departments/FinanceWorkspace.tsx:7`.

### A6 — Cadastro de membro não habilita login do painel

**Confirmado no banco.** Há três pessoas ativas: o proprietário tem `auth_user_id`; os dois membros não têm. Um dos membros possui `painel.ver`, mas isso não substitui o vínculo de autenticação.

**Código:** o formulário Nova pessoa cria a pessoa e o número de WhatsApp; não envia convite, cria usuário Auth ou associa login. A API colaborativa exige a associação entre usuário autenticado e pessoa cadastrada.

Impacto: é possível cadastrar a pessoa e suas permissões operacionais sem que ela consiga entrar no painel. A validação com conta de membro não foi possível com os cadastros existentes.

Próxima ação: oferecer fluxo explícito de convite/vinculação de Auth e revalidar permissões com um membro de teste autorizado.

Referências: `src/features/people/PeoplePage.tsx`, `server/panelIdentity.ts:60`.

## Achados complementares e limites

- **Grupos:** sete cadastros foram lidos pela organização, embora o snapshot ao vivo esteja vazio por erro na Evolution. A tela mescla os cadastros, mas atribui `messages7d: 0` e última atividade nula aos grupos ausentes do snapshot. Isso perde a distinção entre dado não recuperado e ausência de atividade. O banco tem 217 mensagens recentes em quatro grupos; o cruzamento mostrou que nenhum deles está entre os sete cadastros atuais. Portanto esta auditoria não afirma que os sete grupos cadastrados tiveram 217 mensagens. Referências: `server/snapshot.ts:161`, `src/features/operacao/GruposPage.tsx:20`.
- **Núcleo local:** a tela chama `/api/nucleus`, mas `vite.config.ts` não monta esse endpoint no servidor de desenvolvimento. A versão hospedada respondeu HTTP 200; o fluxo local foi revisado no código, sem iniciar o servidor, pois a inicialização dispara rotinas com efeitos.
- **Núcleo/histórico:** o GET é funcional. Criar rotina, ativar skill, delegar ou iniciar sessão não foi executado em produção. O botão “Nova conversa no painel” cria sessão, não reintroduz a tela de chat desativada.
- **Carteira vazia:** nenhuma equipe operacional, cliente, projeto, contrato, entregável, oportunidade/combinado, plano de trabalho ou capacidade está cadastrado no escopo global consultado. As telas vazias desses módulos coincidem com o banco. A ausência de cadastros limita a demonstração prática de planejamento e financeiro.
- **Regras:** catálogo e banco são iguais, mas permanecem iguais também no trecho antigo que fala em “repositório fixo”; sua revisão semântica segue pendente conforme TODO.
- **Verificação visual:** indisponível nesta sessão. Não foram certificados aparência, navegação por clique, acessibilidade e todos os formulários no navegador.
- **Escritas reais:** foram enviados somente comandos deliberadamente inválidos para verificar validação. CRUD de produção, convites, pagamentos, publicações, mensagens e reenvios não foram executados.

## Cobertura das 32 telas

“Leitura OK” significa API/consulta e contrato conferidos; não significa homologação de todos os cliques e salvamentos em produção.

| Área e telas | Resultado da análise |
|---|---|
| Central: Meu dia, Minha equipe, Coordenação, Direção, Planejamento, Métricas (6) | Leitura OK; 21 tarefas; cadastros de equipe/planejamento vazios; parte dos indicadores depende de fontes inexistentes. |
| Saúde: Resumo técnico, Indicadores da IA (2) | Snapshot e cálculos retornam; saúde geral fica afetada pela consulta da Evolution e fontes antigas. |
| Marketing: Trabalho e calendário (1) | Leitura compartilhada OK; resultados externos ausentes. |
| Marketing: Fonte Meta (1) | Snapshot Meta com erro; dados não atuais. |
| Marketing: Vendas e comunidade (1) | Orientação fixa; integração de vendas incompleta. |
| Marketing: Conversas e insights, Tom de voz (2) | Estatísticas descritivas retornadas; Tom de voz não é análise de conteúdo por IA. |
| Operação: Filas, entregas e eficácia (1) | Leitura OK: 21 tarefas, 11 lembretes, quatro memórias, 50 recibos recentes, três trabalhos criativos; reenvio tem falhas A4. Não há avaliações humanas registradas na amostra retornada. |
| Operação: Ocorrências (1) | Leitura OK; 25 ocorrências retornadas na consulta. |
| Comercial: Oportunidades, Funil (2) | API/contratos OK; sem registros comerciais no banco. |
| Projetos: Projetos, Implementações (2) | API/contratos OK; sem carteira e entregáveis cadastrados. |
| Clientes/CS: Acompanhamento, Cadastro (2) | APIs OK; sem clientes e combinados cadastrados. |
| Clientes/CS: Grupos WhatsApp (1) | Cadastro de sete grupos disponível; consulta ao vivo falha. |
| Financeiro: Receitas, Custos e despesas (2) | Visualizadores implementados, fontes ausentes e catálogo incompleto (A5). |
| Acessos: Acessos, Grupos de acesso (2) | Leituras e RLS do proprietário passaram; login dos membros pendente, zero grupos de acesso. |
| Agente: Regras, Memória (2) | 46 regras alinhadas, quatro memórias lidas. |
| Agente: Núcleo e automações (1) | GET hospedado OK: uma sessão, nove skills, cinco planos internos; execução das ações não homologada. |
| Agente: Continuidade (1) | Manual estático implementado; não é fonte dinâmica do banco. |
| Sistema: Conexões e fontes (1) | Carrega e informa erros; Evolution em 404 e fontes antigas (A1/A3). |
| Sistema: Executor e roteamento (1) | Leitura OK; contadores por três modelos, dois provedores e histórico de fallback retornados. |

## Ordem recomendada de correção

1. Alinhar a configuração da Evolution na Vercel e revalidar conexões e grupos.
2. Recuperar a coleta das fontes do painel no processo operacional.
3. Reconciliar as estruturas criativas extras com migrações versionadas e fechar o fluxo de reenvio.
4. Implementar convite/vinculação de login para os membros.
5. Completar o catálogo e as integrações de vendas/financeiro.
6. Homologar no navegador os formulários, as alterações e os perfis de acesso com dados de teste apropriados.

O relatório é uma fotografia do estado observado; não apresenta essas correções como executadas.
