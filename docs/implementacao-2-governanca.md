# Implementação 2: governança e permissões operacionais

**Status:** plano mapeado ao código atual. **Nada foi ativado.** Itens que enviam mensagens a grupos, usam integrações novas ou mudam permissões dependem de decisão do owner (CLAUDE.md).
**Data:** 2026-10-09.

## 1. Estado atual x especificação

| Item | Estado hoje | Lacuna |
|---|---|---|
| Permissões reais por pessoa | Tabelas `people`, `person_numbers`, `person_permissions` e a página Pessoas existem. | O roteamento (`webhookServer.ts`, `inboxWorker.ts`) só reconhece dono e aprovador pelas variáveis de ambiente. Nenhuma permissão de `person_permissions` é consultada. |
| Aprovação vinculada aos parâmetros | Aprovação persistida com número, prazo, processo e decisão por ID (`server/approvals.ts`). | Não guarda um fingerprint dos parâmetros nem da conversa. Uma aprovação não confere se a ação executada é a mesma aprovada. |
| Segurança centralizada | Permissão por ferramenta em `maiaOwnerAgent.ts` (lista de leitura, escrita pede aprovação). | Regras em código espalhado, sem catálogo central por pessoa. |
| Grupos: listar e localizar | `server/groups.ts` lista grupos da Evolution com cache de 5 minutos. | Busca por nome com desambiguação não existe. |
| Grupos: enviar | Não existe. | Precisa de decisão sua (ver seção 4). |
| Escalonamento ao Operacional Worki Digital | Não existe. | Precisa do JID confirmado e da regra de envio automático. |
| Separar demonstração da operação real | A tela ainda tem código de demonstração (`sendRequest`, `decideApproval`, `simulateAction` em `src/App.tsx`). | Remover o motor de demonstração e ligar a tela às permissões reais. |
| Memória por usuário e projeto | RAG (`server/knowledge.ts`) sem escopo por cliente. | Coluna de escopo nos documentos e filtro na busca. |
| Privacidade por ferramenta e grupo | Leitura de conectores só para o dono. | Depende de permissões por pessoa (primeiro item). |
| Limite de imagens (10 por dia) | Não existe. | Contador atômico no Supabase, fuso America/Fortaleza. |
| Áudio no agrupamento | Áudio do dono baixado, mas sem transcrição. | Depende de provedor de transcrição (decisão sua). |
| Recuperação de aprovações | Feito: aprovação no banco, processo que a criou verificado, nada executado após reinício. | Acrescentar o fingerprint (item 2). |

## 2. Fases propostas (em ordem)

**Fase A: permissões reais no roteamento.** Sem efeito externo novo.
- Mapear remetente → pessoa ativa → `person_permissions` antes de qualquer ação.
- Número desconhecido: ignorado, sem contexto e sem resposta.
- Equipe: só ações com permissão concedida. Aprovador: só `escrita.aprovar`.
- Arquivos: `server/inbox.ts`, `server/webhookServer.ts`, `server/inboxWorker.ts`, `server/ownerRouter.ts`.

**Fase B: aprovação imutável.**
- Ao criar a aprovação, gravar `params_hash` (SHA-256 da ação e dos parâmetros), `task_id` e conversa.
- Ao executar, recalcular o hash e recusar se não bater.
- Garantia de execução no máximo uma vez: a reserva já existe (`status` pendente → decidido); acrescentar `executed_at` com atualização condicional.
- Arquivos: `server/approvals.ts`, `server/maiaOwnerAgent.ts`.

**Fase C: limite de imagens.**
- Tabela `image_quota (dia date primary key, usadas int)`, com função atômica que incrementa só se `usadas < 10`.
- Dia calculado no fuso America/Fortaleza (mesmo deslocamento de Brasília, UTC-3).
- Arquivos: `server/maiaImageTool.ts`, migração nova.

**Fase D: memória com escopo.**
- Colunas `escopo` (ex.: `operacao`, `cliente:<nome>`) em `knowledge_sources`.
- A busca recebe o escopo permitido à pessoa e filtra no banco, antes de devolver trechos.
- Arquivos: `server/knowledge.ts`, migração.

**Fase E: separar a demonstração.**
- Remover do `src/App.tsx` o motor de demonstração e ligar a tela às permissões reais do servidor.
- Verificar o restante com o build e os testes antes de publicar.

**Fase F: grupos e escalonamento.** Só depois das decisões da seção 4.
- Busca de grupo por nome normalizado, com JID confirmado e desambiguação.
- Envio com aprovação prévia, em tabela de saída com chave de idempotência.
- Escalonamento ao grupo operacional com texto fixo e dados minimizados, limitado por taxa.

**Fase G: áudio no agrupamento.** Depende do provedor de transcrição.

**Fora desta implementação:** Instagram e Kommo. As integrações não existem no projeto. Criar adaptadores agora exigiria conexão autorizada, testes e decisões sobre limites da plataforma. Recomendo tratar em outra etapa.

## 3. Testes de aceite (por fase)
- A: número desconhecido não recebe resposta; equipe sem permissão é recusada; aprovador não executa ações de dono.
- B: parâmetros alterados depois da aprovação são recusados; aprovação usada duas vezes não executa de novo.
- C: a 11ª imagem do dia é recusada; a contagem é atômica sob chamadas simultâneas.
- D: documento de um cliente não aparece para a busca de outro.
- E: nenhum código de demonstração restante; a tela reflete o servidor.
- F: envio sem aprovação é recusado; grupo ambíguo não recebe mensagem; alertas repetidos são consolidados.
- G: áudio e texto do mesmo lote são processados juntos.

## 4. Decisões que dependem de você
1. **Gessica:** qual papel terá e qual número? Hoje ela não está cadastrada.
2. **Envio a grupos:** você autoriza o envio de mensagens a grupos com aprovação prévia (`SIM <id>`)? Isso é uma mudança de regra no CLAUDE.md.
3. **Grupo Operacional Worki Digital:** qual é o identificador real (JID)? Não usar o nome para decidir o destino.
4. **Escalonamento automático:** autoriza o alerta automático ao grupo operacional, com texto fixo, sem dados pessoais? Ou prefere que o alerta só seja enviado após sua aprovação?
5. **Limite de imagens:** confirma 10 por dia?
6. **Áudio:** escolhe um provedor de transcrição? Sem isso, a fase G fica parada.

## 5. Recomendação de ordem
A, depois B, depois C, depois D e E. As fases A a E não enviam nada a grupos nem dependem de integrações novas, então podem seguir enquanto as decisões 2 a 4 são tomadas. A fase F espera as decisões 2 a 4.
