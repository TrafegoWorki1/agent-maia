# Autonomia delegada da Maia

Implementação de 21/10/2026. A Maia pode receber uma missão do owner no WhatsApp privado, guardar o objetivo e continuar a conversa quando o contato responde. O painel Núcleo lê e controla essas mesmas missões pelo servidor autenticado.

## Como usar

- Conversa: “Maia, fale com a Ana, apresente-se e descubra qual período ela prefere para uma reunião.”
- Agendamento: informar contato cadastrado, calendário, duração, fuso, janelas de disponibilidade e local ou Google Meet. A Maia consulta a disponibilidade, negocia, confere o horário novamente, cria e relê o evento, confirma ao contato e entrega o resumo ao owner.
- Grupo: mensagens imediatas continuam nas ferramentas existentes. Para uma condição futura, a missão guarda o grupo cadastrado, a mensagem e as menções autorizadas; o participante e a conversa de origem também ficam fixados.
- Controle: “Maia, pause a missão #123”, “Maia, cancele a missão #123” ou “Maia, retome a missão #123”. O painel também permite pausar, retomar, cancelar e registrar uma correção.

Se faltar informação indispensável, o owner precisa fornecê-la. O executor não inventa calendário, duração, local ou autorização de convite por e-mail.

## Contrato e limites

Somente o owner no privado cria missões. `missao_criar`, `missao_controlar` e `missoes_listar` estão disponíveis nas pontes Claude e Codex. O executor de conversa recebe dados e produz uma decisão estruturada; não recebe as ferramentas amplas do owner. Destinatário, grupo, janela e efeitos são validados novamente pelo servidor antes da ação.

Há uma missão ativa por conversa. O padrão é oito mensagens e validade de sete dias; o contrato aceita até trinta mensagens e no máximo sete dias. Não há cobrança automática de resposta nem prospecção em massa. Correções orientam a conversa dentro do contrato original; ampliar destinatário ou permissões exige cancelar e criar outra missão. A implementação principal cobre texto; não promete equivalência para todos os tipos de mídia.

Estados: trabalhando, aguardando contato, aguardando owner, pausada, concluída e cancelada. SAIR interrompe o contato. Revisões impedem um controle antigo do painel de sobrescrever outro controle. Pausar ou cancelar impede novas ações após a revalidação; não desfaz um envio ou evento já aceito pelo serviço externo, nem recolhe uma requisição em trânsito.

Cada efeito tem intenção persistida e recibo. Timeout ou resultado incerto bloqueia repetição automática e exige conferência do owner. Se a criação do evento retornou ID mas a leitura falhou, o ID permanece disponível como evidência pendente. Um recibo de WhatsApp comprova aceite do envio, não leitura pelo destinatário.

## Agenda e conclusão

`server/missionCalendar.ts` usa o conector Google Calendar da conta Claude, com argumentos validados e retorno bruto da ferramenta. Não utiliza o OAuth de Drive como se ele tivesse permissão de Calendar. O modelo não pode declarar sozinho que criou um evento. O adaptador exige ID, início, fim e conferência do evento; convite por e-mail e Meet têm verificações próprias. Reservas no banco evitam colisão entre missões, e uma nova consulta precede a criação. Alterações simultâneas feitas por terceiros no calendário ainda são possíveis.

O adaptador falha de forma explícita se o conector apresentar um formato incompatível. A compatibilidade com a sessão real do conector e o fluxo completo no WhatsApp ainda precisam de homologação operacional. Os testes desta entrega usam mocks; não enviam mensagens reais nem criam eventos de teste na agenda do owner. Codex não herda os conectores exclusivos do Claude.

## Banco, painel e operação

Migração: `20261021211144_maia_delegated_missions.sql`. Acrescenta contrato e estado a `maia_plans`, eventos de entrada, efeitos e reservas. As novas tabelas e RPCs são restritas a `service_role`; o painel passa pela API autenticada do owner. A finalização do turno e o processamento dos eventos ocorrem na mesma transação. Textos de eventos e mensagens dos efeitos são limpos após sete dias pelo worker, preservando metadados e recibos.

O worker executa o ciclo a cada cinco segundos, com exclusão local e reserva transacional no banco. O Núcleo atualiza a leitura a cada quinze segundos enquanto visível; ações ficam desabilitadas durante o envio e apresentam erros do servidor. O painel mostra estado, limites, avisos, resumo e evidências.

Ordem de ativação: aplicar migração, conferir regras, sincronizar conhecimento, disponibilizar API/painel e reiniciar uma única instância do worker com o código atualizado. Não iniciar worker duplicado. Em reversão operacional, pausar as missões; conservar recibos e dados, e usar nova migração compensatória se necessário. Não apagar histórico para tentar novamente um efeito incerto.

## Verificação e situação da entrega

- Suíte anterior à revisão final: 779 testes de aplicação aprovados e 91 testes de banco aprovados.
- Build, regras geradas e aplicação das 69 migrações em banco temporário aprovados.
- Cenários cobertos: negociação até o resumo, duplicatas, participante incorreto, pausa concorrente, aceite do horário, reserva, falha incerta, grupo fixo, SAIR, revisão antiga e isolamento de acesso.
- Revisão final: 50 testes direcionados aprovados (incluindo controles do painel) e nova execução dos 91 testes de banco aprovada. Guarda comparada com `HEAD`: uma migração nova, nenhuma existente alterada; `origin/main` não estava disponível na primeira execução. `git diff --check` sem erros de whitespace.
- Migração remota aplicada e registrada no ledger. `db:drift`: 2.134 objetos comparados, sem divergência entre o banco real e as 69 migrações.
- `rules:verify`: 48 regras alinhadas, versão 2026-10-21.2. `knowledge:sync`: um documento atualizado, nenhum erro.
- Publicação da API/painel e reinício do worker não foram executados nesta entrega. A implementação no repositório não equivale à homologação em produção.
