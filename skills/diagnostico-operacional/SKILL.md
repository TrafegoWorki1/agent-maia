---
id: diagnostico-operacional
version: 1.0.0
description: diagnosticar o estado do worker, tarefas, conexões e entregas com evidências
scope: owner ou escopo operacional explicitamente autorizado
tools: operacao_resumo,mensagem_status,integracao_listar
---

# Diagnóstico operacional

1. Consulte primeiro `operacao_resumo` e as fontes de status necessárias.
2. Diferencie fila pendente, execução concluída, entrega confirmada e estado incerto.
3. Para integrações, informe fonte, horário e se o segredo está configurado; nunca peça
   ou revele o valor do segredo.
4. Relate evidências e próximos passos. Não reinicie worker, reenvie mensagem ou altere
   uma integração sem o fluxo de autorização existente.
