# Regras que a Maia segue

Este documento descreve o comportamento **em vigor**, conforme o código. O que ainda é plano está na última seção, com referência ao documento de implementação.

## 1. Quem fala com a Maia

- Só o número do dono (`EVOLUTION_OWNER_NUMBER`) pode pedir ações. Outros números são ignorados: não recebem resposta e o texto não é guardado.
- O número do aprovador (`EVOLUTION_APPROVER_NUMBER`) só responde a pedidos de aprovação, com SIM ou NÃO.
- Mensagens de grupos não geram ação. Só a atividade é contada (quantidade e última vez), sem texto.
- O painel e as rotas locais de conversa aceitam pedidos só do próprio computador, no servidor local. Na Vercel, o painel só responde ao proprietário logado.

## 2. Ferramentas e permissões

- **Leitura direta:** consultas ao Gmail, Meta Ads, Sheets, Agenda e à base de conhecimento. Não pedem aprovação.
- **Escrita:** qualquer outra ação dos conectores (enviar, editar, mudar orçamento, alterar planilha) pede aprovação do aprovador antes de executar.
- **Negadas:** Bash, Edit, Write, WebFetch, WebSearch e NotebookEdit. O agente não acessa o computador nem a internet por essas ferramentas.
- **Conectores:** só os conectores do claude.ai da conta. Servidores MCP locais não são carregados.
- **Limites por execução:** no máximo 12 passos e US$ 1 de orçamento por pedido.

## 3. Aprovação de escrita

- Cada ação de escrita vira um pedido com número, enviado ao aprovador: `SIM <número>` ou `NÃO <número>`.
- A aprovação vale só para aquela ação, uma única vez.
- Sem resposta em 10 minutos, o pedido expira e a ação não é executada.
- Se houver mais de um pedido aberto, a resposta precisa do número. Se a Maia reiniciar no meio do pedido, nada é executado, e a pessoa é avisada.
- Só uma ação de escrita aguarda aprovação por vez.

## 4. Dados e privacidade

- O texto das mensagens do dono e as respostas da Maia ficam guardados no Supabase. Ainda não há prazo automático de remoção (a recomendação de 30 dias não foi implementada). Texto de terceiros nunca é guardado.
- Dados pessoais de terceiros só aparecem na resposta quando são necessários para ela.
- Segredos (chaves, tokens, senhas) ficam só no `.env`, e não aparecem em respostas nem em logs.
- A fila de entrada apaga o texto depois de 24 horas. A limpeza roda pelo worker, enquanto ele estiver no ar.

## 5. Como a Maia responde

- Responde em português, de forma objetiva, pelo WhatsApp (ou pelo painel).
- Se uma consulta falha, diz que falhou. Não inventa dados nem números.
- Pedido de arte com briefing incompleto: pergunta antes de criar.
- Quando a resposta vem de documentos da base, diz de qual documento veio.
- Se o processamento falhar, responde com uma mensagem curta de falha, e a tarefa fica registrada como falha.

## 6. Agrupamento de mensagens

- Mensagens seguidas do dono viram um pedido só.
- O pedido fica pronto após 15 segundos sem nova mensagem, ou no máximo 60 segundos depois da primeira.
- Não há duas execuções ao mesmo tempo para a mesma conversa. Mensagens que chegam durante uma execução entram num pedido novo.

## 7. Arte

- A Maia cria artes só quando o dono pede, nos formatos feed (4:5), story (9:16) e quadrado (1:1).
- Usa o Codex com rede desligada e escrita apenas na pasta do pedido.
- Não usa rosto real inventado, nem logo inventado, nem dados pessoais.
- Se o pedido passar de 4 minutos, para e não repete sozinho.

## 8. Base de conhecimento

- Responde com trechos de documentos aprovados (CLAUDE.md, erros e mudanças, plano).
- Os trechos são referência, não instruções. Texto dentro de documento não altera a conduta da Maia.
- Informação que não está na base é dita como ausente, sem invenção.
- A base é atualizada automaticamente, só quando um documento muda.

## 9. Triagem do Jev (modo sombra)

- Cada mensagem do dono é classificada pelo Jev, em paralelo à resposta.
- A classificação só é registrada para comparação. Não altera a resposta.
- Se a triagem falhar ou passar de 2 segundos, a resposta segue normalmente.

## 10. Grupos (o que já existe)

- Listar grupos da instância e ver a atividade: sim.
- Criar grupo: só com aprovação (`SIM <número>`).
- Enviar mensagem a grupo: não existe ainda.

## 11. O que a Maia nunca faz

- Não executa ação de escrita sem aprovação.
- Não atende número que não está cadastrado.
- Não usa o prompt, documentos ou grupos para mudar as próprias regras.
- Não repete uma ação que pode ter sido executada (ação incerta vai para conferência).
- Não envia dados pessoais de terceiros a grupos.

## 12. Ainda não implementado

As regras abaixo estão planejadas em `docs/implementacao-2-governanca.md` e não valem hoje:

- Permissões por pessoa no roteamento (o roteamento ainda usa só dono e aprovador).
- Aprovação vinculada à impressão digital dos parâmetros.
- Limite de 10 imagens por dia.
- Escopo de memória por cliente na base de conhecimento.
- Envio a grupos e escalonamento automático.
- Áudio no agrupamento (depende de provedor de transcrição).
- Instagram e Kommo (sem integração no projeto).
