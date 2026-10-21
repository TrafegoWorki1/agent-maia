# Painel gerencial da Maia

Implementação autorizada em 20/10/2026. Nove áreas, 34 telas (32 existentes e duas novas: Panorama e Fontes gerenciais). O proprietário entra em Gestão; os demais perfis continuam entrando nas telas previamente autorizadas. As rotas antigas continuam válidas, incluindo parâmetros de tarefa e projeto.

## Referência e preservação

Código anterior: `2af93da47a52cf2e642d0379ff2c9676cc274d5f`, branch `backup/painel-antes-gestao-20261020` e tag `painel-antes-gestao-20261020`, enviadas ao GitHub antes das alterações. Consulte [backup e restauração](backup-painel-anterior.md).

As alterações não editam regras, prompts, modelos, roteamento, ferramentas, permissões/approvals, estados ou efeitos de tarefas/lembretes. A API compartilhada de colaboração mantém as consultas e retornos do servidor. Os cálculos gerenciais derivam dos registros já autorizados; as fontes novas usam tabelas e endpoint próprios, exclusivos do proprietário. Membros mantêm o financeiro e os indicadores existentes sob o mesmo escopo.

## Contrato dos indicadores

Timezone: America/Sao_Paulo. A leitura de colaboração é atualizada a cada 30 segundos; os cálculos usam seu generatedAt. Cada cartão/gráfico de tarefas abre os IDs usados no cálculo, com as mesmas ações autorizadas do detalhe existente. O filtro de período afeta compromissos/conclusões/esforço; atrasos, bloqueios e decisões representam o estado atual, inclusive quando o período é passado.

| Código | Pergunta / cálculo | Unidade e cobertura |
|---|---|---|
| commitments | Quantas tarefas vencem no período? Prazo original da baseline semanal quando disponível; demais usam prazo atual | Entregas; cancelamentos identificados; cobertura de baseline explícita |
| on_time | Concluídas até o prazo original dividido pelos compromissos já vencidos e mensuráveis do período | Percentual; exclui canceladas e concluídas sem timestamp; denominador ausente aparece indisponível |
| overdue | Tarefas abertas com prazo atual anterior à leitura | Itens; fotografia atual |
| blocked | Tarefas no estado blocked | Itens; fotografia atual, motivos/esperas registrados |
| capacity | Disponibilidade menos ausência nas semanas que intersectam o período | Horas semanais inteiras, sem rateio; indisponível ao filtrar cliente/projeto/área; ausência de cadastro não é zero |
| decisions | Revisões e aprovações pendentes | Itens; fotografia atual; não autoriza publicar |
| cycle | Conclusão menos início das concluídas no período | Mediana, amostra explícita; P85 calculável a partir de sete registros |
| load | Esforço informado das tarefas abertas com prazo no período versus disponibilidade semanal | Horas; estimativas e disponibilidade ausentes identificadas |

Quando uma tarefa figura em mais de uma baseline semanal sobreposta, usa-se a primeira baseline por created_at. Sem baseline não é possível recuperar o prazo original de um trabalho reagendado. Não se reconstrói o estado passado usando o status atual.

## Fontes de vendas, campanhas e financeiro

Administração → Fontes gerenciais permite cadastrar/editar/pausar uma planilha Google Sheets e executar uma coleta de leitura. Cada fonte informa métrica, unidade/moeda, regime/objetivo/atribuição, cobertura, cliente/projeto por ID, intervalo e colunas de identificador/data/valor. Criar o cadastro não cria planilhas nem envia mensagens.

A primeira linha é o cabeçalho. Limite: 5.000 registros, 52 colunas e 20 fontes. Valores devem ser números nativos, datas aceitam células de data, AAAA-MM-DD ou DD/MM/AAAA. ID duplicado, cabeçalho ambíguo ou linha inválida recusa o lote inteiro. Contagens são inteiras e não negativas. Valores monetários podem conter estornos negativos.

A reserva no banco impede duas coletas simultâneas da mesma fonte. Finalizar a mesma coleta novamente não altera o resultado. Cada tentativa registra revisão, configuração, horários, estado, erro e lote; falha preserva o sucesso anterior. A consulta usa somente o último sucesso da revisão atual, evitando somar lotes sucessivos. Revisões antigas permanecem no histórico e não alimentam a configuração nova.

A listagem retorna somente metadados. Os registros são carregados para uma fonte selecionada por vez, até 5.000 itens, com detalhamento em páginas de 100 registros, evitando baixar todas as planilhas para montar o seletor.

Não há total geral entre fontes: intervalos sobrepostos e duas fontes que descrevem o mesmo fato não são somados implicitamente. A chave única impede cadastro repetido de provedor/planilha/intervalo/métrica. Não há inferência de equivalência por nome.

Movimentos financeiros e resultados de campanha são somados por data no período. Saldo vencido usa a última fotografia diária disponível dentro do período; não acumula saldos de dias diferentes. Moedas e regimes permanecem separados. Margem, ROAS e custo por resultado com objetivos distintos não são inferidos. Fontes reais ainda precisam ser escolhidas/configuradas pelo proprietário.

As fontes adicionadas são exclusivas do proprietário. O financeiro existente de membros continua lendo external_metric_observations com o mesmo papel/escopo; esta entrega não amplia o acesso às fontes novas.

## Coleta e saúde

`pnpm panel:collect` inicia um processo próprio, a cada 30 minutos, sem depender de pnpm dev e sem chamar a IA. O processo não altera nem reinicia o worker do WhatsApp. O launcher scripts/start-panel-collector.ps1 abre o coletor oculto e evita iniciar outra instância já ativa. A tarefa Windows Maia-Painel-Coletor inicia no login do usuário; depende deste computador ligado e conectado. Logs locais em logs/panel-collector.*.log. Para pausar somente a coleta, desabilite essa tarefa e encerre apenas o PID correspondente, sem tocar no inboxWorker. O diretório isolado maia-gerencial deve ser mantido enquanto for o destino da tarefa. No desenvolvimento, o painel também agenda a mesma coleta de leitura. As fontes configuradas têm lease no banco; a coleta de metadados de saúde é idempotente por fonte.

O botão Conexões → Atualizar fontes coleta metadados Google e diagnóstico Meta e aguarda o resultado, autenticado e exclusivo do proprietário. Fontes gerenciais individuais têm botão Coletar. Atualizar leitura apenas lê o banco.

Google Drive fornece nomes/datas das cinco planilhas recentes; Calendar fornece nomes dos calendários; Gmail consulta até 100 IDs por busca, sem ler corpo ou assunto. O OAuth configurado pode não possuir os escopos Gmail/Calendar: nesse caso a falha fica visível. O painel não usa os conectores da conta Claude para improvisar uma coleta. Meta direto não está conectado: campanhas podem usar uma fonte Sheets explícita. A consulta geral Meta anterior continua disponível na mesma tela, em um bloco próprio, preservando os dados antigos com o diagnóstico de desatualização. Não se promove a integração a saudável por estar cadastrada.

Última tentativa e último sucesso ficam separados. Após 60 minutos, a fonte requer atenção. Os snapshots antigos não têm data de sucesso recuperável após erro. O histórico da primeira coleta nova passa a informar essa data sem inventar dados anteriores.

## Grupos

Lista combinada da Evolution, cadastros maia_groups e atividade registrada; a falha externa não apaga cadastros/atividade. O contador group_activity é acumulado, não uma série diária. A tela exibe “Mensagens registradas (acumulado)” nos grupos com atividade recente; sem registro aparece desconhecido. A coluna legada messages7d fica nula; nenhum número acumulado é apresentado como volume de sete dias. Não altera o monitoramento da IA.

## Banco e restauração

- 20261020231500: reconcilia de forma idempotente creative_assets, creative_asset_deliveries, vínculo em creative_job_items, constraints/índices/gatilho/função e política já existentes no Supabase. A definição esperada foi comparada com a real antes de aplicar.
- 20261020231552: adiciona panel_data_sources, panel_source_runs, panel_source_health e RPCs internas de reserva/conclusão. RLS habilitada, acesso direto público e authenticated revogado, execução somente service_role.
- Bootstrap de teste reproduz auth.role(), função que a plataforma já fornece. Não é uma migração de produção.
- Código antigo permanece compatível com as adições. Reversão é por código/deployment anterior; não apagar tabelas ou histórico nem executar reset.

## Verificação

TypeScript, build, 742 testes da aplicação e 81 testes de Postgres temporário passaram. A suíte cobre aliases/parâmetros, perfis/escopos, baselines, fuso, ausência de denominador, capacidade desconhecida, detalhes com os mesmos IDs, fontes duplicadas, lease/replay, falhas, revisões e RLS.

O navegador integrado está indisponível nesta sessão (nenhuma instância vinculada). Testes de componentes em DOM simulado não substituem a inspeção visual desktop/celular. Fontes de negócio reais ainda aguardam indicação/configuração; nenhum envio, publicação ou gasto de IA foi usado para testar.

Banco aplicado antes do código dependente: 66 migrações e comparação de 2.064 objetos locais/remotos sem divergência. Regras 2026-10-20.6, 46 entradas e checksum 1bcf561b784a0f53211f7af748c9a0a83787e66f8361de94cfebe8e6f36fa0ba preservados. Seis APIs existentes e a API panel-sources responderam 200 autenticadas e 401 anônimas usando o banco real. Publicado em https://agent-maia.vercel.app pelo PR #31, merge 8a0f1c98dd67a4f6f6da2bda0eebc97da5a7a750, deployment dpl_FFN4sBRDr4sBsmPwMNiNkUMnXnUq. Página/assets 200 com nova navegação; seis APIs de dados 200 autenticadas e 401 anônimas; comandos inválidos em colaboração/fontes retornam 400. WhatsApp confirmou open sem erro. A lista externa de grupos atingiu timeout na conferência; 12 grupos permaneceram visíveis pelo fallback de cadastros/atividade, sem confirmar uma lista externa completa.

## Matriz de telas, APIs, fonte e acesso

| Área / tela | API | Fonte | Acesso |
|---|---|---|---|
| Gestão / Panorama da operação | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Proprietário; Pessoas preserva o acesso individual |
| Gestão / Coordenação | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Gestão / Direção e equipes | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Gestão / Planejamento | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Gestão / Indicadores | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Meu trabalho / Meu dia | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Meu trabalho / Minha equipe | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Comercial / Oportunidades | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Comercial / Funil | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Comercial / Resultados de vendas | panel-sources | panel_data_sources / panel_source_runs | Proprietário; Pessoas preserva o acesso individual |
| Projetos e entregas / Projetos | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Projetos e entregas / Entregáveis e implementações | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Marketing / Produção e calendário | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Marketing / Resultados de campanhas | panel-sources | panel_data_sources / panel_source_runs | Proprietário; Pessoas preserva o acesso individual |
| Clientes e CS / Combinados e retornos | collaboration | work_tasks/carteira/planos/capacidade e registros no escopo | Tela e escopo atuais da colaboração |
| Clientes e CS / Grupos do WhatsApp | snapshot; organization | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Financeiro / Receitas e previsões | collaboration; panel-sources | work_tasks/carteira/planos/capacidade e registros no escopo | Financeiro existente no escopo; fontes novas só owner |
| Financeiro / Custos e despesas | collaboration; panel-sources | work_tasks/carteira/planos/capacidade e registros no escopo | Financeiro existente no escopo; fontes novas só owner |
| Operação da Maia / Saúde da operação | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Qualidade da IA | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Filas e entregas | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Ocorrências | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Execução e custos | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Estatísticas de conversa | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Operação da Maia / Estilo das mensagens | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Pessoas e acessos | workspace; organization | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Grupos de acesso | organization | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Cadastro de clientes | organization | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Conexões e fontes | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Fontes gerenciais | panel-sources | panel_data_sources / panel_source_runs | Proprietário; Pessoas preserva o acesso individual |
| Administração / Regras da Maia | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Memória e combinados | snapshot | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Núcleo e automações | nucleus | consultas existentes do módulo | Proprietário; Pessoas preserva o acesso individual |
| Administração / Continuidade e backup | documento local | manual do operador | Proprietário; Pessoas preserva o acesso individual |
