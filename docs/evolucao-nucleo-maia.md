# Evolução do núcleo da Agent Maia

## Objetivo

Evoluir continuidade, reutilização de procedimentos, execução de planos, delegação e
automações sem substituir o caminho operacional Evolution → Vercel → `inbox` → worker,
sem criar outro framework de agentes e sem transformar sessões locais do Claude ou do
Codex em fonte de verdade.

## Referências e decisões

- O Hermes Agent foi usado como referência de arquitetura, não como código copiado. As
  ideias aproveitadas são: sessões pesquisáveis, compressão com linhagem, skills em
  Markdown, subagentes isolados, cron com entrega e registro explícito de MCP. O projeto
  Hermes é MIT; esta implementação mantém código próprio e não incorpora arquivos dele.
- O banco Supabase da Maia continua sendo a continuidade compartilhada. Sessões, mensagens,
  resumos, skills, execuções e agendas têm escopo explícito; `owner_memories` continua
  separado de histórico conversacional e de regras autorizadoras.
- Claude continua principal e Codex continua contingência. Os adaptadores existentes são
  reaproveitados; nenhuma API nova de SDK é presumida sem confirmação no pacote instalado.
- WhatsApp continua o canal operacional atual. Agendamento e execução não concedem
  autorização permanente para efeitos externos; cada execução revalida acesso e aprovação.
- Navegador e comandos ficam desabilitados por padrão. A primeira entrega implementa a
  política e o registro, não habilita rede, shell ou publicação automaticamente.

## Etapas

### 1. Contrato persistente do núcleo

Criar uma migração aditiva com sessões, mensagens de sessão, resumos com cobertura,
skills/propostas/uso, etapas de plano, subagentes, rotinas/agendas, servidores MCP
configuráveis e execuções controladas. Todas as tabelas terão RLS e acesso de cliente
revogado; operações concorrentes usam funções ou filtros otimistas.

Critérios: migração valida em banco temporário; isolamento por `scope_key`; registros
mantêm autoria, origem e timestamps; nenhuma migração existente é alterada.

### 2. Sessões, contexto e memória

Adicionar construtores de identidade de sessão por canal/conversa/solicitante/cliente,
histórico autorizado, busca separada de memória declarativa, resumos versionados e
orçamento por executor. A compressão preserva a fonte original e marca fatos,
preferências, compromissos e hipóteses separadamente.

Critérios: nova conversa não apaga a anterior; perda de acesso bloqueia recuperação;
contexto de grupo/cliente nunca consulta sessão privada; testes cobrem orçamento,
linhagem e isolamento.

### 3. Skills reutilizáveis

Implementar catálogo Markdown mínimo com frontmatter (`id`, `version`, `description`,
`scope`, `tools`), busca/carregamento seletivo, propostas derivadas de trabalhos e uso
auditável. Propostas não alteram skills ativas sem aprovação do owner; skills não podem
alterar regras, permissões ou política de aprovação.

Skills iniciais: diagnóstico operacional, relatório de marketing e preparação de trabalho
criativo, usando somente ferramentas que já existem.

### 4. Planos persistentes e subagentes

Adicionar estado por etapa, dependências, evidência, bloqueio, lease e resultado externo
incerto. A reserva atômica impede duplicidade e eventos antigos/duplicados são ignorados.
Subagentes terão objetivo, contexto mínimo, limite de ferramentas, vínculo pai/filho,
consumo e revisão do coordenador. A primeira capacidade de delegação cobre pesquisa,
análise e revisão sem efeitos externos.

### 5. Rotinas e extensibilidade

Adicionar agenda única/intervalo/cron, fuso padrão `America/Sao_Paulo`, política de
horários perdidos, reserva de execução e distinção entre conclusão e entrega. Adicionar
registro configurável de servidores MCP e ferramentas permitidas, sem misturar o catálogo
HTTP existente nem expor adaptadores vazios.

### 6. Execução controlada e painel

Adicionar contrato para navegador/comandos isolados, com diretório, rede, duração e saída
limitados, sempre desabilitado por padrão. Acrescentar dados reais e estados vazios
honestos no painel usando a navegação existente, sem acesso direto das telas a dados
privados do banco.

## Dependências e rollout

1. Aplicar a migração versionada em ambiente temporário e revisar RLS.
2. Publicar código dependente somente depois de a migração ser aplicada no ambiente alvo.
3. Configurar explicitamente rotinas, skills ativas, MCP e execução controlada; nada disso
   é ativado por este trabalho.
4. Reiniciar um único worker e observar leases, eventos duplicados, erros e entregas.
5. Reverter desativando as novas rotas/configurações e retornando o worker ao caminho
   anterior; não prometer desfazer efeitos externos já realizados.

## Critérios gerais de aceite

- `pnpm rules:check`, `pnpm typecheck`, `pnpm test`, `pnpm db:validate`,
  `pnpm db:guard` quando aplicável e `pnpm build` executados e registrados.
- Testes de comportamento para continuidade, isolamento, permissões herdadas,
  cancelamento, retomada, concorrência, duplicidade e resultado externo incerto.
- Nenhuma publicação, mensagem real, imagem real, serviço pago ou migration remota é
  executada durante os testes locais.
- `CHANGELOG.md`, `docs/erros-e-mudancas.md`, README e pendências refletem o que foi
  implementado, o que foi testado e o que permanece operacionalmente pendente.

## Estado desta implementação

Esta entrega implementa as etapas 1–5 em contratos de servidor, migração e testes puros;
o painel e a ativação operacional ficam preparados/documentados quando dependerem de
configuração ou de aplicação remota da migração.
