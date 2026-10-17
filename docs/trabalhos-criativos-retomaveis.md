# Trabalhos criativos retomáveis

## Objetivo

Pedidos de imagem deixam de manter a conversa do WhatsApp presa à execução do gerador. A Maia guarda um trabalho e uma lista ordenada de artes; o executor responde com o número do trabalho e o worker local processa um item de cada vez. Assim, uma falha não apaga os checkpoints das artes já produzidas.

## Fluxo

1. O pedido explícito do owner chega pelo webhook e é processado pelo worker como uma tarefa normal.
2. O agente converte o briefing em itens estruturados e chama `trabalho_arte_enfileirar` (uma a dez artes, cada uma com briefing, formato e referências). A inserção ocorre numa RPC transacional e idempotente por tarefa de origem.
3. A resposta conversacional confirma que o lote entrou na fila; não espera a geração da imagem.
4. O worker local reclama um item de cada vez, gera a arte em diretório determinístico por job/item e grava o caminho antes de enviar o rascunho.
5. O rascunho é enviado apenas ao owner no WhatsApp, com indicação de que aguarda revisão. O trabalho termina em `review` quando todos os itens foram enviados, ou em `partial`/`uncertain` quando algum item requer conferência.
6. A página **Tarefas e eficácia** apresenta estado do trabalho, preview temporário e progresso por arte. Nenhuma etapa chama ferramentas de publicação.

## Catálogo e recuperação de ativos

- Ao gerar cada arte, o worker grava o original no bucket privado `midia-recebida` e associa o arquivo ao item do job em `creative_assets`. A tabela armazena o escopo da conversa privada do owner, título, sequência, nome/MIME, checksum, estado e referência de entrega; não armazena cópia pública nem URL permanente.
- O agente pode resolver referências naturais como **“lâmina 8”**, **“capa”**, **“última”** ou nomes como **“aquele Tesla”** somente dentro dos ativos da conversa privada do owner. Busca ambígua devolve opções para o owner escolher; ausência de correspondência não autoriza procurar noutra conversa.
- A busca e o reenvio revalidam papel, número do owner, conversa privada e escopo do asset no servidor. O reenvio é exclusivamente para o WhatsApp privado do owner; não aceita grupo, membro, cliente ou destino de publicação.
- Cada tentativa cria um recibo idempotente. Uma tentativa aberta impede outro envio. Se o serviço não devolver um ID, se houver timeout ou se a persistência do recibo falhar depois da chamada externa, o estado fica incerto e a Maia não repete automaticamente. A confirmação de envio exige ID; entrega e leitura só são afirmadas depois de recibos da Evolution.
- Preview no painel usa URL assinada curta (até cinco minutos), autenticada e não persistida no catálogo. O DTO do agente não inclui `storage_key`, checksum ou identificador da conversa.

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

1. Executar `pnpm test`, `pnpm test:db`, `pnpm db:validate` e `pnpm build`.
2. A migration `20261015140811_maia_resumable_creative_jobs.sql` já é parte do fluxo de jobs. A migration `20261017052501_creative_asset_catalog.sql` foi aplicada no Supabase de produção (versão remota `20261017052501`) após autorização e checks; tabelas, coluna de vínculo, trigger e RLS foram verificados por leitura.
3. Integrar o código no `main` e publicar o frontend somente depois de migrations e checks aprovados.
4. Atualizar o repositório local do worker para o `main` integrado e reiniciar o worker. O processo antigo não conhece jobs criativos nem atualizações de recibo ligadas aos ativos.
5. Fazer um smoke test privado com duas artes simples: confirmar um trabalho `running`, dois itens separados e, depois, `review` com ambos `ready_for_review`; validar preview e recibo da Evolution. Verificar que as imagens chegam apenas ao owner e não são publicadas.
6. Testar busca com “lâmina 1” e um termo distintivo do título; confirmar que ambiguidade pede escolha e que pesquisa em outro escopo é negada.
7. Testar reenvio apenas em ambiente de teste: verificar ID de aceitação, recibos posteriores, bloqueio de duplicidade e estado incerto após resposta sem ID/timeout. Não simular reenvio em produção para validar a implementação.
8. Testar recuperação em ambiente de teste: parar o worker entre itens, reiniciar e confirmar que o item concluído não é gerado nem enviado outra vez e que o próximo item continua.

## Rollback

Reverter o código e manter tabelas/linhas para preservar histórico e não apagar rascunhos. Não remover as tabelas em produção como parte do rollback. O worker antigo ignora `creative_jobs` e recibos de assets; qualquer fila pendente deverá ser concluída pela versão nova ou tratada manualmente antes de abandonar o fluxo.
