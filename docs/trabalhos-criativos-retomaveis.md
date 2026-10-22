# Trabalhos criativos retomáveis

## Objetivo

Pedidos de imagem deixam de manter a conversa do WhatsApp presa à execução do gerador. A Maia guarda um trabalho e uma lista ordenada de artes; o executor responde com o número do trabalho e o worker local processa um item de cada vez. Assim, uma falha não apaga os checkpoints das artes já produzidas.

## Fluxo

1. O pedido explícito do owner chega pelo webhook e é processado pelo worker como uma tarefa normal.
2. O agente converte o briefing em itens estruturados e chama `trabalho_arte_enfileirar` (uma a dez artes, cada uma com briefing, formato e referências). A inserção ocorre numa RPC transacional e idempotente por tarefa de origem.
3. A resposta conversacional confirma que o lote entrou na fila; não espera a geração da imagem.
4. O worker local reclama um item de cada vez, gera a arte em diretório determinístico por job/item e grava o caminho antes de enviar o rascunho.
5. O rascunho é enviado apenas ao owner no WhatsApp, com indicação de que aguarda revisão. O trabalho termina em `review` quando todos os itens foram enviados, ou em `partial`/`uncertain` quando algum item requer conferência.
6. A página **Tarefas e eficácia** apresenta estado do trabalho e progresso por arte. Nenhuma etapa chama ferramentas de publicação.

## Recuperação e duplicados

- Cada item tem estados persistidos: `queued`, `generating`, `artifact_ready`, `preview_sending`, `ready_for_review`, `failed` ou `uncertain`.
- `artifact_ready` é um checkpoint: se o worker reiniciar antes do envio, continua do envio sem gerar a imagem outra vez.
- Ao reiniciar, itens `generating` com arte válida no diretório determinístico voltam a `artifact_ready`; sem arte válida ficam `uncertain`.
- Um reinício durante `preview_sending` resulta em `uncertain`, nunca em reenvio automático. A API de envio do WhatsApp pode ter aceitado a mensagem antes da queda, portanto repetir às cegas poderia duplicar o rascunho.
- Um lock transacional e a verificação de itens ativos mantêm uma única geração criativa em curso, mesmo se houver mais de uma instância do worker.
- A ferramenta síncrona antiga `gerar_imagem` continua disponível por compatibilidade, mas passa a criar um job de um item em vez de esperar pela imagem.

## Privacidade e limites

- O briefing é guardado em `creative_job_items` para permitir retomar a geração. A tabela só é acessível ao `service_role`; o painel devolve título, estados e nome do ficheiro, não o texto do briefing nem o caminho local completo.
- O ficheiro de imagem fica na máquina do worker, em `data/arte/pedidos/retomaveis/job-<id>-item-<n>/`.
- Não há expiração automática nesta versão. Definir retenção e limpeza de trabalhos/ficheiros é uma decisão operacional separada, porque apagar arte pode remover um rascunho ainda em revisão.
- O worker envia rascunhos somente para `EVOLUTION_OWNER_NUMBER`; não publica em Instagram, LinkedIn, grupos ou outros destinos.

## Implantação

1. Executar `pnpm test`, `pnpm test:db` e `pnpm build`.
2. Migration `20261015140811_maia_resumable_creative_jobs.sql` aplicada no projeto Supabase; o worker deve ser atualizado antes de criar trabalhos novos.
3. Integrar o código no `main` e publicar o frontend.
4. Atualizar o repositório local do worker para o `main` integrado e reiniciar o worker. O processo antigo não conhece nem consome a nova fila.
5. Fazer um smoke test privado com duas artes simples: confirmar um trabalho `running`, dois itens separados e, depois, `review` com ambos `ready_for_review`. Verificar que as imagens chegam apenas ao owner e não são publicadas.
6. Testar recuperação em ambiente de teste: parar o worker entre itens, reiniciar e confirmar que o item concluído não é gerado nem enviado outra vez e que o próximo item continua.

## Rollback

Reverter o código e manter tabelas/linhas para preservar histórico e não apagar rascunhos. Não remover as tabelas em produção como parte do rollback. O worker antigo ignora `creative_jobs`; qualquer fila pendente deverá ser concluída pela versão nova ou tratada manualmente antes de abandonar o fluxo.

## Timeout com arte já concluída (22/10/2026)

O limite do Codex CLI é 240 s. No trabalho #5, a geração salvou um PNG completo em `data/arte/pedidos/retomaveis/job-5-item-1/arte.png` às 10:27:23, mas o processo não encerrou antes do limite. O timeout marcou o item como `uncertain` sem conferir o arquivo; por isso `artifact_path` e `message_id` ficaram vazios e a etapa de envio da prévia não foi executada.

A correção em `server/imagegen.ts` confere a pasta de saída ao atingir o limite e só recupera PNG/JPEG com assinatura e marcador final completos. Se encontrar imagem completa, retorna o caminho e permite que a fila continue para o envio da prévia. Sem arquivo completo, mantém `uncertain` e não repete a geração. `tests/imagegen.test.ts` cobre os dois resultados.

**Verificação e implantação:** teste específico de `imagegen` (8 testes), suíte completa (812 testes de aplicação e 81 de banco), `pnpm typecheck`, `pnpm build`, CI (`validate`) e deploy da Vercel passaram. PR #49 integrado à `main` no commit `9b4c48b`. O launcher foi reiniciado em 22/10/2026 às 14:27 UTC e ficou uma única instância ativa.

**Recuperação do #5:** o PNG local foi validado e enviado sem nova geração. A Evolution aceitou a prévia com ID `3EB0ADD15C4750C99C6E31`; o item passou a `ready_for_review` e o trabalho a `review`. O recibo registra `accepted`; a Evolution ainda não confirmou entrega ou leitura.
