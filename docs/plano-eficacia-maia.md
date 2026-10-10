# Plano de relevância e eficácia da Maia

Data: 10/10/2026. Objetivo: entregar o resultado pedido com dados reais, prova de execução e comunicação clara, inclusive durante a contingência do Claude para o Codex.

## Diagnóstico observado

Consulta ao Supabase em 10/10/2026 às 00:35 de Brasília, usando o mesmo `buildScorecard` que alimenta o painel. Semana ISO `2026-W41`, de 05/10 a 12/10 em UTC; a consulta só contém registros existentes até o momento observado. A inspeção visual ficou pendente porque o navegador desta sessão falhou na inicialização.

| Dimensão | Nota pelo cálculo anterior | Evidência |
|---|---:|---|
| Nota operacional | 3,00/10 | Teto ativado por dois falsos incidentes |
| Velocidade | 9,71/10 | 34 de 35 pedidos operacionais respondidos em até 120 segundos |
| Precisão e conferência | 3,33/10 | 3 ações conferidas de 9; 6 sem prova registrada |
| Proatividade | 10,00/10 | 4 avisos com confirmação registrada; não significa leitura pelo destinatário |
| Gestão de risco | 5,00/10 | Uma aprovação decidida e uma expirada; penalizava expiração respeitada |
| Confiabilidade técnica | 8,95/10 | 85 execuções de conversa sem erro de 95 |
| Comunicação | 9,72/10 | 35 respostas de 36 pedidos classificados como operacionais |

O histórico tem 106 registros: 95 concluídos, 9 com falha e 2 incertos. Falhas de cumprimentos e conversas simples ficavam fora da amostra operacional. Também havia ferramentas usadas pelo Codex em registros ainda classificados como conversa.

Os incidentes das tarefas #47 e #48 eram tentativas de publicação no Instagram. A primeira esperou uma aprovação que expirou; a segunda foi bloqueada por existir outra aprovação pendente. Nenhuma delas tem evento `external_done`. Usar `tool_use` como prova de publicação produzia um teto crítico indevido.

A tarefa #101, “Me trás a organização operacional”, tem consulta à base interna e falha `Evolution sendText falhou: HTTP 400`. Há também uma falha de envio anterior com HTTP 502. A causa específica do HTTP 400 não foi registrada e permanece em investigação: não atribuir a tamanho da resposta, desconexão ou formato sem evidência.

## Critério de relevância

Um pedido recebe quatro avaliações distintas:

1. **Relevância:** a resposta trata do pedido atual e usa o contexto correto.
2. **Resolução:** entrega o resultado pedido, uma parte útil com pendência explícita, ou explica o bloqueio concreto.
3. **Conferência:** apresenta prova ligada à ação executada, quando há efeito externo.
4. **Entrega:** a resposta foi aceita pelo canal; aceitação não equivale à leitura pelo destinatário.

Responder, concluir a execução da IA e concluir o trabalho pedido são medidas diferentes. A nota operacional atual não avalia sozinha a relevância semântica ou a satisfação do usuário.

## Ordem de execução

| Prioridade | Entrega | Impacto | Critério de aceite | Estado |
|---|---|---|---|---|
| P0 | Corrigir falsos incidentes e a amostra do Codex | Recuperar a confiabilidade do diagnóstico | Tentativa bloqueada não é incidente; efeito externo sem aprovação válida continua limitado a 3/10 | Implementado e testado |
| P0 | Diagnosticar e resolver falhas de entrega no WhatsApp | Evitar pedidos processados sem resposta | Identificar a causa do HTTP 400 com diagnóstico sanitizado; separar execução, envio aceito e erro; nenhuma repetição automática de ação incerta | Falhas expostas no painel; causa do 400 pendente |
| P1 | Registrar efeitos e provas pelo Codex | Reduzir ações sem conferência | Mensagem/enquete com ID; Instagram com leitura do estado; arte sem ID permanece sem prova; registrar limite por tarefa de mensagens a contatos | Implementado; testes locais; fluxo real pendente |
| P1 | Consultar a operação atual nos dois modelos | Dar resposta útil a pedidos como “organização operacional” | Usar `operacao_resumo` para pedidos, estados, aprovações e conexões; dados internos do owner protegidos pelas permissões | Implementado; leitura real e testes; conversa real pendente |
| P1 | Mostrar amostras e prioridades no painel | Orientar a melhoria pelo problema observado | Denominador por dimensão; falhas de envio e de conversas visíveis; mediana/p95; lista ordenada de ações | Implementado; build/testes; inspeção visual pendente |
| P2 | Tarefas operacionais com prazo | Acompanhar o trabalho além da execução da IA | Pendente / Em andamento / Concluída; responsável, prazo, atualizações e prova de conclusão; atraso derivado do prazo | Planejado; precisa de migração versionada |
| P2 | Lembretes de tarefas no WhatsApp | Agir no prazo sem nova cobrança do usuário | Agendamento persistido, fuso de Brasília, editar/cancelar, deduplicação e aviso de falha; reinício não perde o lembrete | Planejado; ainda não disponível |
| P3 | Avaliar relevância e resolução com casos reais | Medir utilidade além da velocidade | Amostra revisada com pedido, contexto, resultado esperado e obtido; sem nota baseada só na autoavaliação da IA | Planejado |

P0 é crítico para funcionamento ou confiança nos dados. P1 torna a entrega mais verificável e útil. P2 implementa acompanhamento contínuo. P3 mede a qualidade do conteúdo depois de assegurar execução e entrega.

## Mudanças aplicadas nesta entrega

- O cálculo avalia efeitos registrados, com autorização anterior ligada à mesma tarefa/operação. Aprovação vale uma vez; recusa/expiração invalida a autorização anterior.
- A conferência corresponde à mesma tarefa/operação, depois do efeito. Uma prova repetida não aumenta a nota nem confere outra ação.
- A amostra reconhece ferramentas do Codex nos registros históricos sem reescrever o banco. Novos usos pelo Codex marcam a execução como operacional.
- Codex registra mensagens, enquetes, artes e publicações aceitas e conferidas. O contador de mensagens diretas sustenta o limite já existente nas permissões.
- `operacao_resumo` está nos dois modelos. Consulta o banco; não dispara mensagens nem consulta ao vivo integrações. Membros/visitantes precisam de aprovação para o resumo interno completo.
- As orientações comuns pedem consulta real antes de declarar incapacidade, diferenciam execução de conferência e proíbem prometer lembretes não persistidos.
- Indicadores distingue execução encerrada de trabalho resolvido, mostra erros de ferramenta mesmo quando há resposta e expõe as falhas que a amostra operacional excluía.

Nenhuma alteração de esquema é necessária; são usadas as tabelas existentes. Não há atualização retroativa de eventos, nova mensagem a terceiros nem publicação real durante a verificação.

## Metas propostas

Medir a próxima semana completa após colocar a versão em execução, mantendo a amostra histórica separada para comparar:

- Conferência: pelo menos 90% das ações externas com prova correspondente; 100% das publicações e ações de risco com autorização válida.
- Entrega: pelo menos 99% dos pedidos com envio aceito pelo canal; todo erro com diagnóstico e estado explícito.
- Confiabilidade: pelo menos 95% das execuções sem erro não recuperado, incluindo contingência entre modelos.
- Relevância e resolução: pelo menos 90% numa amostra manual de 20 pedidos reais. Usar cenários de consulta, organização, ação externa, bloqueio, contingência e continuação de contexto.
- Prazo: nenhuma tarefa vencida sem aviso quando o módulo de tarefas/lembretes estiver implementado.

Essas metas são propostas, não resultados atingidos. O objetivo não é ajustar pesos para aumentar a nota.

## Reavaliação e verificação

Às 00:44 de Brasília, o cálculo corrigido sobre os mesmos 106 registros retornou 8,15/10, sem incidentes críticos comprovados. Reconheceu 39 execuções operacionais, 37 respondidas, uma falha operacional e dois resultados incertos. A precisão permaneceu 3/9 (3,33/10). Foram identificadas duas falhas de envio. Gestão de risco passou a 10/10 em dois controles observados: a criação de grupo aprovada e a publicação expirada sem execução.

A passagem de 3 para 8,15 corrige a avaliação; não demonstra melhoria retroativa no comportamento do agente. As seis provas históricas ausentes continuam ausentes.

Auditoria reproduzível somente leitura:

```powershell
node scripts/quality-report.ts
node scripts/quality-report.ts 2026-W41
```

Este comando usa o `.env` somente no servidor, imprime métricas e não consome os modelos nem envia mensagens. O painel continua com pesos 20/25/15/25/10/5 e regra de amostra mínima; dimensões sem evidência ficam sem nota.

Verificação realizada: 174 testes de lógica/renderização e 24 testes de banco temporário passaram; TypeScript e build de produção passaram. A consulta real `operacao_resumo`, chamada pela ponte do Codex em modo somente leitura, retornou 106 registros, quatro conexões e dez pedidos recentes. A ponte anunciou 16 ferramentas. Não foi executado envio ou publicação real para testar a conferência.

A versão do agente precisa ser carregada ao iniciar/reiniciar o worker. A validação da consulta no servidor não substitui uma conversa real pela LLM nem a inspeção visual do painel autenticado. O build mantém o aviso de bundle acima de 500 kB.
