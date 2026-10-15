# Confiabilidade dos envios do WhatsApp

## Comportamento implementado

- O ID de cada mensagem de texto aceita pela Evolution é registrado junto ao destino e ao estado `accepted`. Para detectar repetição exata sem persistir o texto, a tabela guarda HMAC-SHA-256 do texto normalizado em NFC, com a chave `EVOLUTION_API_KEY`; o valor não é exibido no painel.
- Um callback de status atualiza o recibo para `delivered`, `read`, `played` ou `failed`. Estados atrasados não rebaixam um recibo mais forte. Callbacks repetidos são deduplicados na inbox por um hash do ID e do estado normalizado.
- A Maia pode consultar os últimos recibos por contato ou grupo usando `mensagem_status`; a consulta só é permitida ao owner no privado. O painel operacional mostra destino amigável, estado, horário e ID técnico, sem texto da mensagem nem número completo.
- Antes de enviar texto idêntico ao mesmo contato/grupo novamente dentro de 24 horas, o controle server-side exige aprovação explícita do owner. Se o resultado anterior for incerto, a regra continua sendo não repetir automaticamente.
- A detecção automática é de igualdade textual exata. Mensagens semanticamente parecidas, com alterações de texto, ainda dependem da Maia conferir o histórico e perguntar quando a intenção não estiver clara.
- A comparação depende da mesma `EVOLUTION_API_KEY`; se a chave for rotacionada, envios anteriores deixam de casar pelo hash durante a janela de 24 horas. O comportamento seguro continua sendo perguntar quando houver dúvida.

## Estados e evidência

`accepted` significa que a Evolution aceitou o envio e devolveu um ID; não prova entrega. `delivered`, `read` e `played` só são usados quando recebidos em `MESSAGES_UPDATE`. O parser aceita status textuais e os códigos numéricos da enumeração Baileys `WAMessageStatus`: `ERROR=0`, `PENDING=1`, `SERVER_ACK=2`, `DELIVERY_ACK=3`, `READ=4`, `PLAYED=5`. `PENDING` e valores desconhecidos não são promovidos a entrega.

A Evolution documenta o evento `MESSAGES_UPDATE` como atualização de mensagem, mas o callback pode depender do canal, versão e configuração da instância. A documentação oficial de configuração lista esse evento e explica que `webhook_by_events` acrescenta o nome do evento ao caminho da URL: [Webhooks da Evolution](https://docs.evolutionfoundation.com.br/en/evolution-api/configuration/webhooks). A semântica dos códigos Baileys está em [WAMessageStatus](https://baileys.wiki/proto-reference/WebMessageInfo/enumerations/Status).

## Ativação e rollout

1. Aplicar primeiro as migrations do PR, principalmente `outbound_receipts` e a RPC `record_outbound_receipt`; só então publicar/atualizar o código da API e do worker.
2. Na configuração da instância Evolution, habilitar `MESSAGES_UPDATE` no mesmo webhook que recebe `MESSAGES_UPSERT`. Manter `webhook_by_events=false` para que os eventos cheguem à rota existente `/api/webhook`; se a instalação exigir `true`, configurar rewrite para encaminhar o sufixo de evento à mesma rota antes de ativar.
3. Depois de integrar o PR, na máquina do worker, atualizar `main` (`git fetch origin`, `git switch main`, `git pull --ff-only origin main`), instalar dependências (`pnpm install --frozen-lockfile`) e reiniciar o processo existente com `pnpm start`. O launcher passa as opções TypeScript do Node 22 ao worker filho. Não iniciar uma segunda cópia; a rota Vercel só valida e enfileira.
4. Fazer smoke test controlado para um contato de teste: envio retorna ID; o painel mostra `Aceito`; callback de entrega/leitura atualiza o estado; reenvio textual idêntico no período cria pedido de aprovação; sem OK, não há segundo envio.
5. Confirmar também que eventos sem status conhecido não alteram o estado e que callback repetido não duplica o item de inbox.

## Limitações conhecidas

- Se a Evolution não emitir `MESSAGES_UPDATE`, se a versão do canal tiver defeito, ou se o evento estiver desabilitado, a Maia verá somente `accepted` e deve comunicar que a entrega/leitura não foi confirmada.
- O parser reconhece os formatos `data.key`/`data.update` e `data.statuses[]`, mas o smoke test na instância real continua obrigatório antes de afirmar que recibos estão chegando.
- O painel consulta os 50 recibos mais recentes e não exibe conteúdo privado. O worker remove os recibos técnicos com mais de 30 dias; a janela de deduplicação é de 24 horas.
