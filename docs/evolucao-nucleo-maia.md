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

## Estado local antes da aplicação remota em 16/10/2026

O código usa as migrações `20261016120000_maia_nucleus_v1.sql` (estrutura inicial),
`20261016130000_maia_nucleus_safety.sql` (unicidade de escopo, reservas, retenção,
revisão e eventos idempotentes) e `20261016140000_maia_cache_usage.sql` (contadores
de cache retornados pelo Claude). A primeira migration não foi editada. As três
passaram em banco PGlite temporário. Esta descrição registra o estado anterior
à aplicação remota documentada em "Rollout" abaixo.

Sessões do owner e de membros autorizados são gravadas por canal, conversa,
solicitante e cliente. No privado, `conversa.maia` é conferida novamente em cada
recuperação/busca. Em grupo, a recuperação exige também que grupo e cliente
continuem ativos e o solicitante conserve acesso. Nova conversa arquiva a
anterior sem apagar a fonte; resumos guardam cobertura e referências. O painel
autenticado exibe apenas sessões privadas do owner, permite buscar nelas e
acompanha planos, skills, subagentes e rotinas. Retenção atual: mensagens de
membros/grupos por 7 dias; o worker expurga o texto vencido quando ativo.

O worker pode sincronizar propostas de skills, resumir sessões e executar
subagentes/rotinas textuais isolados mediante flags independentes. Rotinas são
criadas pausadas, revalidam o destino do owner e não recebem ferramentas.
Subagentes iniciais analisam apenas o contexto fornecido: "pesquisa" não
significa acesso à web. Resultado de execução e confirmação de entrega são
estados distintos. O registro MCP permite sondar servidores Streamable HTTP
HTTPS autorizados e chamadas de leitura expressamente permitidas, mas não
injeta essas ferramentas nos executores Claude/Codex. Navegador e comandos
isolados permanecem indisponíveis: não há runtime Docker neste ambiente.

Ainda faltam gatilhos gerais de resposta/arquivo privado, obrigatoriedade
estrutural para todo pedido de múltiplas etapas e integração MCP nos catálogos
dos executores. Gatilhos de horário ISO futuro até sete dias estão disponíveis,
junto com aprovação, entrada e arquivo em grupo; todos usam reserva atômica e
bloqueiam eventos antigos. Cache de entrada lido/criado é armazenado somente
quando Claude retorna os contadores; Codex fica nulo. Efeitos externos incertos
exigem revisão, sem replay automático.

Verificações locais: `pnpm rules:check`, `pnpm typecheck`, `pnpm test`
(530 Vitest + 50 banco), `pnpm db:validate` (46 migrations), `pnpm db:guard`
e `pnpm build` passaram. Não foram enviados WhatsApps reais, nem geradas
imagens, nem consumidos modelos pagos para testar.

Rollout: as quatro migrations do núcleo/acessos (`20261016120000` a
`20261016150000`) foram aplicadas ao Supabase do projeto em 16/10/2026,
na ordem de versão, após reconciliação autorizada de dois pares de versões
com SQL idêntico. O código dependente ainda precisa ser publicado; flags e
conexões opcionais não são ativadas automaticamente. Atualizar/reiniciar um
único worker depois do deploy. Verificar uma sessão
de membro e sua revogação, leases e entregas antes de ampliar flags. Reversão:
desligar flags e voltar código/worker à versão compatível; manter dados
históricos e criar migration compensatória se for necessário ajustar esquema.
Não apagar tabelas nem presumir que envios anteriores podem ser desfeitos.
