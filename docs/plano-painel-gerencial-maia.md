# Plano de evolução do painel gerencial da Maia

Data: 20/10/2026.
Estado: primeira entrega implementada e publicada pelo PR #31 (8a0f1c9). Banco aplicado e sem drift. Fontes de negócio reais, escopos OAuth ausentes e inspeção visual seguem pendentes, conforme o registro de execução ao final. Contratos e matriz final em [painel gerencial](painel-gerencial.md). Backup da referência anterior preservado antes da implementação.
Base: [auditoria do painel e do banco](auditoria-painel-banco-2026-10-20.md).
Objetivo: permitir ao gerente entender compromissos, capacidade, riscos e resultados por setor, cliente e projeto, preservando o comportamento operacional da Maia.

## 1. Resultado esperado

O painel permitirá partir da operação consolidada, localizar uma exceção e abrir os registros que a explicam. O mesmo registro de tarefa alimentará a agenda pessoal, a equipe, o setor e o projeto.

Cada visão oferecerá período, filtros autorizados, data da leitura, origem dos dados e acesso aos registros do cálculo. Fonte desatualizada, população vazia e métrica não implementada terão estados distintos.

A navegação proposta tem nove áreas. A quantidade final de telas será definida no inventário de rotas; a redução de setores não pressupõe apagar funcionalidades existentes.

## 2. Requisito obrigatório: preservar o comportamento da IA

- Preservar o catálogo operacional em config/maia-rules.json, o documento gerado docs/regras-da-maia.md e o conteúdo ativo de maia_rules.
- Preservar prompts, modelos, roteamento, ferramentas, políticas de autorização e aprovações, critérios de conclusão, estados e efeitos das tarefas, prazos e lembretes.
- Preservar os contratos das APIs e ferramentas consumidas por Claude/Codex. Consultas gerenciais novas terão uma camada própria do painel quando mudar uma consulta compartilhada puder alterar o contexto recebido pela Maia.
- Preservar permissões e escopos atuais. Um novo agrupamento de menu não concede acesso adicional. Planejamento, finanças e cadastros mantêm seus controles existentes.
- Preservar o histórico e a identidade de tarefas, pessoas, clientes e projetos.
- As consultas analíticas não executarão ferramentas da IA, contatos, publicações ou outras ações externas.

A mudança do painel altera o acesso visual às informações e os cálculos gerenciais. Qualquer proposta que exija alterar uma regra ou fluxo operacional da Maia será identificada como trabalho separado, fora deste plano.

As 46 regras e a versão 2026-10-20.6 são a referência observada na auditoria. Antes de implementar, registrar novamente versão e checksum da main e do banco; não restaurar uma versão antiga caso haja alterações concorrentes autorizadas.

## 3. Navegação proposta

| Nova área | Conteúdo principal | Origem atual / observação |
|---|---|---|
| Gestão | Panorama da operação, coordenação, planejamento, capacidade e indicadores consolidados | Direção, Coordenação, Planejamento e Métricas; cada visão respeita o acesso atual. |
| Meu trabalho | Meu dia, Minha equipe, pendências e aprovações atribuídas | Central de Trabalho, concentrada na execução cotidiana. |
| Comercial | Oportunidades, funil, próximas ações e resultados de vendas quando conectados | Comercial; a tela atual Vendas só muda de localização com seus mesmos controles de acesso. |
| Projetos e entregas | Carteira, implementações, marcos, entregáveis, tarefas e dependências | Projetos e recortes compartilhados da Central. |
| Marketing | Produção, revisão, calendário e resultados de campanhas | Produção e métricas de campanha em blocos próprios. |
| Clientes e CS | Combinados, retornos, pendências e grupos do WhatsApp | Acompanhamento e grupos; cadastro global fica em Administração. |
| Financeiro | Receitas, previsões, vencidos, custos e despesas | Módulo existente, com indicação explícita das fontes disponíveis. |
| Operação da Maia | Saúde, filas, entregas, qualidade, ocorrências, custos da IA e estatísticas de conversa | Saúde da Maia e Operação da Maia; insights de conversa não serão apresentados como resultado de marketing. |
| Administração | Pessoas, permissões, grupos de acesso, clientes, conexões, regras, memória, núcleo e manual | Acesso administrativo vigente; funcionalidades existentes preservadas. |

As rotas antigas serão mantidas como aliases. Links com parâmetros de tarefa ou projeto devem abrir o mesmo registro após a mudança. O teste de acesso deverá cobrir proprietário, membro, coordenação e financeiro com escopos diferentes; perfis usados em testes serão simulados ou de homologação.

## 4. Contrato de cada indicador

Antes de construir um gráfico, documentar código, pergunta gerencial, fórmula, população, unidade, período, timezone, fonte, atualização, cobertura, escopo de acesso, meta e detalhamento.

Regras de cálculo:
- Usar America/Sao_Paulo para datas gerenciais e armazenar instantes com fuso explícito.
- Distinguir valores acumulados no período de fotografias de estado atual.
- Manter a baseline e o prazo original dos compromissos. Mudanças de prazo, cancelamentos e entradas posteriores serão apresentados separadamente.
- Denominador ausente ou zero não vira taxa de 0%.
- Dados indisponíveis, desatualizados, incompletos e vazios serão identificados, com motivo.
- Comparações exigem períodos equivalentes e a mesma definição.
- Usar mediana e percentis para tempos quando houver amostra suficiente, exibindo o tamanho da amostra.
- Capacidade requer esforço e disponibilidade informados; quantidade de tarefas não será convertida em horas nem em ranking de produtividade.
- Fonte financeira exige moeda, regime de apuração, período e cobertura definidos. Receita da agência e receita de campanhas de clientes terão fontes e escopos próprios.
- ROAS só será exibido com receita atribuída, janela de atribuição e investimento compatíveis; margem depende de receita e custos completos.

### Primeira versão dos indicadores e gráficos

| Área | Indicadores | Visualização principal | Condição dos dados |
|---|---|---|---|
| Gestão | Compromissos da semana, pontualidade, atrasos, bloqueios, decisões pendentes | Planejado × entregue, atrasos por projeto e lista de exceções | Tarefas, prazos e histórico; série semanal completa exige baseline/histórico suficiente. |
| Meu trabalho | Prazos próximos, atrasos, itens bloqueados, revisões e aprovações atribuídas | Lista priorizada, calendário e quadro | Reutilizar as tarefas e autorizações atuais. |
| Equipe / planejamento | Trabalho em andamento, entregas por período, idade dos itens, tempo de execução, carga informada | Evolução semanal, itens envelhecidos e carga por pessoa/equipe | Início, conclusão, disponibilidade e esforço precisam estar preenchidos. |
| Comercial | Oportunidades abertas, taxa de ganho, próximas ações vencidas | Funil por etapa e ganhos/perdas no período | Usa work_department_records; conversão entre etapas e tempo por etapa exigem histórico próprio válido. |
| Projetos | Marcos no prazo, entregas atrasadas, bloqueios e devoluções em revisão | Cronograma, previsto × realizado e motivos de devolução | Projetos, entregáveis, critérios e histórico de revisão cadastrados. |
| Marketing — produção | Peças em produção/revisão, devoluções e calendário de compromissos | Quadro de produção e fila de revisão | Compartilha tarefas/entregáveis; prazo de trabalho não confirma publicação. |
| Marketing — resultados | Investimento e custo por resultado por objetivo; ROAS quando calculável | Evolução diária/semanal por conta/campanha | Conta, cliente, fonte, objetivo e atribuição validados. |
| Clientes e CS | Combinados abertos, retornos vencidos, esperas por cliente e tempo de resposta quando mensurado | Pendências por cliente e evolução dos retornos | Tempo de resposta exige eventos de atendimento; não inferir a partir de qualquer mensagem. |
| Financeiro | Recebido, previsto, vencido, custos/despesas e margem quando completa | Previsto × realizado e fluxo de caixa | Fonte financeira conectada; recebidos e saldo de vencidos não serão somados como fluxo. |
| Operação da Maia | Falhas, envios aceitos/entregues, espera por aprovação, custo por execução e atualização das fontes | Falhas no tempo, custos e saúde da coleta | Preservar distinção entre resposta da IA, aceite de envio, entrega, leitura e resolução do pedido. |

Referência de definições de fluxo: [Kanban Guide](https://kanbanguides.org/the-kanban-guide). As fórmulas específicas da agência serão documentadas no contrato dos indicadores.

## 5. Fases e critérios de aceite

### Fase 0 — Fixar a referência e organizar o trabalho

Entregas:
- Atualizar a leitura da main e registrar diferenças locais/concor­rentes antes de qualquer edição.
- Revalidar os problemas da auditoria, com consultas de leitura, e separar os que continuam ativos.
- Registrar checksum das regras e contratos das ferramentas antes das mudanças.
- Inventariar as 32 telas, seus endpoints, queries, campos e permissões.
- Trabalhar em branch/worktree isolada e preservar as alterações já abertas.

Aceite: matriz tela → API → fonte → permissão completa, com escopo de cada lote definido. Nenhum problema será declarado corrigido com base apenas no relatório anterior.

### Fase 1 — Confiabilidade dos dados e do ambiente

Entregas:
- Corrigir a consulta da Evolution no painel hospedado, após comparar o ambiente publicado com a configuração local válida.
- Recuperar a coleta dos dados do painel por execução de leitura apropriada. A coleta não dependerá apenas de pnpm dev nem chamará a IA para improvisar dados.
- Identificar a origem das estruturas criativas extras. Se ainda houver divergência, reconciliar por migração versionada aditiva, respeitando desenvolvimento concorrente.
- Mostrar última tentativa, último sucesso, erro, cobertura e data dos dados como informações distintas.
- Corrigir a leitura de atividade dos grupos para sobreviver à indisponibilidade da lista externa e evitar substituir dado desconhecido por zero.

Aceite: erros e idade dos dados são visíveis; consultas de leitura passam; nenhuma divergência de schema permanece sem explicação e tratamento versionado antes de adicionar estruturas dependentes.

Dependência: corrigir a Evolution e a ingestão do painel pode exigir configuração de ambiente e um processo de coleta. Isso não muda regras, prompts ou ferramentas da Maia. Se houver necessidade de mudar comportamento do worker, separar a decisão antes de executar.

### Fase 2 — Modelo de leitura e indicadores

Entregas:
- Mapear os dados existentes em work_tasks, work_task_history, work_task_reviews, work_plans, work_plan_baselines, work_capacity, work_department_records, metric_catalog e external_metric_observations.
- Calcular os indicadores iniciais que os registros permitem, preservando os campos/retornos usados pela Maia.
- Criar consultas/endpoints gerenciais próprios onde o agrupamento compartilhado puder mudar o contexto da IA.
- Adicionar histórico de observações ou estruturas analíticas somente quando faltar dado para cálculo auditável; não duplicar o cadastro operacional.
- Aplicar filtros de acesso antes de agregar, com totais e detalhamentos sobre a mesma população.
- Definir paginação/detalhamento e evitar a leitura integral de todo o histórico em cada atualização de gráfico.

Aceite: cada número reproduzível por consulta, cobertura explicitada, amostras controladas e testes de fuso, denominadores, baseline, filtros e acesso entre clientes.

### Fase 3 — Navegação e componentes do painel

Entregas:
- Implementar as nove áreas propostas, com redirecionamento das rotas antigas.
- Criar componentes comuns para cartões, gráficos, filtros, estados de atualização/erro e detalhamento.
- Preservar os formulários existentes e o registro único compartilhado.
- Oferecer acesso pelo teclado, alternativas textuais/tabelas para os gráficos e layout responsivo.

Aceite: toda rota antiga chega à tela/registro correspondente; cada perfil enxerga apenas o que já está autorizado a consultar; versões desktop e celular verificadas no navegador.

### Fase 4 — Primeira entrega gerencial

Entregas:
- Panorama em Gestão com seis indicadores: compromissos da semana, pontualidade, atrasos, bloqueios, capacidade informada e decisões pendentes.
- Gráficos de planejado × entregue, atrasos por projeto e carga por equipe, liberados conforme cobertura disponível.
- Lista de exceções com motivo observado, pessoa responsável, cliente/projeto e próxima ação.
- Meu trabalho com hoje/semana, bloqueios, revisões e aprovações atribuídas.
- Filtros por período, setor, cliente, projeto, equipe e pessoa, conforme escopo permitido.

Aceite: o gerente abre um indicador e encontra os registros do cálculo; alterações pelo fluxo existente aparecem nas visões que compartilham esses registros; a tela distingue ausência de cadastro, ausência de fonte e ausência de acesso.

### Fase 5 — Visões dos setores

Entregas:
- Comercial: funil e retornos, preservando criação e conversão existentes.
- Projetos: marcos, entregáveis, revisão e bloqueios.
- Marketing: produção e resultados em blocos distintos.
- Clientes/CS: próximos contatos e combinados, com identificação do que depende do cliente.
- Operação da Maia: saúde, execuções, entregas e custo com os fatos já disponíveis.

Aceite: todos os setores usam os mesmos IDs e recortes autorizados; não há cadastros paralelos de tarefa; gráficos e tabelas levam à mesma população.

A carteira vazia observada na auditoria exige cadastrar a estrutura real para uso. Durante o desenvolvimento serão usados dados sintéticos em homologação; clientes, equipes e valores reais serão informados pelo proprietário, sem associação por semelhança de nome.

### Fase 6 — Fontes de vendas, campanhas e financeiro

Entregas:
- Definir e conectar a fonte de vendas; remover a orientação fixa como substituto de integração.
- Completar os códigos e fontes de previsto, recebido, vencido, custos e despesas.
- Persistir observações com referência do registro original para evitar contagem duplicada em reprocessamentos.
- Vincular contas e resultados ao cliente/projeto por identificadores.
- Definir política de atualização e indicação de dado antigo por fonte.

Aceite: amostra reconciliada com a origem; mesma moeda/período/atribuição; totais reproduzíveis e sem dupla contagem. Receita prevista não é contabilizada como recebida. Recursos sem fonte permanecem claramente indisponíveis.

Dependência: fontes, credenciais e definições contábeis/comerciais precisam estar disponíveis. Não assumir integração nova já autorizada ou contratar serviço com base apenas neste plano.

### Fase 7 — Homologação e implantação em lotes

Entregas:
- Executar verificações de tipos, testes relevantes, build e checks exigidos pelo repositório.
- Para mudanças de banco: db:validate, db:guard, simulação de aplicação e verificação de drift.
- Conferir versão/checksum das regras e contratos antes/depois. Alteração inesperada bloqueia a entrega para revisão.
- Homologar no navegador com proprietário e perfis autorizados: leitura, filtros, detalhamento, criação/edição existentes, revisão, planejamento e revogação.
- Publicar em lotes pequenos; aplicar migrações autorizadas antes do código dependente e manter rollback compatível com o schema aditivo.
- Atualizar README, TODO, CHANGELOG e docs/erros-e-mudancas com evidências e pendências reais.
- Verificar dados, erros, tempo de resposta e comportamento do painel após publicação.

Aceite final:
- Navegação e telas homologadas, com dados correspondentes às consultas.
- Todos os KPIs com definição, origem, data e detalhamento.
- Ausência de ampliação de acesso e de alteração de regras ou ferramentas da IA.
- Schema versionado alinhado ao remoto.
- Nenhuma publicação, mensagem ou alteração de dados de negócio usada como teste automático.
- Pendências de fontes externas visíveis e com responsável, sem declarar completude onde a fonte não existe.

## 6. Backlog separado: problemas existentes que não serão mascarados pelo redesign

- Reenvio de arte: confirmação de estado incerto, arquivo no disco do worker, idempotência e estado persistido. Exige correção própria do fluxo; não ampliar automaticamente a possibilidade de reenvio como parte do painel.
- Login de membros: criar convite/vinculação de Auth com as permissões vigentes, sem conceder capacidades pelo simples cadastro de pessoa.
- Rotas locais do Núcleo e classificação de erros 400/503: corrigir com testes específicos, preservando ações existentes.
- Trecho antigo “repositório fixo” na regra operacional: fora deste plano; corrigir em trabalho separado de regras.
- Workers antigos/duplicados: avaliar trabalhos ativos e realizar manutenção operacional própria antes de reiniciar.

Esses problemas influenciam a homologação de “todo o painel”. Não serão contabilizados como corrigidos apenas porque o menu ou o gráfico foi redesenhado.

## 7. Ordem das entregas

| Lote | Escopo | Liberação |
|---|---|---|
| A — Base confiável | Fases 0 e 1 | Fontes e schema observados, problemas de dados identificados ou corrigidos. |
| B — Painel gerencial inicial | Fases 2 a 4 | Gestão e Meu trabalho sobre dados confiáveis, com navegação compatível. |
| C — Setores | Fase 5 | Visões operacionais por setor, sem duplicar registros. |
| D — Resultados externos | Fase 6 | Métricas liberadas fonte a fonte após reconciliação. |
| Transversal | Fase 7 | Homologação e documentação em cada lote, não somente no final. |

O primeiro marco utilizável é o lote B. Financeiro e resultados externos têm dependências próprias e não precisam impedir a primeira visão de tarefas e compromissos.

## 8. Estimativa e decisões de implementação

As fases representam ordem e critérios de conclusão, não prazo fechado. A estimativa deve ser feita depois da Fase 0, considerando volume real, origem das estruturas fora do histórico, disponibilidade dos conectores e condições de homologação.

Decisões de implementação sugeridas:
- Gestão como entrada do proprietário; Meu trabalho como entrada de membros já autorizados.
- Preservar políticas existentes ao mover Coordenação, Planejamento e Financeiro.
- Usar os componentes e padrões atuais; escolher biblioteca de gráficos somente se os recursos existentes forem insuficientes.
- Metas comerciais e limites de alerta devem vir da operação; não adotar percentuais arbitrários.
- Priorizar visualização de compromissos e exceções antes de indicadores financeiros sem fonte.


## Registro de execução - primeira entrega publicada

- Backup remoto anterior no commit 2af93da, branch e tag painel-antes-gestao-20261020; patch e ZIP locais preservados.
- Fases 0, 2 e 4: referência, leitura gerencial e Panorama implementados.
- Fase 1: Evolution corrigida, migrações reconciliadas e coletor independente ativo; faltam escopos Gmail/Agenda e conexão Meta direta. Fallback protege a lista de grupos durante timeout externo.
- Fase 3: nove áreas, 34 telas, aliases, filtros, gráficos e alternativas tabulares implementados; inspeção visual desktop/celular aguarda navegador disponível.
- Fase 5: recortes e gráficos de trabalho usam os registros existentes; indicadores que dependem de fonte/atribuição sem cadastro permanecem indisponíveis.
- Fase 6: conector Sheets e histórico/configuração/validação/lease prontos; escolha e conferência de planilhas reais aguardam o proprietário.
- Fase 7: 742 testes da aplicação, 81 de banco, typecheck, build, db:validate, db:guard e CI aprovados. Drift 2.064/2.064 e 46 regras com checksum preservado. APIs de produção verificadas; sem teste visual ou de negócio com fonte real.
- Publicação: https://agent-maia.vercel.app, merge 8a0f1c9, sem reiniciar/alterar o worker operacional.

Detalhes reproduzíveis e matriz de telas: [painel gerencial](painel-gerencial.md).
