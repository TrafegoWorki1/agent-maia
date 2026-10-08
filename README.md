# OperaFlow · Maia em demonstração

Protótipo de repositório para continuar no Claude Code. Recria padrões funcionais observados no painel de referência e demonstra permissões individuais, escalonamento pontual ao owner Herickson Maia, auditoria e um dashboard operacional.

> **Esta é apenas uma demo local.** Nomes, métricas, conversas e resultados são fictícios. Todos os adaptadores estão desligados. O app não envia mensagens, não altera CRM, não publica, não gasta dinheiro e não cria eventos de agenda. A única chamada externa é a opcional ao Claude via Agent SDK, só no `pnpm dev` (ver abaixo).

## Requisitos

- Node.js 22+
- pnpm 11.25.0 (pin em `package.json`)

## Executar

```bash
pnpm install
pnpm dev
```

O Vite inicia em `http://localhost:3000`.

### Conexão com o Claude (Agent SDK, somente desenvolvimento)

As respostas do Claude usam o login local do Claude Code (`claude auth status` deve mostrar `loggedIn: true`). Não é preciso chave de API. Se o login não estiver ativo, o chat volta à simulação local.

```bash
claude auth login   # só se o status não estiver logado
pnpm dev
```

Uso pessoal e local: não exponha `/api/maia` a outras pessoas.

A rota `/api/maia` existe apenas no `pnpm dev`. O build estático (`pnpm build`) não tem backend, então as respostas do Claude não aparecem nele. As decisões de autorização continuam locais; o Claude só redige o texto.

Comandos adicionais:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Explorar a demo

- O menu abre Resumo, Indicadores, Campanhas/Aulas, Vendas e Comunidade, Customer Insights, Tom de voz, Ocorrências, Operação e Conversa com Maia.
- No cabeçalho, selecione um perfil fictício. Na tela do agente, escolha o grupo `Operação principal` ou `Tráfego pago`.
- Os botões de cenário mostram uma consulta permitida, um pedido de alteração de orçamento que exige decisão do owner e uma ação de Instagram. Nesta versão só existe o owner, então os bloqueios por permissão ausente não podem ser exercitados pela tela.
- Para decidir uma aprovação na simulação, aprove ou recuse o pedido no painel de decisões. A decisão só vale para aquela solicitação. Se aprovada, a ação pode ser simulada localmente.
- Em Operação, Herickson Maia pode alterar permissões demonstrativas. Mudanças afetam apenas o armazenamento local deste navegador.
- Use `Restaurar dados demo` para voltar ao estado fictício inicial. A chave local é `operaflow-maia-demo-v3`.

## Estrutura

- `src/features/`: páginas do dashboard, chat e operação.
- `src/lib/authorization.ts`: classificação e política demonstrativa de autorização.
- `src/lib/persistence.ts`: persistência local e reset dos dados fictícios.
- `src/data/seed.ts`: cenário, integrantes, permissões e métricas fictícias.
- `docs/analise-da-referencia.md`: o que foi observado e os limites da engenharia reversa.
- `plan.md` e `TODO.md`: plano e resultados aprovados.
- `CLAUDE.md`: instruções persistentes para Claude Code.

## Próximos passos de produção

Integrações reais não estão incluídas. Antes de conectar Evolution API/WhatsApp, Kommo, Instagram, Google Agenda, Google Sheets/Forms ou Meta Ads, definir escopos e permissões por pessoa/grupo, autenticação server-side, segredo em cofre, política de retenção, tratamento de erros, limites, idempotência e fluxo de aprovação. Usar sandbox/test accounts e iniciar em somente leitura. Não reutilizar credenciais, dados nem backend do site de referência.
