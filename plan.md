# Plano de implementação — OperaFlow / Maia (protótipo)

## Escopo

Construir um repositório web responsivo para continuar no Claude Code: dashboard operacional, chat demonstrativo do agente Maia, grupos/permissões, escalonamento ao owner Herickson Maia e trilha de auditoria. A primeira versão usa exclusivamente dados fictícios; não recebe credenciais, não conecta contas, não chama APIs externas e não produz efeitos reais.

O protótipo inclui Resumo, Indicadores, Campanhas/Aulas, Vendas e Comunidade, Customer Insights, Tom de voz, Ocorrências/Auditoria, Operação e Conversa com Maia. As integrações previstas para uma etapa posterior são Evolution API/WhatsApp, Kommo, Instagram, Google Agenda, Google Sheets/Forms e Meta Ads; aqui ficam visualmente desligadas.

## Modelo de autorização

- Representar um grupo principal somente com o owner Herickson Maia; integrantes de equipe fictícios podem ser adicionados depois, cada um com permissões individuais editáveis localmente; representar também o grupo de Tráfego pago e um canal separado de Aprovação · Herickson Maia.
- Em cada pedido, verificar grupo, remetente, permissão e escopo e explicar a decisão.
- Quando faltar permissão, o pedido estiver fora do escopo ou uma ação for sensível, bloquear a execução e encaminhar uma solicitação com autor, contexto, regra, ação e impacto para Herickson Maia no canal separado.
- Não executar nem simular a ação antes da aprovação explícita. Aprovação/recusa vale somente para a ação indicada e nunca concede acesso permanente.
- Revalidar permissões antes da simulação e manter a trilha de auditoria pesquisável com solicitante, grupo, regra, ação, decisão, resultado e data.
- Persistir somente estado fictício no `localStorage`; exibir avisos de demonstração e permitir restaurar o estado inicial.

## Implementação e limites

- React + TypeScript + Vite, com pnpm 11.25.0; frontend apenas, sem servidor, banco, autenticação, LLM, tarefas agendadas ou integrações reais nesta fase.
- Chat local determinístico com prévia, estados de aprovação e simulação. A aplicação declara em tela que não envia mensagens, não altera CRM, não publica, não gasta dinheiro e não agenda eventos.
- Uma política pura em `src/lib/authorization.ts` classifica o pedido e decide acesso; testes automatizados cobrem consulta permitida, escalonamento financeiro, permissão ausente, decisão do owner e canal de aprovação restrito.
- `src/data/seed.ts` contém somente integrantes, grupos, permissões, métricas e conectores fictícios. `src/lib/persistence.ts` guarda o estado local e o reinicia.
- O projeto não inclui segredos. Futura integração deve começar por conta de teste, escopo mínimo, credencial protegida server-side, política de retenção e modo somente leitura.
- `CLAUDE.md`, `README.md`, `TODO.md` e a análise em `docs/analise-da-referencia.md` documentam continuidade, execução local, requisitos e limites.
- A página é uma SPA de rota `/`; o manifesto correspondente é `public/manus-routes.json`.

## Estrutura real do repositório

```text
public/
  manus-routes.json              # Única rota de página
src/
  App.tsx                        # Navegação, estado da demo e transições
  main.tsx                       # Entrada React
  styles.css                     # Tokens, layout responsivo e estados
  components/ui.tsx              # Primitives compartilhadas
  data/seed.ts                   # Dados fictícios e catálogo de ação
  features/
    agent/AgentPage.tsx           # Chat, fila, aprovação e simulação local
    dashboard/DashboardPages.tsx  # Resumo, métricas e histórico pesquisável
    operations/OperationsPage.tsx # Grupos, permissões e conectores desligados
  lib/
    authorization.ts             # Classificação e política de autorização
    persistence.ts               # Estado local e reset
 tests/
  authorization.test.ts          # Regras de acesso e escalonamento
 docs/
  analise-da-referencia.md        # Evidências observadas e limites
CLAUDE.md
README.md
TODO.md
```

## Direção de design

- **Movimento:** painel editorial de operações, profissional e calmo, com influência de dashboards administrativos premium; inspira-se no contraste visual da referência sem copiar sua marca ou conteúdo.
- **Princípios:** clareza antes da densidade; origem e estado visíveis; ações seguras por padrão; detalhe sob demanda.
- **Filosofia de cor:** marfim e cartões claros reduzem fadiga; carvão estrutura a navegação; dourado fosco dá identidade e foco; verde/amarelo/vermelho/cinza comunicam estado sempre com rótulo e ícone.
- **Layout:** navegação lateral compacta, cabeçalho de contexto e áreas de painel; no agente, conversa principal à esquerda e fila de decisão à direita; em telas estreitas, navegação recolhida e fluxo vertical.
- **Elementos assinatura:** marca geométrica de duas rotas e ponto de decisão; linhas douradas discretas; pílulas de estado e fila temporal auditável.
- **Interação e animação:** explicar checagem antes de simular, separar aprovação de execução, revelar motivo de bloqueio; transições curtas e sem efeitos que sugiram ação real; respeitar redução de movimento.
- **Tipografia:** Inter para interface e dados; Cormorant Garamond para títulos selecionados; tabelas compactas porém legíveis.
- **Essência:** “Uma central de operação para a equipe ver, decidir e auditar o que Maia pode fazer.” Personalidade: confiável, lúcida e criteriosa.
- **Voz:** objetiva, transparente e cordial. Exemplos: “Vou conferir seu escopo antes de propor qualquer ação.” / “Parei aqui. Herickson Maia precisa aprovar este pedido.”
- **Wordmark/logo:** palavra “Maia” ao lado de duas rotas geométricas que chegam a um ponto de decisão; não reutilizar a marca ou logotipo da referência.
- **Cor de assinatura:** dourado fosco, usado com parcimônia para identidade e foco, nunca como único sinal de sucesso.

## Limites de engenharia reversa

A inspeção autorizada revelou a interface e parte do código client-side, mas não o backend, segredos, prompt interno ou escopos completos das APIs. Este repositório reproduz padrões funcionais observados, não o servidor original. Nenhuma ação de escrita foi realizada no painel de referência.
