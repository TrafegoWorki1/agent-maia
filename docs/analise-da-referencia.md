# Análise do painel de referência

## Fonte e limites

Referência analisada em modo autenticado e de leitura: <https://painel-operacao-ritchie.vercel.app/#op>. A navegação foi feita pelo navegador com a autenticação fornecida diretamente pelo usuário. Nenhuma ação de escrita foi executada no painel.

Foi possível observar a interface, as abas, parte dos textos, o comportamento visível e o HTML/JavaScript entregue ao navegador. **Não** foi possível obter o código do servidor, o repositório original, as credenciais, o banco/schema, os prompts privados do agente nem a configuração/escopos das APIs. Não foram tentados bypass de autenticação, leitura de tokens ou acesso a endpoints protegidos.

## Fatos técnicos observados

- A página é servida pela Vercel e funciona como um documento HTML de página única.
- No HTML observado, há CSS inline e um script JavaScript inline de aproximadamente 22,8 mil caracteres; não há bundle JavaScript externo carregado.
- A navegação muda o hash com `history.replaceState` e alterna renderização client-side. Os nomes de rotas observados são `resumo`, `ind`, `mc`, `pf`, `ci`, `tom`, `oco` e `op`.
- O cliente faz `POST` JSON para `/api/doc`; a resposta alimenta a interface. A tela tem proteção por senha e persiste um indicador de sessão no navegador. A implementação deste protótipo deliberadamente não copia o mecanismo de autenticação observado: se houver login futuro, usar sessão server-side e cookie `HttpOnly; Secure; SameSite`.
- O estilo observado usa Inter e Cormorant Garamond; fundo marfim, cartões claros, carvão, dourado e cores semânticas para status; há adaptação a tema escuro do sistema.
- A interface visível tem cartões de KPI, tabelas, barras/gráficos, indicadores de estado, acordeões e avisos sobre fonte e atualidade dos dados.

## Estrutura funcional observada

As oito áreas são: Resumo; Indicadores; Masterclass; Vendido e grupo; Customer Insights; Tom de voz; Ocorrências; Operação. A página distingue dados disponíveis, incompletos e ausentes; usa “sem dado” em vez de inventar estimativas; apresenta fontes, período e limitações; exibe incidentes com impacto e próximos passos; documenta ferramentas, responsabilidades, regras e contingências.

## Comportamento operacional compartilhado pelo usuário

O agente Maia recebe solicitações em grupos diferentes. Há um grupo principal com o owner Herickson Maia e cinco pessoas de equipe com permissões individuais. A solicitação deve ser avaliada pelo grupo de origem, identidade do solicitante, permissão e escopo. Se estiver fora do escopo ou Maia não puder agir com segurança, não executa: encaminha o pedido ao Herickson Maia em outro grupo para uma decisão explícita. A aprovação, quando dada, é específica àquela ação e não concede acesso permanente automaticamente.

A demo representa isso com três grupos fictícios: Operação principal, Tráfego pago e Aprovação · Herickson Maia. Os nomes, papéis e permissões iniciais são placeholders editáveis, não uma declaração sobre permissões reais de pessoas.

## Implementação deste repositório

A escolha inicial é React + TypeScript + Vite para permitir continuação local no Claude Code. O front-end usa dados fictícios, uma política de autorização testável, chat determinístico local, aprovações simuladas, auditoria em `localStorage` e adaptadores futuros desligados. A demo não tem backend nem faz chamadas externas. As integrações previstas para uma fase posterior são Evolution API/WhatsApp, Kommo, Instagram, Google Agenda, Google Sheets/Forms e Meta Ads.
