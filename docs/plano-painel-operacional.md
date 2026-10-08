# Plano de implementação — Painel operacional da Maia

Data: 2026-10-08 · Base: estrutura do painel do Bryan (`agente-bryan/public/dashboard.html`,
`agente-bryan/lib/quality.js`, `agente-bryan/docs/indicadores.md`), adaptada ao que a Maia registra.

Este plano substitui o `plan.md` (protótipo só frontend) para tudo que envolve dados reais. O `plan.md`
continua valendo como histórico do protótipo.

---

## 1. Objetivo

Levar ao painel da Maia, com dados reais e verificáveis:

1. **Números-chave da operação** — tarefas recebidas, em andamento, concluídas, com erro e aguardando aprovação.
2. **Qualidade operacional** — nota da semana (0 a 10), situação, teto por incidente, nota por dimensão
   (velocidade, precisão e conferência, proatividade, gestão de risco, confiabilidade técnica, comunicação),
   contagens e incidentes críticos.
3. **Tarefas** — cada pedido feito pelo WhatsApp ou pelo painel vira uma tarefa rastreável.
4. **Quem assume a operação da Maia** — manual do operador para quando a Maia parar.
5. **Páginas restantes com dados reais** — Resumo, Campanhas, Vendas, Insights, Tom de voz, Ocorrências e Operação.

Regra que vale para tudo: **nenhum número é inventado.** Sem dado ou sem amostra, o painel diz "sem dado"
ou "dados insuficientes", como no Bryan.

## 2. Ponto de partida (o que já existe)

| Peça | Estado |
|---|---|
| Banco local `data/maia.sqlite` | Eventos do webhook (sem texto), aprovações, execuções do agente, snapshots das fontes, texto das conversas |
| Conversa | WhatsApp e painel, mesmo histórico (`messages`) |
| Aprovação de escrita | Pelo número aprovador, SIM/NÃO, por ação, expira em 10 min |
| Conexões | Só conectores do claude.ai (`settingSources: []`) |
| Página "Conexões e dados" | Funciona: WhatsApp, webhook, agente, Gmail, Meta Ads, Sheets |
| Demais páginas | Demonstração, com dados fictícios ou zerados |

O que falta é o **registro por tarefa**: hoje sabemos que houve mensagem e resposta, mas não ligamos
pedido → início → aprovação → execução → conferência → resposta. Toda a qualidade depende disso.

---

## 3. Fases

Cada fase termina com typecheck, testes e build passando, entrada no `CHANGELOG.md` e verificação no painel.
Tamanho relativo: P (pequeno), M (médio), G (grande).

### Fase 0 — Tarefas e eventos por tarefa (fundação) · M

Sem esta fase nenhuma outra tem dado.

**Modelo de dados** (`server/store.ts`):

- `tasks`: `id`, `created_at`, `channel` (whatsapp | painel), `kind` (operacional | conversa),
  `summary` (primeiros 80 caracteres do pedido), `status` (recebida | em_andamento | aguardando_aprovacao |
  concluida | falhou | incerta), `started_at`, `replied_at`, `finished_at`, `error`.
- `task_events`: `id`, `task_id`, `at`, `type`, `operation` (nome da ferramenta, quando houver), `detail`
  (JSON curto, sem conteúdo pessoal).

**Tipos de evento** (mesmos nomes do Bryan): `task_persisted`, `task_started`, `approval_requested`,
`approval_approved`, `approval_denied`, `approval_expired`, `external_done`, `task_verified`,
`task_failed`, `task_uncertain`, `replied`, `access_denied`, `retry`, `deduplicated`.

**Instrumentação:**

- `handleOwnerMessage` e `answerFromPanel` criam a tarefa e emitem `task_persisted` / `task_started` / `replied`.
- `canUseTool` emite os eventos de aprovação e `access_denied` (escrita pedida pelo painel).
- O laço do Agent SDK lê `tool_use` e `tool_result`: escrita concluída → `external_done`;
  leitura posterior do mesmo item → `task_verified` (ver Fase 2).
- **Tipo da tarefa:** se a Maia usou pelo menos uma ferramenta, a tarefa é `operacional`; caso contrário
  (ex.: "oi"), é `conversa`. Conversas aparecem nos números, mas não entram na nota.
- **Deduplicação:** a Evolution pode reenviar o mesmo evento. O webhook guarda o `key.id` da mensagem e
  descarta repetidos (`deduplicated`), para não responder nem contar duas vezes.
- **Reinício:** tarefas `em_andamento` na subida viram `incerta`, sem reexecutar nada (regra do Bryan:
  "pedidos pendentes devem sobreviver ao reinício, sem duplicar ações externas").

**Aceite:** um pedido no WhatsApp gera uma tarefa com a sequência completa de eventos no banco;
um "oi" gera tarefa `conversa`; um reenvio da Evolution não gera tarefa nova. Testes cobrem os três casos.

### Fase 1 — Números-chave e tarefas recentes · P

No topo do **Resumo** (igual ao bloco "Números-chave" do Bryan):

- Recebidas hoje · Em andamento · Concluídas · Com erro · Aguardando aprovação.
- Tabela **Tarefas recentes**: horário, canal, resumo (40 caracteres, como no Bryan), tipo, situação, tempo de resposta.
- Atualização a cada 30 s pelo `/api/snapshot`.

**Aceite:** os números batem com uma contagem direta no banco; cores de alerta só quando há erro ou pendência.

### Fase 2 — Qualidade operacional · G

Novo módulo `server/quality.ts`, portado do `lib/quality.js` do Bryan, com testes equivalentes.

**Pesos e regras** (contrato do Bryan, adaptado):

| Dimensão | Peso | Regra da nota 0 a 10 na Maia |
|---|---:|---|
| Velocidade | 20% | Tarefas operacionais respondidas em até 120 s; mostra média e mediana |
| Precisão e conferência | 25% | Escritas com prova de conferência (leitura de volta do item alterado) |
| Proatividade | 15% | Avisos feitos pela Maia sem ser chamada e confirmados (ver Fase 4); sem amostra, sem nota |
| Gestão de risco | 25% | Escritas com aprovação válida; negativas e expirações respeitadas; nenhum acesso indevido |
| Confiabilidade técnica | 10% | Execuções do agente sem falha não recuperada |
| Comunicação | 5% | Tarefas com resposta registrada |

**Prova de conferência por conector** (equivalente ao `PROOFS` do Bryan):

| Operação | Prova exigida |
|---|---|
| Gmail: enviar / responder | id da mensagem + leitura da mensagem enviada |
| Agenda: criar / alterar evento | id do evento + leitura do evento |
| Meta Ads: alterar campanha, conjunto ou anúncio | id da entidade + leitura com o novo valor |
| Drive / Sheets: criar ou alterar arquivo | id do arquivo + leitura do arquivo |

Escrita sem essa prova é **não verificada** e reprova em precisão, mesmo que a ferramenta tenha respondido sucesso.

**Regras gerais:**

- Amostra mínima: 5 tarefas operacionais reais, 3 eventos finais e amostra em todas as dimensões.
  Abaixo disso: "dados insuficientes" e nota em branco. Dimensão sem amostra nunca vira 10.
- Incidente crítico (escrita sem aprovação, ou execução depois de negativa/expiração) limita a nota a 3/10.
- Semana ISO 8601 em UTC; comparação com a semana anterior.

**No painel** (bloco "Qualidade operacional", como no Bryan):

- Nota da semana · Situação (calculada | dados insuficientes) · Teto por incidente.
- Tabela de dimensões (dimensão, peso, nota ou "sem amostra").
- Contagens: tarefas, verificadas, ações externas, sem prova, falhas, incertas, respondidas.
- Incidentes críticos: tarefa, operação, motivo, quando.

**Custo:** o cálculo é local, sem consumo do plano Claude.

**Aceite:** testes reproduzem os casos do Bryan (amostra insuficiente, teto por incidente, escrita sem
prova, semana anterior); a nota do painel bate com o cálculo dos testes sobre o mesmo banco.

### Fase 3 — Quem assume a operação da Maia · P

Bloco "manual do operador" na página **Operação**, com o mesmo formato do Bryan (seções recolhíveis):

- **Objetivo** — para que a Maia existe e o que ela faz.
- **Autonomia e autorização** — leitura direta; escrita só com SIM do aprovador; aprovação vale para uma ação;
  pelo painel, só leitura.
- **Se a Maia parar** — abrir `Iniciar Maia.bat`; conferir WhatsApp `open`, webhook e conectores em
  "Conexões e dados"; revisar tarefas `incerta` antes de pedir de novo; reconectar conector no claude.ai.
- **Quem pode falar com a Maia** — número da conversa e número aprovador.

O texto fica em `docs/manual-operador.md` e o painel o exibe, para haver uma única fonte.

**Aceite:** o manual aparece no painel e cobre os passos usados de fato nos incidentes desta semana.

### Fase 4 — Proatividade · M (depende de decisão D2)

Sem esta fase, a dimensão Proatividade fica sem amostra e a nota fica em "dados insuficientes".

- **Resumo diário** no WhatsApp do dono (horário fixo): tarefas do dia, pendências, aprovações em aberto.
- **Alertas:** conector com erro, aprovação perto de expirar, gasto do Meta Ads acima de um limite definido.
- Cada aviso gera um evento `handoff`; a confirmação de leitura (`messages.update` da Evolution) prova a entrega.

**Custo:** usa o limite do plano Claude em cada resumo e alerta.

### Fase 5 — Páginas com dados reais · G

| Página | Fonte | Observação |
|---|---|---|
| Resumo | Fases 1 e 2 + resumo de conexões | Página principal da operação |
| Indicadores | Gmail, Meta Ads, Sheets (cache das fontes) | Só indicadores com fonte; o resto mostra "sem dado" |
| Campanhas / aulas | Meta Ads (por campanha) | Aulas dependem de fonte a definir |
| Vendas e comunidade | Planilha de vendas no Google Sheets | Depende do link (decisão D3) |
| Customer insights | Conversas guardadas | Análise semanal pela Maia, em cache |
| Tom de voz | Conversas guardadas | Análise semanal pela Maia, em cache |
| Ocorrências | Incidentes, falhas, aprovações negadas/expiradas, erros de conector | Cálculo local |
| Operação | Membros reais (Herickson Maia, Gessica) + manual | Permissões passam do navegador para o banco |
| Conexões e dados | Já funciona | Incluir Google Agenda e demais conectores do claude.ai |
| Conversa com Maia | Já funciona | — |

**Custo:** Insights e Tom de voz usam o plano Claude (uma análise por semana, ou pelo botão).

### Fase 6 — Acabamento · P

- Remover textos de demonstração restantes ("Todas as conexões desligadas", rodapé "dados fictícios",
  "Simular como") e trocar por estado real.
- Remover `src/features/agent/AgentPage.tsx` (sem uso).
- Atualizar `README.md`, `TODO.md` e `plan.md` (marcar como histórico).
- Teste de ponta a ponta: pedido no WhatsApp → tarefa → aprovação → conferência → nota.

### Fora deste plano: produção

Publicar fora do seu computador exige decisões próprias (servidor, login no painel, chave de API com
cobrança por uso, segredos fora do `.env`). Fica para um plano separado, depois das fases acima.

---

## 4. Ordem recomendada

1. Fase 0 (sem ela nada tem dado)
2. Fase 1 (resultado visível rápido)
3. Fase 3 (pequena, útil já)
4. Fase 2 (qualidade)
5. Fase 5 (páginas), começando por Ocorrências e Campanhas, que não dependem de decisão
6. Fase 4 (proatividade), quando a decisão D2 estiver tomada
7. Fase 6 (acabamento)

## 5. Decisões e premissas

| Id | Item | Proposta |
|---|---|---|
| P1 | Pesos e regras da qualidade | Os mesmos do Bryan (premissa, porque você pediu "conforme a estrutura") |
| P2 | O que conta como tarefa | Pedido em que a Maia usa ferramenta; "oi" e conversa leve não entram na nota |
| P3 | Número-chave | O bloco "Números-chave" do Bryan (contagem de tarefas por situação) |
| D1 | Proatividade sem amostra | Manter a regra do Bryan: sem amostra, sem nota geral, até a Fase 4 |
| D2 | Resumo diário e alertas | Horário do resumo e limite de gasto do Meta para alerta |
| D3 | Vendas | Link da planilha de vendas no Google Sheets |

## 6. Riscos

- **Prova de conferência depende do conector:** se a ferramenta de leitura não devolver o id do item,
  a escrita fica "não verificada". Mitigação: começar pelas escritas mais comuns e testar cada uma.
- **Limite do plano Claude:** análises e avisos consomem o mesmo limite do Claude Code e do claude.ai.
  Mitigação: cálculo de qualidade local; análises em cache semanal; avisos com teto diário.
- **Conectores do claude.ai oscilam** (Meta Ads já caiu hoje). Mitigação: erro visível no painel, último dado
  bom preservado, alerta da Fase 4.
- **Dados pessoais:** o texto das conversas fica só neste computador; o painel só aceita `localhost`.
