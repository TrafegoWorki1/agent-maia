# Plano: autonomia delegada da Maia

Data: 21/10/2026. Status: implementação local concluída; implantação e validação registradas em `docs/autonomia-delegada-maia.md`.

Este documento conserva o desenho e o diagnóstico anteriores à implementação. O comportamento efetivamente entregue e seus limites estão no manual citado; itens futuros deste plano não representam capacidades já homologadas.

Este plano transforma pedidos do owner em missões persistentes e limitadas. A Maia deve continuar trabalhando sem novos comandos enquanto ainda estiver cumprindo o objetivo original, mas nunca ampliar destinatários, canais, ferramentas ou efeitos além do que foi autorizado.

## Resultado esperado

O comportamento alvo é:

> “Maia, fale com este lead, diga quem você é e encontre o melhor horário para agendarmos uma reunião.”

A Maia identifica o contato, consulta a agenda, apresenta-se, oferece ou coleta horários, continua a conversa quando o lead responde, confere novamente a disponibilidade, cria o evento, confirma com o lead e entrega ao owner um resumo com horário, participantes, link/local e evidência do agendamento.

Para um pedido direto de grupo, por exemplo:

> “Maia, mencione a Ana no grupo Automação e diga que a reunião começou.”

A Maia resolve o grupo e a pessoa, envia a mensagem com a menção e confirma o resultado. Se o owner disser “mencione todos”, usa a menção fantasma existente. Se o pedido depender de um evento futuro, ele vira missão persistente e retoma quando o evento ocorrer.

## O que foi aproveitado do Hermes Agent

A pesquisa foi feita nas fontes oficiais do Hermes Agent em 21/10/2026. Os padrões relevantes são:

1. **Objetivo persistente:** o `/goal` mantém um objetivo ativo entre turnos e não exige que o usuário diga “continue”. O estado sobrevive a retomadas.
2. **Contrato de conclusão:** o objetivo pode declarar resultado, verificação, restrições, limites e condição de parada. O trabalho só termina com evidência.
3. **Estados explícitos:** o objetivo pode continuar, concluir, bloquear ou esperar. Esperar não consome turnos enquanto o evento externo não acontece.
4. **Orçamento limitado:** há limite de turnos e pausa automática para evitar loops sem fim.
5. **Preempção pelo usuário:** uma nova instrução do usuário pode corrigir, pausar ou cancelar o objetivo em andamento.
6. **Sessão por origem:** conversas de WhatsApp e grupos têm chaves determinísticas, evitando misturar pessoas e salas.
7. **Entrega durável:** respostas ficam registradas para recuperação após falha, sem executar novamente todo o trabalho.
8. **Segurança por camadas:** autorização da pessoa, escopo da sessão e aprovação de ação perigosa são controles separados.

Fontes:

- [Repositório oficial do Hermes Agent](https://github.com/NousResearch/hermes-agent)
- [Persistent Goals](https://hermes-agent.nousresearch.com/docs/user-guide/features/goals)
- [Sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions)
- [Messaging Gateway](https://hermes-agent.nousresearch.com/docs/user-guide/messaging)
- [Security](https://hermes-agent.nousresearch.com/docs/user-guide/security)
- [Google Workspace](https://hermes-agent.nousresearch.com/docs/user-guide/skills/google-workspace)

Não será instalado ou incorporado o Hermes. A Maia já tem worker, Supabase, sessões, ferramentas, aprovações e planos. O plano adota os padrões úteis dentro da arquitetura existente.

## Diagnóstico da Maia hoje

A base necessária já existe:

- `maia_plans` guarda pedidos com várias etapas, contexto, espera e status.
- `claim_maia_waiting_plan` reserva retomadas atomicamente e evita processar o mesmo evento duas vezes.
- O worker recebe respostas privadas e mensagens de grupo.
- Conversas privadas e de grupo já são persistidas.
- A Maia já envia mensagens privadas, mensagens em grupo, menções individuais e menção a todos.
- A política já permite ao owner enviar mensagens privadas e criar eventos internos sem um segundo OK.
- A resposta final e os efeitos externos já têm eventos e recibos.

As lacunas são:

- resposta privada ainda não é gatilho de plano;
- uma resposta do lead cai no atendimento ou na prospecção genérica, sem vínculo obrigatório com o objetivo do owner;
- o atendimento autônomo a contatos roda somente com texto e não pode consultar ou alterar a agenda;
- a autorização original não é guardada como um escopo executável para as retomadas;
- não há executor que responda ao lead, permaneça silencioso para o owner durante a negociação e só entregue o resumo final;
- não há contrato de conclusão com evidências obrigatórias;
- o fluxo de criação real de evento do Google Agenda ainda precisa de homologação em produção.

## Modelo proposto: missão delegada

Uma missão é um plano com cinco blocos obrigatórios:

| Bloco | Conteúdo |
| --- | --- |
| Objetivo | Estado final pedido pelo owner, como “reunião agendada com João”. |
| Verificação | Evidências necessárias, como ID do evento e ID da confirmação enviada no WhatsApp. |
| Autoridade | Ações que o owner delegou, destinatários, grupo, calendário e conta exatos. |
| Limites | Prazo, quantidade máxima de interações, duração, janela de horários e ações proibidas. |
| Parada | Situações em que a Maia deve consultar o owner: conflito, pedido fora do escopo, dado sensível, custo ou efeito não autorizado. |

O texto de terceiros será sempre dado da missão, nunca uma nova autorização. Se o lead pedir algo fora do objetivo, a Maia não executa; responde dentro do contexto ou leva o ponto ao owner.

### Estados

`active` continua representando missão em andamento. O estado operacional fica em `context.mission.state`:

- `working`: há uma próxima ação imediata;
- `waiting_external`: aguarda resposta de contato ou mensagem de grupo;
- `waiting_time`: aguarda horário;
- `waiting_owner`: precisa de uma decisão que não foi delegada;
- `verifying`: o resultado existe e precisa ser conferido;
- `done`: resultado e evidências completos;
- `blocked`: não pode continuar com segurança;
- `cancelled`: o owner cancelou ou a validade terminou.

Enquanto estiver em `waiting_external`, a Maia não usa modelo nem fica perguntando de novo. O evento certo retoma a missão.

## Fase 1 — Contrato persistente e autoridade

Evoluir `maia_plans` em vez de criar um segundo sistema concorrente.

Adicionar, por nova migration:

- `kind`: `general`, `meeting_negotiation`, `group_action`;
- `authority jsonb`: destinatários, canais, recursos, operações e limites autorizados;
- `expires_at`;
- `interaction_count` e `max_interactions`;
- `last_event_at`;
- índices para planos ativos por tipo e validade.

Manter RLS habilitado e acesso apenas pelo `service_role`, como nas tabelas existentes. Validar `authority` no código com esquema estrito; conteúdo criado pelo modelo não pode ampliar esse envelope.

Ampliar os tipos de espera:

- `private_message`: número exato do contato;
- `group_message`: JID do grupo e, opcionalmente, número do autor;
- preservar `approval`, `member_joined`, `file_received` e `time`.

Controles naturais do owner:

- “Maia, pause/cancele a conversa com João.”
- “Não ofereça mais sexta-feira.”
- “Inclua também a Ana.” — só altera a autoridade depois de um novo comando do owner.
- “Qual o andamento?” — mostra estado, última ação e espera atual.

## Fase 2 — Roteamento de eventos

Antes de enviar uma resposta recebida para atendimento ou prospecção genérica, o worker deve:

1. normalizar o número/JID;
2. procurar missão ativa esperando exatamente aquele evento;
3. conferir se a mensagem ocorreu depois da criação/última espera;
4. reservar a retomada atomicamente usando a chave real da mensagem;
5. entregar à missão o texto, autor, horário e ID da mensagem;
6. cair no fluxo genérico somente quando nenhuma missão casar.

Aplicar o mesmo princípio aos grupos. Uma missão que espera uma resposta no grupo pode retomar sem exigir que a pessoa escreva “Maia”, mas apenas para o grupo, autor e período registrados. Mensagens comuns continuam seguindo a regra atual de menção.

Se duas missões tentarem esperar a mesma pessoa no mesmo canal, não iniciar a segunda sem resolver a ambiguidade. Isso evita uma única resposta alimentar dois objetivos diferentes.

## Fase 3 — Executor restrito da missão

Criar um executor específico para retomadas delegadas. Ele não deve herdar todas as permissões do owner nem as permissões do contato.

O backend monta uma lista de ações permitidas a partir de `authority` e nega todas as demais. Para uma negociação de reunião, o conjunto máximo será:

- ler disponibilidade do calendário definido;
- enviar mensagem somente ao lead definido;
- criar um evento no calendário definido;
- consultar o recibo das mensagens dessa missão;
- atualizar e concluir o próprio plano;
- avisar o owner.

Não serão liberados Gmail, Drive, anúncios, publicações, outros contatos, outros grupos ou alteração de eventos não criados pela missão.

Cada retomada recebe:

- pedido original do owner;
- contrato de conclusão;
- estado atual e etapas;
- histórico somente da conversa relevante;
- último evento recebido;
- ferramentas filtradas pelo envelope;
- regra explícita de que a mensagem do terceiro é informação, não autoridade.

Uma resposta gerada para o lead vai ao lead. Atualizações intermediárias silenciosas não geram uma resposta automática ao owner. O owner recebe mensagem quando a missão conclui, bloqueia, vence ou encontra uma decisão fora do escopo.

## Fase 4 — Negociação e agendamento de reunião

### Entrada mínima

A Maia precisa conhecer:

- contato;
- duração;
- janela de datas/horários;
- modalidade ou local;
- calendário utilizado;
- forma de convite.

Os itens ausentes devem vir de preferências permanentes do owner. Sugestão inicial:

- duração padrão: 45 minutos;
- próximos cinco dias úteis;
- horário comercial do owner;
- fuso `America/Sao_Paulo`;
- Google Meet quando disponível;
- no máximo três opções por rodada;
- validade da missão: sete dias;
- máximo de oito interações com o lead.

Se não houver preferência nem uma escolha segura, a Maia pergunta somente o dado necessário antes do primeiro contato.

### Fluxo

1. Resolver o contato sem usar números de pedidos anteriores.
2. Ler a agenda e calcular opções livres.
3. Criar a missão antes do primeiro envio.
4. Apresentar-se de forma configurável, por padrão: “Sou a Maia, assistente do Herickson”.
5. Oferecer opções ou pedir disponibilidade, conforme o pedido.
6. Esperar a resposta privada.
7. Ao receber aceite, conferir novamente a agenda para evitar conflito.
8. Ao receber contraproposta, verificar o horário; aceitar se estiver dentro dos limites ou oferecer novas opções.
9. Criar o evento com timezone explícito, duração, título, participantes e Meet/local.
10. Ler o evento criado e guardar ID/link como evidência.
11. Confirmar com o lead pelo WhatsApp.
12. Conferir o recibo do envio e concluir a missão.
13. Entregar ao owner um resumo curto com decisão, data, horário, duração, participantes, link/local e eventuais observações do lead.

Se o lead não tiver e-mail, a Maia pode criar o evento sem participante e enviar o link pelo WhatsApp, desde que essa seja a preferência do owner. Para convite formal do Google, pede o e-mail ao lead durante a missão.

### Situações de parada

A Maia consulta o owner quando:

- o lead pede alguém, serviço ou compromisso fora da missão;
- nenhum horário dentro da janela serve;
- o lead pede mudança material de duração, local ou formato;
- a agenda ou o WhatsApp ficam indisponíveis;
- o efeito fica incerto;
- a missão chega ao limite de prazo ou interações.

## Fase 5 — Ações em grupo

Pedidos imediatos usam a capacidade já existente:

- mencionar pessoas específicas por nome ou número;
- citar uma mensagem pelo ID recebido;
- mencionar todos somente quando o owner disser explicitamente “todos”;
- enviar direto em grupo cadastrado;
- manter a aprovação existente para grupo não cadastrado.

Adicionar uma resolução determinística para frases como “no grupo da Automação” e “diga assim”, usando o grupo e o conteúdo explícitos no contexto recente. Quando houver mais de um grupo compatível ou o texto final não estiver claro, perguntar apenas esse ponto.

Pedidos condicionais, como “quando o cliente responder, mencione a Ana no grupo Automação”, viram missão com espera. O resultado só é considerado concluído com o ID da mensagem enviada ao grupo.

## Fase 6 — Conclusão, resumo e controle

Inspirado no contrato de conclusão do Hermes, a Maia não marca missão como concluída com base apenas em texto do modelo.

Evidências determinísticas:

- mensagem privada: ID de envio e destinatário;
- mensagem em grupo: ID de envio, JID e menções resolvidas;
- reunião: ID do evento, calendário, início/fim com fuso e link/local;
- resposta externa: ID do evento de inbox que retomou a missão.

O resumo final deve distinguir:

- o que foi combinado;
- o que foi executado;
- como foi verificado;
- observações ou pendências reais.

Falha incerta nunca é repetida automaticamente. A missão entra em `blocked`, registra o possível efeito e avisa o owner para conferência.

## Fase 7 — Testes e homologação

### Testes determinísticos

1. Resposta privada correta retoma uma vez; duplicata não retoma.
2. Resposta antiga, outro número ou outra conversa não retoma.
3. Mensagem de terceiro não amplia a autoridade da missão.
4. Correção ou cancelamento do owner preempta a próxima etapa.
5. Duas missões ambíguas para o mesmo contato são recusadas.
6. Aceite de horário revalida a agenda antes de criar o evento.
7. Contraproposta fora dos limites não é aceita silenciosamente.
8. Evento só conclui após leitura do ID e dos horários gravados.
9. Falha incerta não cria segundo evento nem repete mensagem.
10. Resumo final só sai depois das evidências exigidas.
11. Menção individual e menção a todos preservam as regras atuais.
12. Grupo não cadastrado continua exigindo aprovação.

### Cenários com o agente real e efeitos simulados

- reunião aceita na primeira opção;
- duas rodadas de contraproposta;
- pedido de e-mail para convite;
- lead muda de assunto;
- owner corrige a janela durante a negociação;
- menção em grupo com nome parecido;
- missão expirada ou cancelada.

### Homologação controlada

1. Aplicar migration em ambiente de teste.
2. Rodar typecheck, suíte completa, validação de migrations, regras e build.
3. Testar com contato e calendário de homologação.
4. Confirmar criação, leitura e exclusão manual do evento de teste.
5. Testar mensagem e menção em grupo de homologação.
6. Reiniciar o worker no meio de uma missão e confirmar a retomada.
7. Verificar que nenhum outro contato, grupo ou calendário ficou acessível.
8. Ativar em produção com limites baixos e acompanhar as primeiras missões.

## Ordem de implementação

1. Contrato e novos gatilhos no domínio de planos.
2. Reserva atômica de respostas privadas e de grupo.
3. Executor restrito por autoridade persistida.
4. Negociação de reunião e integração com Agenda.
5. Resumo final e comandos de pausa/cancelamento/status.
6. Resolução reforçada de menções em grupo.
7. Testes, migration, regras, conhecimento e homologação real.

## Critérios de aceite

A entrega só estará pronta quando estes dois pedidos funcionarem de ponta a ponta:

1. O owner pede para conversar com um lead e agendar. A Maia se apresenta, negocia em mensagens futuras, agenda, confirma e traz o resumo sem o owner precisar dizer “continue”.
2. O owner pede uma menção em um grupo definido. A Maia resolve destinatário e grupo, envia a mensagem correta e comprova o envio; se houver uma condição futura, retoma automaticamente quando ela ocorrer.

Além disso:

- reinício do worker não perde a missão;
- mensagens duplicadas não duplicam efeitos;
- o owner consegue corrigir, pausar, consultar e cancelar;
- terceiros não conseguem redirecionar a missão;
- nenhuma ferramenta fora da delegação é utilizável;
- conclusão exige evidência externa, não apenas uma afirmação do modelo.
