---
id: prospeccao-whatsapp
version: 1.0.0
description: enviar mensagens de prospecção pelo WhatsApp com controle de cadência e opt-out
scope: owner, somente por pedido direto e explícito
channel: prospeccao:whatsapp
tools: prospeccao_listar,prospeccao_enviar_proximo
---

# Prospecção via WhatsApp

1. Só execute por pedido direto e explícito do owner; nunca inicie uma rodada de
   prospecção por iniciativa própria.
2. Antes de qualquer envio, apresente o lote ao owner com nome, número e mensagem
   proposta. Aguarde OK individual a cada contato.
3. Toda mensagem deve incluir a palavra SAIR ao final, com instrução clara de que
   o contato pode responder SAIR para não receber mais contatos.
4. Respeite o teto de 30 envios por dia e o intervalo mínimo de 30 dias por contato;
   não proponha exceções a esses limites.
5. Registre o resultado de cada envio (entregue, erro, sem resposta) e informe o owner.
6. Se um contato responder SAIR, processe o descadastro imediatamente antes de qualquer
   outro envio — nunca contate novamente antes do prazo de 30 dias.
