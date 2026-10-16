# Painel colaborativo da Maia

Estado em 16/10/2026: implementação concluída, commit `eceac39` enviado no PR [#21](https://github.com/TrafegoWorki1/agent-maia/pull/21). As duas migrations foram aplicadas no Supabase do ambiente local com autorização do proprietário, antes do merge. Drift: 1697 objetos esperados e remotos, sem divergência. As 40 regras ativas correspondem ao catálogo `2026-10-16.1`. O worker exige atualização e reinício separado.

## Funcionalidades e uso

- Meu dia: prioridades, prazos próximos/atrasados, bloqueios, decisões e revisões atribuídas.
- Minha equipe e Coordenação: filtros por equipe/cliente/pessoa, quadro, lista, calendário mensal e carga semanal sobre os mesmos registros. O acesso de membro deriva de atribuição ou escopo explícito; associação à equipe não revela automaticamente o trabalho de outros clientes.
- Direção: carteira autorizada, indicadores, capacidade informada e administração de equipes/funções.
- Carteira: criação/edição revisada de contratos, projetos e entregáveis, com IDs reais e histórico. Projeto e contrato pertencem ao mesmo cliente; registros não são movidos entre clientes silenciosamente.
- Tarefa: objetivo, briefing, critérios de aceite, esforço em horas, vínculos, responsáveis, revisor, aprovador, evidências, comentários, artefatos HTTPS e dependências sem ciclos.
- Fluxo: iniciar, bloquear, retomar, encaminhar à revisão/aprovação, devolver por categoria, concluir com evidência e cancelar os próximos efeitos. Conclusão não pula revisão nem aprovação. Estado encerrado não admite novos efeitos.
- Planejamento: mensal/semanal/diário; edição de plano existente, seleção explícita de compromissos, motivo e revisão. Baseline semanal original é preservada mesmo após urgências ou remoção de um compromisso. Histórico guarda autoria, antes/depois e itens afetados.
- Capacidade: disponibilidade/ausências declaradas por pessoa/equipe/semana, em horas. Carga usa compromissos da mesma semana; esforço ou alocação ausentes impedem conclusão de sobrecarga.
- A ferramenta privada `trabalho_contexto` permite à Maia consultar cadastros autorizados, trabalho, prioridades, planos e capacidade. `tarefa_atualizar` verifica a competência específica de atualização, revisão, aprovação, redistribuição ou planejamento.

Exemplos no WhatsApp: “Liste meu trabalho e os compromissos da semana”, “Informe um bloqueio por espera do cliente na tarefa #42” e “Encaminhe a tarefa #42 à revisão”. Cada operação usa os IDs e a revisão lidos no banco. O proprietário é identificado pelo servidor, sem frase obrigatória. Ferramentas gerais de trabalho continuam bloqueadas em grupos de clientes para não misturar contextos; use o privado autorizado.

A criação de tarefas continua nas ferramentas da Maia. A criação manual não foi adicionada ao painel colaborativo. O editor legado não altera tarefas identificadas do novo fluxo.

## Componentes reaproveitados

`people`, `person_numbers`, login Supabase, `person_permissions`, modos individuais, grupos de acesso, `maia_clients`, `work_tasks`, execuções, política de aprovação, MCP compartilhado de Claude/Codex, navegação e componentes visuais existentes. Sem novo framework e sem catálogo HTTP paralelo.

## Matriz de autorização

| Papel e escopo | Leitura | Alteração | Revisão/aprovação | Planejamento/administração |
|---|---|---|---|---|
| Membro | Trabalho atribuído e contexto explicitamente autorizado | Próprio trabalho com competência concedida | Somente a atribuição/função e capacidade correspondentes | Não por associação à equipe |
| Coordenador | Equipe/projeto/cliente sob gestão | Trabalho sob coordenação | Exige competência correspondente | Planejar/redistribuir no escopo concedido |
| Responsável pelo cliente | Cliente/projetos atribuídos | Carteira com competência de planejamento explícita | Não recebe aprovação por causa do cargo | Não administra pessoas/permissões |
| Revisor | Trabalho encaminhado e autorizado | Decisão e motivo da revisão | Qualidade no escopo | Sem administração |
| Aprovador | Trabalho explicitamente abrangido | Decisão de qualidade/evidência | Não autoriza publicação externa | Sem administração |
| Financeiro | Somente observações de cliente/projeto financeiro atribuído | Sem editor financeiro nesta entrega | Sem autorização implícita de ação externa | Sem administração |
| Proprietário | Visão geral | Conforme políticas do recurso | Conforme políticas externas existentes | Equipes, funções e permissões |

Competências: `painel.ver`, `trabalho.ver`, `trabalho.atualizar`, `trabalho.revisar`, `trabalho.aprovar`, `trabalho.planejar`, `trabalho.redistribuir`, `tarefas.criar`, `indicadores.ver`, `financeiro.ver` e `operacao.administrar`. Função operacional não concede competência sozinha. Bloqueio individual vence herança; uma aprovação pontual não concede acesso permanente. A administração por linguagem natural pode conceder/bloquear acesso ao painel e administrar capacidades operacionais verificadas; entrada do painel e leituras financeiras/indicadores não usam OK pontual.

API autentica o login e relê a autorização; a versão de acesso limpa contexto/cache quando pessoa ou escopo mudam. Escritas usam revisão e revalidação na transação. RLS limita leituras diretas de tarefas/históricos e nega acesso direto às demais tabelas internas. Chaves privilegiadas permanecem no servidor.

## Catálogo de métricas

O catálogo persistido contém fórmula, população, período, fonte, unidade, meta e cobertura. As métricas implementadas abrem os registros usados no cálculo, incluindo populações com mais de mil tarefas:

| Código | Fórmula/população | Período/fonte | Unidade e cobertura |
|---|---|---|---|
| `individual.commitment_rate` | concluídas no prazo / concluídas com prazo atribuídas | Semana em America/Sao_Paulo; work_tasks | %; sem denominador = indisponível |
| `individual.open_wip` | execução/revisão/aprovação atribuídas | Agora; work_tasks | Itens do escopo autorizado |
| `team.throughput` | tarefas concluídas no período | Semana; work_tasks | Entregas |
| `team.cycle_time` | média de conclusão menos início | Semana; timestamps completos | Horas de calendário, não jornada |
| `team.predictability` | itens da baseline concluídos / baseline original | Semana; work_plan_baselines + tarefas | %; remoção posterior não apaga denominador |
| `creative.first_review` | aprovação na primeira revisão / itens criativos revisados | Semana; área criativa explícita + revisões | %; sem revisão/classificação = indisponível |
| `team.blocked_aging` | bloqueios com 48 horas ou mais | Agora; work_tasks | Itens com registros detalhados |
| `team.unplanned_after_baseline` | itens acrescentados à baseline | Semana; plano e itens persistidos | Itens |

O painel também separa tempo no estado em execução, espera de revisão/aprovação e espera por equipe, proprietário, cliente ou fonte externa. Não mede presença nem cria ranking por mensagens ou quantidade bruta de entregas.

## Fontes externas e dependências reais

O código contém catálogo e armazenamento de observações com origem, período, tentativa, sucesso, unidade e motivo de indisponibilidade. Não há fonte financeira, pipeline comercial ou mapeamento confiável de campanhas por cliente configurados nesta entrega. Por isso esses indicadores permanecem indisponíveis; ausência não vira zero. Os snapshots legados do owner não são redistribuídos a clientes por semelhança de nome.

Para disponibilizar cada fonte faltam conexão autorizada, IDs de conta/recurso e cliente/projeto, definição do resultado/denominador e coletor específico que use a integração existente. Nenhuma credencial ou fonte foi inventada; novos conectores e consumo pago não foram ativados para teste. Atualizar a tela não atualiza a fonte.

## Sincronização e concorrência

WhatsApp/ferramenta e painel escrevem pelo backend e pelo mesmo contrato transacional. O frontend recarrega após commit, usa polling autenticado a cada 30 segundos e reconcilia ao reconectar/voltar à aba. Resposta antiga não substitui leitura mais recente. Revogação limpa dados; formulários retêm a revisão capturada no início da edição para detectar conflito.

Calendário, quadro, lista e carga usam registros persistidos; formulários locais são apenas rascunhos de edição. Sem armazenamento operacional paralelo em localStorage.

## Evidências locais

Executados com serviços simulados e PGlite temporário, sem mensagens reais, publicações ou imagens:
- `pnpm rules:check`, `pnpm typecheck`, `pnpm test`: 552 testes Vitest e 67 testes de banco aprovados.
- `pnpm db:validate`: 49 migrations reconstruídas do zero; estruturas usadas conferidas.
- `pnpm db:guard`: duas migrations novas; nenhuma migration aplicada alterada.
- `pnpm build` e `git diff --check`: aprovados.
- Testes de UI: edição de baseline com lista vazia, revisão preservada, resposta antiga descartada, reconexão e limpeza após 403.
- Integração: WhatsApp → banco → painel e painel → banco → próxima consulta da Maia; isolamento de projetos/entregáveis, bloqueio individual, revogação e KPI com 1005 registros.
- SQL: concorrência, baseline imutável, urgência/remoção com motivo, revisão sem atalhos, dependências sem ciclo, redistribuição, artefatos e funções restritas.
- Simulação remota: somente as migrations abaixo. Advisor remoto de segurança no nível erro: sem ocorrências antes da aplicação.
- Aplicação remota: `supabase db push --linked --yes` aplicou as versões `20261016160000` e `20261016161000` com sucesso.
- Conferência posterior: `MAIA_DB_READ_VIA_CLI=1 pnpm db:drift` comparou 1697 objetos em cada lado, sem divergência; `pnpm rules:verify` confirmou 40 regras alinhadas à versão `2026-10-16.1`.

## Implantação, reversão e reinício

1. Revisar o PR e CI, incluindo regras, tipos, testes, migrations e build.
2. No projeto Supabase correspondente ao ambiente local, executar `supabase db push --linked --dry-run`; conferir as duas versões. A aplicação foi autorizada explicitamente pelo proprietário.
3. Aplicar `20261016160000_maia_collaborative_operations.sql` e `20261016161000_maia_rules_collaborative_panel.sql`, nesta ordem, com `supabase db push --linked`.
4. Conferir histórico, RLS/RPCs, `pnpm rules:verify` e `pnpm db:drift`. A alternativa `MAIA_DB_READ_VIA_CLI=1` usa a CLI já autenticada, confere o projeto vinculado e executa apenas consultas de leitura; fixa search_path da transação para evitar falso drift.
5. Fazer squash merge após checks aprovados; o fluxo existente publica frontend/API na Vercel. Conferir o deployment.
6. Atualizar o checkout usado pelo worker, encerrar a instância anterior e iniciar uma única instância com `pnpm start` ou `Iniciar Maia.bat`. Conferir o log de início. O merge não reinicia o processo local já aberto.
7. Conceder apenas as competências/funções desejadas aos cadastros reais. Validar com contas de homologação; não gerar atividades externas como teste automático.

Reversão: voltar o código/frontend/API/worker para a versão anterior e preservar tabelas, baselines, histórico e auditoria. Não executar DROP nem db reset. Mudança de esquema exige migration compensatória e aprovação. Qualquer ação externa já aceita permanece um fato; cancelar impede somente os próximos efeitos.
