# Contatos compartilhados pelo WhatsApp

A triagem extrai nome e telefones de cartões vCard individuais ou múltiplos, encaminhando-os como dados de conversa sob as mesmas regras de remetente e grupo. Não cadastra automaticamente. Passaram 720 testes e build; implantação requer webhook e worker atualizados, sem migração de banco.

# Changelog

## 2026-10-20 - painel gerencial com backup preservado

- **Problema:** navegação fragmentada, visão gerencial distribuída e fontes sem configuração/auditoria confiável. Contador acumulado de grupos aparecia como sete dias.
- **Entrega:** nove áreas e 34 telas, Panorama com seis indicadores, filtros, gráficos e abertura dos registros; gráficos nos recortes de setor do proprietário; Meu trabalho e todas as ações existentes preservados. Aliases mantêm tarefa/projeto.
- **Fontes:** cadastro de planilhas, escopo por IDs, unidade/regime/cobertura, validação do lote, unicidade, reserva de coleta, revisões, histórico e último sucesso separado de tentativa. Novos dados são exclusivos do proprietário; membros mantêm seus acessos anteriores.
- **Coleta:** processo gerencial independente do worker e da IA; metadados Google diretos e fontes Sheets explicitamente configuradas. Meta direto e escopos Google ausentes aparecem como indisponíveis. Nenhum dado de negócio foi inventado.
- **Banco:** migração idempotente de reconciliação da estrutura criativa existente e migração aditiva das fontes aplicadas. Drift 2.064/2.064 sem divergência; 46 regras com checksum preservado. Sem alteração do catálogo de regras ou das consultas compartilhadas da Maia.
- **Backup:** branch backup/painel-antes-gestao-20261020 e tag painel-antes-gestao-20261020 no GitHub, commit 2af93da; ZIP/patch/documentos preservados localmente.
- **Verificação local:** typecheck, build, 740 testes de aplicação e 81 de banco aprovados. Validação de 66 migrações aprovada. Conferência visual e fontes reais pendentes, conforme documentação.
- **Implantação:** banco aplicado; Evolution e OAuth de leitura configurados em production. Coletor independente iniciado e programado no login Windows. Sete APIs com banco real responderam 200 autenticadas e 401 anônimas. Publicação web em andamento.
- Documentação: [painel gerencial](docs/painel-gerencial.md), [plano](docs/plano-painel-gerencial-maia.md), [backup](docs/backup-painel-anterior.md).



## 2026-10-20 — conferência de GitHub, sites e produção

- Migração `20261020180000` confirmada no histórico remoto do Supabase; as migrações de Sheets (`20261020160445` e `20261020160446`) e de caminhos de site (`20261020170000`) também constam aplicadas.
- Implementação `073610d` e documentação `4d89f15` integradas na `main` pelo merge `7767b3d`. O status Vercel desse merge informa publicação concluída.
- `github_repo_criar` cria privado por padrão; `privado=false` exige OK do owner. Membros continuam sem acesso a `github_*`; não há ferramenta para mudar a visibilidade de um repositório existente.
- `site_subir_github` aceita repositório público ou privado e exige OK para o commit. `site_publicar_vercel` envia o HTML pela API; se o HTML não vier no pedido, lê o arquivo do repositório informado. O fluxo não configura deploy a cada git push. Regras do plano gratuito da Vercel não foram verificadas nesta conferência.
- Verificação local anterior: 720 testes de aplicação e build aprovados; CI do PR #29 também passou. Isso não comprova publicação real de um site pelas ferramentas da Maia.
- Pendências confirmadas: atualizar os workers (processos observados iniciados às 00h25 e 15h08, antes do commit das 16h11), manter uma única instância operacional após verificar trabalhos em andamento e testar o fluxo real de GitHub/Vercel.
- A regra aplicada `site_publicar` ainda contém a expressão antiga “repositório fixo de sites”, embora o restante descreva repositório por pedido. Corrigir futuramente no catálogo, documento gerado e nova migração; preservar a migração aplicada.


## 2026-10-20 — Google Sheets: ler, editar, criar e apagar colunas (`sheets_*`)

- **Causa:** o conector `mcp__claude_ai_Google_Sheets__*` existe na conta, mas não estava em `CONNECTOR_FAMILY` (`server/toolPolicy.ts`), então toda chamada era negada como "sem política explícita". Verificado com o token OAuth do owner (escopo `drive`): a Sheets API aceita o token e lê planilhas.
- **Decisão do owner (20/10/2026):** membros com permissão específica (leitura com `sheets.ler`, escrita com `sheets.editar`) e autorização por planilha; apagar coluna ou aba pede OK a cada vez; scripts do Apps Script ficam fora (o token não tem o escopo deles).
- **`server/integrations/googleSheets.ts`** (novo): cliente REST da Sheets API v4, com o mesmo token do `googleDrive.ts`. Operações: metadados, ler, escrever valores (USER_ENTERED, fórmulas são calculadas), criar planilha, adicionar aba, inserir e apagar coluna, apagar aba. Aceita ID ou link. Erros nunca carregam o token.
- **`server/sheetsTools.ts`** (novo), registrado em `maiaImageTool.ts` e `codexMaiaMcp.ts`: `sheets_info`, `sheets_ler`, `sheets_escrever`, `sheets_criar`, `sheets_adicionar_aba`, `sheets_inserir_coluna`, `sheets_apagar_coluna`, `sheets_apagar_aba`. Limites: 1000 linhas, 26 colunas, 20.000 células por escrita; leitura devolve até 200 linhas.
- **Política:** `access.ts` mapeia leitura para `sheets.ler` e escrita para `sheets.editar`, vale no privado e no grupo interno Operacional (quem pode decide o owner pelas permissões, como nas outras ferramentas) e nega em grupo de cliente; `approvalPolicy.ts` exige OK em apagar e marca info/ler como consulta; `actionDescriptions.ts` descreve o que será apagado; `memberAccessTools.ts` aceita `sheets.editar` no painel.
- **Autorização por planilha:** `resourceAccess.ts` trata planilha como arquivo do Drive e reaproveita `decideResourceAccess` (membro precisa de grant vigente para a planilha). `codexMaiaMcp.ts` passa a chamar essa checagem, o que também fecha a lacuna do Codex para o Drive.
- **Regras e migrações:** regra `google_sheets` (catálogo `2026-10-20.4`), migração da regra e migração da permissão `sheets.editar` (sem conceder a ninguém).
- **Testes:** `tests/sheets.test.ts` (21 novos): política por papel, bloqueio, grupo de cliente negado, grupo interno Operacional (owner e membro com permissão), checagem por recurso, ID/link, letras de coluna, escape de aba, limite de células, cliente com `fetch` simulado (leitura, deleteDimension, 404 sem token).
- **Pendências:** reiniciar o worker (as duas migrações já constam aplicadas em produção); não testado contra a planilha real do owner; criar planilha não dá acesso automático ao membro que criou; a autorização por planilha depende de grant cadastrado no painel.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 711/711 e 77/77, `pnpm build` OK, `pnpm db:validate` OK, `pnpm rules:check` OK.

## 2026-10-20 — GitHub e site: owner escolhe repositório público ou privado

- **Causa:** o repositório era sempre privado. O owner quer escolher a visibilidade a cada criação. As restrições do plano gratuito da Vercel não foram verificadas nesta conferência. O caminho de publicação da Maia usa o upload pela API da Vercel e não depende da visibilidade, mas a escolha fica com o owner.
- **Correção:** `github_repo_criar` aceita `privado` (padrão: sim). Com `privado=false`, cria público e pede OK pontual do owner (`access.ts`). `createRepo` confere a visibilidade devolvida pelo GitHub. `site_subir_github` e `site_publicar_vercel` aceitam repositório público ou privado; só conferem que ele existe (`assertRepoExists`).
- **Não mudou:** não existe ferramenta para tornar público um repositório já existente, e membros continuam sem `github_*`.
- **Regra e migração:** regra `site_publicar` (`2026-10-20.6`), migração `20261020180000` aplicada em produção e confirmada no histórico remoto em 20/10/2026.
- **Testes:** `tests/github.test.ts` (criação privada por padrão, pública quando pedida, aprovação) e `tests/site.test.ts` (repositório público aceito).
- **Pendências:** testar com repositório e Vercel reais.

## 2026-10-20 — site: repositório informado em cada pedido (sem MAIA_SITES_REPO)

- **Causa:** MAIA_SITES_REPO fixo obrigava a editar o .env a cada repositório novo criado. O owner pediu que o repositório viesse no próprio pedido.
- **Correção:** site_subir_github e site_publicar_vercel recebem repo (dono/nome). Antes de gravar, ou de ler o arquivo salvo, a ferramenta confere no GitHub que o repositório existe (assertRepoExists em server/integrations/github.ts). Público ou privado conforme escolha do owner.
- **Política:** sem mudança de permissão. Membro segue com site.publicar; o owner decide o repositório pelo pedido.
- **Regra e migração:** regra site_publicar no catálogo (2026-10-20.6) e migração 20261020180000_site_repo_por_pedido_rule.sql (só atualiza texto; não cria tabelas). Aplicada em produção em 2026-10-20 (`rules:verify` alinhado, 2026-10-20.6, 46 regras).
- **Testes:** tests/site.test.ts (15 testes), com repositório simulado (privado, público e arquivo ausente).
- **Pendências:** remover MAIA_SITES_REPO do .env do servidor (não é mais lido); testar com repositório e Vercel reais.

## 2026-10-20 — site em dois caminhos: `site_subir_github` e `site_publicar_vercel`

- **Decisão do owner (20/10/2026):** o pedido escolhe o caminho. Só o HTML: não usa ferramenta. Subir no GitHub: `site_subir_github` (commit, com OK). Publicar na Vercel: `site_publicar_vercel` (deploy direto, sem OK; usa o HTML do pedido ou o arquivo já salvo no repositório). Pedido sem caminho claro: a Maia pergunta antes.
- **Causa:** a ferramenta única `site_publicar` sempre fazia commit e deploy juntos. Sem caminho separado, não dava para subir primeiro e publicar depois.
- **`server/integrations/github.ts`:** nova `readFile` (leitura do arquivo do repositório, sem OK).
- **`server/siteTools.ts`:** `site_publicar` removida; `site_subir_github` e `site_publicar_vercel` (nos dois executores).
- **Política:** `approvalPolicy.ts` exige OK só em `site_subir_github`; `access.ts` nega os dois em grupo e exige `site.publicar` para membro; `neededPermission` mapeia os dois para `site.publicar` (bloqueio individual vale); `toolPolicy.ts` e `actionDescriptions.ts` atualizados.
- **Regras e migrações:** regra `site_publicar` reescrita no catálogo (`2026-10-20.5`) e migração `20261020170000_site_caminhos_rule.sql` (atualiza o texto da regra já aplicada; não cria tabelas). Ela depende da migração do Sheets (`.4`), que também consta aplicada em produção.
- **Testes:** `tests/site.test.ts` reescrito (15 testes): política dos dois caminhos, leitura do repositório, recusas e erros sem token.
- **Pendências:** reiniciar o worker e testar com o repositório informado no pedido e com a Vercel real; as migrações de Sheets e de caminhos já constam aplicadas.

## 2026-10-20 — criar e publicar site (HTML, GitHub e Vercel): `site_publicar`

- **Causa:** o owner pediu, na própria conversa de desenvolvimento, que a Maia pudesse gerar um site em HTML, enviá-lo no chat, subir o arquivo ao GitHub e publicar na Vercel, sem precisar de uma sessão direta do Claude Code. Nenhuma ferramenta fazia isso: `github_*` já existia mas é genérico e só do owner (decisão de 20/10/2026, logo abaixo); não havia nenhuma ferramenta de deploy.
- **Decisão do owner (20/10/2026, ampliando a decisão do GitHub do mesmo dia):** commit sempre com OK do owner, deploy na Vercel automático (sem um segundo OK, por fazer parte da mesma ação aprovada), e liberado ao owner e a membros com a nova permissão `site.publicar` — não é aberto a qualquer membro, nem afrouxa o acesso genérico a `github_*` ou ao conector de operação da Vercel.
- **`server/integrations/vercel.ts`** (novo): cliente mínimo da API de deployments da Vercel — só `createDeployment`, sem variáveis de ambiente, domínios, equipe ou billing. Token do `.env` (`VERCEL_TOKEN`) ou do cofre (`INTEGRACAO_VERCEL_TOKEN`, via `cofre VERCEL_TOKEN | valor`).
- **`server/siteTools.ts`** (novo), registrado em `maiaImageTool.ts` e `codexMaiaMcp.ts` no molde de `githubTools`: ferramenta única `site_publicar` — grava `sites/<slug>/index.html` no repositório fixo `MAIA_SITES_REPO` (via `saveFile` já existente em `github.ts`, reaproveitado) e, na mesma chamada, publica o mesmo HTML na Vercel. Falha da Vercel não desfaz a resposta: o commit é informado mesmo assim, com um aviso.
- **Política:** `approvalPolicy.ts` exige OK em `site_publicar` (cobre commit + deploy); `access.ts` nega o pedido de membro sem `site.publicar` antes de chegar a um OK do owner (owner e membro habilitado seguem para aprovação normal); `toolPolicy.ts` inclui o nome no inventário; `actionDescriptions.ts` descreve a ação com o slug e a mensagem do commit.
- **Regras e migrações:** nova regra `site_publicar` no catálogo (`config/maia-rules.json`, versão 2026-10-20.3), deixando explícito que a Maia só chama `site_publicar` quando o pedido pede publicar/subir/postar/link — pedido de só o HTML manda o HTML na mensagem e para aí, sem publicar nada. `pnpm rules:generate`/`pnpm rules:check` OK. Duas migrações: upsert da regra em `maia_rules` e inserção da permissão `site.publicar` em `permission_catalog` (sem conceder a ninguém — o owner concede pessoa a pessoa pelo fluxo já existente).
- **Testes:** `tests/site.test.ts` (10 novos): política por papel (owner aprova, membro sem permissão nega, membro com permissão aprova, grupo nega), caminho do commit, deploy com sucesso e com falha, erro nunca carrega o token.
- **Pendências:** owner precisa enviar `cofre VERCEL_TOKEN | <token>` (ou configurar `VERCEL_TOKEN` no `.env`), definir `MAIA_SITES_REPO` no `.env` e conceder `site.publicar` aos membros que devem poder pedir isso. Não testado contra a Vercel real.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 692/692 e 76/76, `pnpm build` OK, `pnpm db:validate` e `pnpm db:guard` OK, `pnpm rules:check` OK.

## 2026-10-20 — janela de agrupamento de mensagens do dono: 15 s → 30 s

- **Causa:** o dono mandou "Fechado, Lembrete para falar com a Barbara Bacchi as : Hoje" e, depois de uma pausa, "12:00". A janela de 15 s sem mensagem já tinha fechado, o primeiro lote foi despachado sozinho e a Maia perguntou o horário. O agrupamento (`server/batching.ts`) funcionava como projetado; a janela é que era curta para quem completa a frase em outra mensagem.
- **Correção:** `MAIA_BATCH_WINDOW_S=30` no `.env` (padrão no código segue 15 s). Teto `MAIA_BATCH_MAX_S` mantido em 60 s. Sem mudança de código nem de banco.
- **Pendências:** reiniciar o worker para carregar a variável. Não consegui consultar `message_batches` em produção (conector Supabase sem projetos), então a causa vem da leitura do código. Custo: cada pedido espera até 30 s de silêncio antes de a Maia começar.

## 2026-10-20 — ferramentas do GitHub (`github_*`)

- **Causa:** o conector nativo do GitHub no claude.ai é a integração do Claude GitHub App ("Apenas sessões na nuvem"): não entrega ferramentas MCP a uma sessão local nem ao worker da Maia. A Maia não tinha como falar com o GitHub.
- **Decisão do owner (20/10/2026):** ferramentas próprias sobre a API REST, com token clássico de escopo `repo`; leitura livre, criação de repositório (sempre privado) e de branch sem OK, e commit, pull request e comentário com OK pontual.
- **`server/integrations/github.ts`** (novo): cliente mínimo. Token do `.env` (`GITHUB_TOKEN`) ou do cofre (`INTEGRACAO_GITHUB_TOKEN`, via `cofre GITHUB_TOKEN | valor`); `.env` tem prioridade. Valida repositório, branch e caminho antes de chamar a rede; recusa `.github/workflows`; mensagens de erro nunca carregam o token. Repositório novo é criado com `private: true` e a resposta é conferida.
- **`server/githubTools.ts`** (novo), registrado em `maiaImageTool.ts` e `codexMaiaMcp.ts` no molde de `organizationTools`: `github_repos_listar`, `github_prs_listar`, `github_issues_listar`, `github_ci_status`, `github_repo_criar`, `github_branch_criar`, `github_arquivo_salvar`, `github_pr_criar`, `github_comentar`. Não existe ferramenta para apagar, tornar público, fazer merge nem push forçado: o token com `repo` permitiria, quem limita é o código.
- **Política:** `access.ts` nega tudo de `github_*` a não owner e em grupo; `approvalPolicy.ts` exige OK em `github_arquivo_salvar`, `github_pr_criar` e `github_comentar` (inclusive do owner) e marca as quatro consultas como leitura; `toolPolicy.ts` inclui os nomes no inventário; `actionDescriptions.ts` descreve as três ações aprovadas.
- **Testes:** `tests/github.test.ts` (17): política por papel, ausência de ferramentas destrutivas, repositório sempre privado, validação de entrada, sha em arquivo existente, issues sem PRs, erro sem token.
- **Pendências:** não testado contra o GitHub real nem pelo WhatsApp (testes usam `fetch` simulado); o worker precisa ser reiniciado para carregar as ferramentas. Os conectores Vercel citados no fluxo repositório → deploy seguem com OK em cada escrita.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 679/679 e 76/76, `pnpm build` OK. Uma execução do `pnpm test` falhou ao iniciar processos (`spawn UNKNOWN`, memória baixa na máquina) e passou ao repetir.

## 2026-10-20 — conectores de operação liberados ao owner (Trello, Vercel, Miro, ClickUp, Docs)

- **Causa:** o owner tentou usar os conectores Trello, Vercel e Miro pela Maia e a chamada foi negada com "ferramenta sem política explícita no inventário": a família não estava em `CONNECTOR_FAMILY` (`server/toolPolicy.ts`), e `decideAccess` nega qualquer `mcp__*` fora do inventário.
- **Decisão do owner (20/10/2026):** liberar Trello, Vercel, Miro, ClickUp e Claude Docs.
- **Correção:** módulo novo `server/operationalConnectors.ts` com a família e a lista explícita de leituras por serviço. `server/access.ts` aplica a regra logo após o escopo de grupo:
  - só o owner no privado; membros, visitantes e grupos recebem negação;
  - leitura listada → `allow`; qualquer outra operação (criar, editar, apagar, publicar, implantar, compartilhar) → `approve`, mesmo para o owner;
  - operações sensíveis (`env`, `token`, `secret`, `key`, `bypass`, `sdk`, `kms`, `drain`, `webhook`) nunca são leitura livre.
- **`server/toolPolicy.ts`**: `isKnownMcpTool` passa a reconhecer a família nova.
- **`server/actionDescriptions.ts`**: mensagens de aprovação legíveis por serviço ("alterar algo na Vercel…").
- **Paridade**: estas ferramentas são conectores exclusivos do Claude; por isso não entram em `maiaImageTool.ts` nem em `codexMaiaMcp.ts`, e o Codex não as herda.
- **Testes**: `tests/operationalConnectors.test.ts` (inventário, leitura livre do owner, escrita com aprovação, credenciais, membro, grupo, família fora da lista, descrição).
- **Pendências**: a família ClickUp ainda não aparece nas ferramentas desta sessão; o prefixo `mcp__claude_ai_ClickUp__` foi reservado e precisa ser confirmado quando o conector estiver disponível. Não foi testado no ambiente real de produção: confirmar se o processo `claude -p --restricted` do worker enxerga esses conectores (ver o registro de 2026-10 sobre subprocesso sem conectores). Regras do catálogo não foram alteradas.
- **Verificação**: `pnpm typecheck` limpo; `tests/operationalConnectors.test.ts` e `tests/approvalPolicy.test.ts` 34/34; `pnpm test` 76/76; `pnpm build` OK.

## 2026-10-20 — Quality Audit, Self-Correction e Aprendizado com erros

- **`server/incidents.ts`** (novo): `createIncident`, `proposeCorrection`, `resolveIncident`, `listOpenIncidents` — registro de erros, provas ausentes e resultados incertos na tabela `maia_incidents`.
- **`server/errorPatterns.ts`** (novo): `loadActivePatterns` (cache 60 s), `proposePattern`, `approvePattern`, `invalidatePatternsCache` — padrões de falha aprovados pelo owner ficam na tabela `maia_error_patterns`.
- **`server/rules.ts`**: `buildErrorPatternsSection` injeta bloco "Padrões de falha conhecidos" no prompt quando há padrões ativos — análogo ao bloco de capacidades.
- **`server/maiaImageTool.ts` + `server/codexMaiaMcp.ts`**: ferramentas `registrar_incidente` (em `LOCAL_SAFE_TOOLS`) e `propor_padrao_prevencao` adicionadas em paridade.
- **`server/toolPolicy.ts`**: inventário atualizado com as duas novas ferramentas.
- **`server/maiaOwnerAgent.ts`**: intercepta "aprovar padrão \<codigo\>" antes do agente; chama `approvePattern` e invalida o cache.
- **`config/maia-rules.json`**: versão `2026-10-20.1`, 44 regras — adicionadas `quality_audit` (42), `auto_incidente` (43), `prevencao_padrao` (44).
- **Migrações**: `20261020030001_maia_quality_selfcorrection.sql` (tabelas + RLS) e `20261020030645_quality_audit_rules.sql` (INSERT das 3 regras) — ambas aplicadas em produção.
- **Verificação**: `pnpm typecheck` limpo, `pnpm rules:check` OK, `pnpm db:validate` 56 migrações OK, `pnpm test` 76/76 passando.
- **Correção de segurança** (`20261020031404_quality_tables_lockdown.sql`, aplicada em produção com autorização do owner): `maia_incidents` e `maia_error_patterns` tinham políticas `USING (true)` sem `REVOKE`, expondo leitura/escrita a `anon`/`authenticated`. Políticas removidas e `REVOKE ALL` aplicado; só o service role (worker) acessa. `pnpm db:validate` 57 migrações e `pnpm db:guard` OK.

## 2026-10-19 — Etapa 1: honestidade sobre capacidades

- **Seção dinâmica no prompt do sistema** (`server/rules.ts`): `buildCapabilitiesSection` consulta `ZERNIO_API_KEY` (env) e `maia_integrations` + `maia_secrets` em tempo real, injeta bloco "Integrações externas — estado atual" a cada execução. O agente lê o estado real antes de responder.
- **Nova ferramenta `mcp__maia__listar_capacidades`** em `server/maiaImageTool.ts` e `server/codexMaiaMcp.ts`: retorna JSON estruturado (integração, status, segredo) para quando o agente precisar de confirmação explícita. Adicionada a `LOCAL_SAFE_TOOLS` (sem aprovação).
- **Nova regra `capacidades_reais`** (ordem 41, catálogo versão 2026-10-19.1): instrui o agente a verificar o bloco antes de afirmar acesso a integração; não improvisar caminho alternativo se a integração aparecer inativa.
- **Inventário:** `listar_capacidades`, `arte_referencia_salvar`, `arte_referencias_listar`, `arte_referencia_apagar` adicionados a `MAIA_TOOL_NAMES` em `toolPolicy.ts` (`arte_referencia_*` estavam ausentes desde o commit 424a1e3).
- **Migração:** `supabase/migrations/20261020015717_capacidades_reais_rule.sql` — INSERT da regra no banco.
- **Verificação:** `pnpm typecheck` limpo, `pnpm rules:check` OK, `pnpm db:validate` OK, `pnpm test` 654/654 passando (96 arquivos).

## 2026-10-19 — atendimento autônomo e resposta autônoma a leads de prospecção

- **Atendimento autônomo de contatos desconhecidos:** qualquer `sender === "other"` que não seja lead de prospecção é agora roteado para `handleServiceMessage`. A função verifica preferência de supressão primeiro (dono pode desligar a qualquer momento) e depois a skill `atendimento:whatsapp` ativa; sem skill, avisa o dono normalmente.
- **Controle pelo WhatsApp:** dizer "não faça atendimento autônomo para desconhecidos" salva preferência de supressão; o atendimento volta a avisar o dono sem responder. Notificação por padrão é resumo curto; "detalh" + "atend" liga modo detalhado; "não notifique" + "atend" silencia.

## 2026-10-19 — resposta autônoma a leads de prospecção e controle de notificação

- **Bug corrigido:** quando um lead respondia à mensagem de prospecção, o worker apenas repassava o texto ao dono sem nenhuma resposta autônoma. Agora o `inboxWorker.ts` verifica se o número está em `maia_prospects` (status `sent`); se sim, roteia para `handleProspectMessage`; se não, mantém o repasse ao dono.
- **Nova função `handleProspectMessage`** em `maiaOwnerAgent.ts`: carrega a skill `prospeccao:whatsapp` ativa, trata SAIR com opt-out imediato (sem passar pelo agente), monta o prompt com as instruções da skill + histórico da conversa e executa o agente com permissão de texto apenas (sem ferramentas). Responde ao lead e notifica o dono com resumo curto por padrão.
- **Controle de notificação:** o dono pode ativar modo detalhado (preferência contendo "detalh", "cada resposta" ou "individual" + "prospec") ou suprimir as notificações (preferência "não notifique" ou "sem notifica" + "prospec") pelo fluxo normal de preferências do owner.
- **`skills/prospeccao-whatsapp/SKILL.md`:** adicionadas regras 7–9 sobre como conduzir conversas de triagem com leads que respondem.
- **Sem skill ativa:** fallback para o comportamento anterior (repasse direto ao dono) sem quebrar nada.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 76 passando.

## 2026-10-18 — skills de atendimento e prospecção com aprovação pelo WhatsApp

- **Aprovação de skill pelo WhatsApp:** `handleSkillActivationCommand` intercepta `ATIVAR SKILL <uuid>` em `ownerRouter.ts` e `maiaOwnerAgent.ts` antes do agente, chama `activateSkill` e confirma ao owner. A ativação via painel (Núcleo e automações) continua funcionando.
- **Edição de skill existente:** nova ferramenta `skill_propor_atualizacao` (slug + markdown) em `maiaImageTool.ts` e `codexMaiaMcp.ts`. Verifica se a skill existe antes de propor; usa o mesmo `activate_maia_skill` para arquivar a versão anterior e ativar a nova.
- **Validação anti-bloqueio:** `validateSkillSafety(channel, instructions)` em `skills.ts` bloqueia padrões que causam bloqueio de conta (follow/unfollow no Instagram, DM fria, prospecção automática no WhatsApp) e exige menção a opt-out (SAIR) na prospecção via WhatsApp e à janela de 24h no Instagram.
- **Campo `channel` no frontmatter:** `skillFrontmatterSchema` aceita campo opcional `channel: atendimento:whatsapp | atendimento:instagram | prospeccao:whatsapp | prospeccao:instagram`; a validação de segurança usa esse campo.
- **4 skills bundled novas:** `atendimento-whatsapp`, `atendimento-instagram`, `prospeccao-whatsapp`, `prospeccao-instagram` — propostas na sincronização do worker, editáveis via `skill_propor_atualizacao`.
- `skill_propor_atualizacao` adicionada a `MAIA_TOOL_NAMES` em `toolPolicy.ts`.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 654 passando (96 arquivos).

## 2026-10-17 — fix: drive_enviar_arquivo e drive_salvar_arquivo bloqueadas pelo inventário

- **Causa:** as duas ferramentas foram implementadas no commit 905c888 mas não foram adicionadas a `MAIA_TOOL_NAMES` em `server/toolPolicy.ts`. `decideAccess` nega qualquer `mcp__maia__*` ausente do inventário antes de verificar o role, produzindo "ferramenta sem política explícita no inventário".
- **Correção:** adicionados `"drive_enviar_arquivo"` e `"drive_salvar_arquivo"` ao `Set` em `toolPolicy.ts`.
- **Verificação:** `pnpm typecheck` limpo, `pnpm test` 76 passando.

## 2026-10-17 — integração Google Drive ↔ WhatsApp

- **Drive → WhatsApp** (`drive_enviar_arquivo`): Maia baixa um arquivo do Google Drive por ID ou URL e envia via Evolution API ao dono, a um contato privado ou a um grupo cadastrado. Buffer em memória (sem arquivo temporário em disco). Limite 25 MB.
- **WhatsApp → Drive** (`drive_salvar_arquivo`): Maia faz upload de um arquivo recebido via WhatsApp (em `data/midia` ou `data/midia-membros`) para o Google Drive. Limite 100 MB.
- `server/integrations/googleDrive.ts` (novo): cliente REST do Drive API v3 com OAuth2 + refresh token; sem dependência de SDK pesado. Funções: `parseDriveId`, `getDriveFileInfo`, `downloadDriveFile`, `uploadToDrive`.
- `server/evolutionSend.ts`: adicionada `sendFileBuffer` — envia arquivo a partir de Buffer (não lê disco), aceita número de telefone ou JID de grupo.
- `server/maiaImageTool.ts` e `server/codexMaiaMcp.ts`: ambas as ferramentas registradas em paridade (regra CLAUDE.md). Variáveis de ambiente necessárias: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`.
- Verificação: `pnpm typecheck` limpo.

## 2026-10-17 — criar endpoint /api/refresh para o botão "Atualizar fontes"

- Causa: `requestRefresh()` no painel chamava `POST /api/refresh`, mas o arquivo `api/refresh.ts` não existia, resultando em HTTP 404 ao clicar no botão.
- `api/refresh.ts` (novo): autentica o proprietário com o mesmo padrão de `api/snapshot.ts`, retorna 409 se o refresh já está em curso, e dispara `refreshAll` em background respondendo 200 imediatamente.
- Verificação: `pnpm typecheck` limpo.

## 2026-10-17 — corrigir snapshot de erro falso para conectores do platform

- Causa: `refreshJob.ts` salva `status: "error"` na tabela `snapshots` quando falha ao atualizar Gmail/Meta Ads/Sheets. Essa falha não indica que o conector está quebrado — indica que o subprocesso `claude -p --restricted` do worker não tem acesso aos conectores `mcp__claude_ai_*`, que só existem na sessão interativa autenticada. O painel e a Maia liam esse `status: "error"` e reportavam os conectores como desativados, conflitando com o comportamento real (que funciona ao chamar diretamente).
- `server/refreshJob.ts`: (1) `runSource` parou de chamar `saveSnapshot` com `status: "error"` no catch — registra o erro só em `agent_runs` via `finishRun`; o snapshot anterior é preservado. (2) `clearErrorSnapshots` apaga snapshots com `status: "error"` das fontes gerenciadas ao subir o worker, limpando o estado falso deixado por execuções anteriores.
- Verificação: `pnpm typecheck` limpo.

## 2026-10-17 — atualização imediata do status no painel após reenvio de arte

- Causa: ao retornar sucesso, `retryCreativeSend` só atualizava `retryPhase` para `"sent"`, mas o label do item ainda exibia o status antigo (`"Falhou"` ou `"Incerto"`) até o próximo polling de 30 s.
- `src/features/operacao/TarefasPage.tsx`: adicionado `effectiveStatus` derivado do `retryPhase`; quando `phase === "sent"` o label muda imediatamente para `"Enviado · aguardando confirmação"`. O erro do item fica oculto no estado `"sent"`. O span de `phase === "sent"` exibe apenas o `messageId`, sem duplicar "Enviado". Adicionados `sent` e `accepted` ao mapa `creativeItemLabel`. Polling continua como sincronização de segurança; como `retryPhase` é estado separado de `data`, nenhum ciclo sobrescreve o estado confirmado localmente.
- 4 novos testes em `tests/tarefasPage.test.ts`: status local muda para `sent` após sucesso; botão "Tentar novamente" removido após sucesso; retorno `uncertain` do backend mantém botão ativo; polling não sobrescreve estado `sent`. Total de testes: 654.
- `pnpm typecheck` limpo, `pnpm test` 654 passando, `pnpm rules:check` OK.

## 2026-10-17 — fechamento operacional da idempotência no reenvio de artes

- Causa: os registros `failed` e `pending` da tabela `creative_resend_idempotency` não tinham limpeza automática, e o painel não expunha ação de retry com controle explícito de `uncertain`.
- `server/creativeIdempotencyCleanup.ts` (novo): `purgeExpiredIdempotencyRecords` apaga `failed` > 48 h e `pending` órfão > 1 h. Nunca toca em `uncertain` (auditoria permanente) nem em `result_ok=true` (envio confirmado).
- `server/inboxWorker.ts`: chamada de `purgeExpiredIdempotencyRecords` no ciclo de limpeza periódica (a cada 10 min, junto das demais purgas).
- `server/creativeAssetResolver.ts`: nova função exportada `retryCreativeSendFromPanel` — revalida proprietário contra env, verifica último estado de idempotência, bloqueia `uncertain` sem `confirmUncertain=true`, gera nova chave (`retryKey` fornecida pelo cliente ou `panel-retry-{ts}-item-{id}`), e delega para `resendCreativeArt`.
- `server/workspaceApi.ts`: nova ação `retry_creative_send` com parâmetros `item_id`, `confirm_uncertain?` e `retry_key?`.
- 11 testes adicionados em `tests/idempotencyCleanup.test.ts`: limpeza de failed expirado, pending órfão, preservação de auditoria, sem registros expirados, retry após failed, confirmação de uncertain, bloqueio sem permissão, retry com uncertain confirmado, nova chave no retry, ausência de duplicidade, env owner ausente. Total de testes: 643.
- `pnpm typecheck` limpo, `pnpm test` 643 passando, `pnpm rules:check` OK, `pnpm db:validate` 53 migrações OK.

## 2026-10-17 — política de recuperação de falhas no reenvio de artes

- Causa: a política de idempotência não documentava explicitamente o caminho de recuperação após `failed` nem garantia cobertura de testes para todos os estados relevantes.
- Política formal dos estados: `sent`/`delivered` (result_ok=true) → reutilizar resultado; `pending` → bloquear (lock ativo); `uncertain` → bloquear (nunca repetir automaticamente); `failed` → reutilizar para a mesma chave; recuperação via novo pedido explícito com nova chave (`buildIdempotencyKey` com novo `taskId`).
- Adicionados 4 testes em `tests/arteReenviar.test.ts`: `failed reutilizado somente quando for a mesma operação`; `novo pedido explícito após failed gera chave nova via taskId diferente`; `novo envio após failed com nova chave chama sendOwnerImage novamente`; `uncertain continua sem retry automático`. Total: 28 testes no arquivo.
- `pnpm typecheck` limpo, `pnpm test` 632 passando, `pnpm rules:check` OK, `pnpm db:validate` 53 migrações OK.

## 2026-10-17 — idempotência no reenvio de artes criativas

- Causa: `resendCreativeArt` sem controle de chave permitia que duas chamadas com o mesmo contexto resultassem em dois envios independentes, sem comprovação de que o primeiro não chegou.
- `resendCreativeArt` recebe agora `idempotencyKey?: string`. Quando fornecida: consulta `creative_resend_idempotency` antes de chamar `sendOwnerImage`; se houver registro anterior retorna o resultado salvo sem re-enviar; se não houver executa e persiste o resultado (ok/uncertain/failed). Erros de validação pré-envio (`blocked`) não são persistidos — nova chamada com a mesma chave pode ter sucesso se o problema foi corrigido.
- Resultado `uncertain` armazenado sob uma chave nunca é repetido automaticamente: nova chamada com a mesma chave devolve o `uncertain` anterior.
- Handlers `arte_reenviar` em `maiaImageTool.ts` e `codexMaiaMcp.ts` geram a chave `task-{taskId}-item-{itemId}` automaticamente quando `taskId` está disponível.
- Adicionada migração `20261017000000_creative_resend_idempotency.sql` com tabela `creative_resend_idempotency` (key PK, item_id, owner_number, result_ok, message_id, state, error_message). RLS aplicada via bloco `DO` com tratamento de `undefined_function` para não quebrar banco local de testes.
- Testes em `tests/arteReenviar.test.ts` atualizados: 17 casos cobrindo resultado ok/uncertain/failed reutilizado, chaves diferentes gerando dois envios, persistência na tabela, blocked sem persistência, sem acesso à tabela quando key ausente, e todos os cenários anteriores preservados. `pnpm typecheck` limpo, `pnpm test` 623 passando, `pnpm rules:check` OK.

## 2026-10-17 — autonomia operacional para localizar e reenviar artes criativas

- Causa: Claude e Codex não tinham como localizar artes por linguagem natural nem reenviar um arquivo ao owner sem referência direta ao caminho.
- Adicionada `resolveCreativeAsset` em `server/creativeAssetResolver.ts`: resolve referências como "lâmina 8", "a capa", "o Tesla", "o arquivo que faltou" contra `creative_job_items` com join em `creative_jobs(title)`. Retorna `found` (1 match), `multiple` (pergunta objetiva) ou `not_found` (informa o que foi buscado).
- Adicionada `resendCreativeArt` (mesma classe): lógica central testável para reenvio seguro — revalida acesso, nega estado incerto, verifica arquivo em disco, registra eventos `arte_preparada / external_done / task_verified / arte_incerta / tool_failed`, grava receipt em `outbound_receipts`, nunca repete automaticamente um envio incerto.
- Ferramentas `arte_buscar` (read-only, em `LOCAL_SAFE_TOOLS`) e `arte_reenviar` (owner no WhatsApp privado) adicionadas em `maiaImageTool.ts` e `codexMaiaMcp.ts` com paridade verificada.
- `approvalPolicy.ts` e `toolPolicy.ts` atualizados com as novas ferramentas.
- 12 testes unitários do resolver (`tests/creativeAssetResolver.test.ts`) + 12 testes de integração do reenvio (`tests/arteReenviar.test.ts`) cobrindo: confirmação de entrega, incerto por null/timeout, falha HTTP, item inexistente, erro de banco, estado uncertain (não repetido), arquivo ausente em disco, artifact_path null, aprovação implícita, reenvio idempotente e ausência de eventos sem taskId. Nenhum serviço externo chamado.
- `pnpm typecheck`, `pnpm test` (616 passando) e `pnpm rules:check` OK.

## 2026-10-17 — continuidade na execução de pedidos

- Causa: Claude e Codex recebiam a conversa anterior, mas a fila criativa era liberada somente quando a mensagem atual passava em uma expressão de pedido de imagem. Um roteiro que completava um pedido anterior era recusado.
- Corrigido o vínculo entre interpretação e execução: a capacidade criativa depende do proprietário autenticado no WhatsApp privado; o executor interpreta pedido, complementos, correções e cancelamentos no contexto. O classificador continua apenas como atalho de roteamento. Não é necessário repetir o comando nem usar um formato de roteiro específico.
- Pedidos diretos de arte também passam pelo executor com contexto e pela fila retomável; o atalho que gerava imediatamente sem diálogo foi retirado da entrada do WhatsApp. A seleção configurada do Codex para essa categoria foi preservada.
- Conversa recente do mesmo canal tem prioridade no orçamento, antes de memórias extensas. Contexto de painel não é usado como comando do WhatsApp. Autoria, permissões, cotas, resultados incertos e aprovações públicas continuam nos controles existentes.
- Testes offline cobrem contexto em ambos os executores, chamada MCP real com fila simulada, recusa de membros/painel/grupos e transmissão da capacidade ao Codex. Não medem compreensão de um modelo real nem geram imagens ou enviam mensagens.

## 2026-10-16 — aplicação autorizada das regras e worker local

- Aplicada a migration `20261016223848` por `supabase db push`, após dry-run: 51 versões local/remoto alinhadas, 40 regras alinhadas e drift de 1.850 objetos sem diferenças.
- Iniciado o worker local atualizado do commit `6309ca2` pelo launcher headless; primeiro ciclo de retenção confirmado no banco sem fallback ou remoção de registros.
- Corrigida a orientação operacional: o worker deste projeto roda no computador do proprietário, conforme `CLAUDE.md`; EasyPanel não é necessário para esse processo.

## 2026-10-16 — regras de execução, recurso e retenção

- Centralizado em `config/ai-routing.json` o limite de 30 passos usado por Claude CLI, Agent SDK e chamadas MCP observáveis do Codex.
- Leituras desconhecidas agora falham fechadas; Drive/Sheets para membros exige concessão por recurso além de `sheets.ler`.
- Adicionados rastreio seguro de compartilhamentos Drive, retenção configurável de mensagens brutas e aviso único de planos vencidos.
- Documentos humanos de regras passaram a ser gerados do catálogo normativo.
- Migration aditiva `20261016223848_maia_vibecoding_access_retention.sql` preparada; não aplicada automaticamente.

Registro do que foi feito no projeto, dos bugs resolvidos e das mudanças de código.
Atualize este arquivo a cada alteração no código (ver regra em `CLAUDE.md`).

Formato: a entrada mais recente fica no topo. Cada item diz o que mudou e, quando for
bug, qual era o sintoma e a causa.

---

## 2026-10-16 — Indicadores e quadros de trabalho (evolução visual local)

- Cartões compartilhados com número/unidade, hierarquia, cores de atenção e acesso à população; grids de três colunas explicativas/quatro compactas, duas em telas intermediárias e uma no celular. Indicadores indisponíveis mantêm motivo e catálogo acessíveis.
- Meu dia, equipe e coordenação apresentam prazos, bloqueios e decisões clicáveis. Detalhes usam a leitura corrente, sem guardar cópia antiga dos registros. Baseline considera equipe e semana; urgências antigas não entram nos acréscimos atuais.
- Barras de baseline e capacidade usam denominadores reais; utilização acima de 100% permanece explícita e a falta de estimativa/disponibilidade não vira zero. Projetos mostram contagem de entregáveis concluídos, sem atribuir percentual ponderado de execução.
- Comercial passa a ter colunas com oportunidades, responsável, próxima ação, contexto e ações autorizadas. Filtro de etapa preserva o denominador da taxa de ganho. Marketing/Projetos ganham quadro de produção sobre as mesmas tarefas.
- Indicadores técnicos da Maia destacam quatro números e recolhem detalhes secundários; fontes, períodos e diferenças entre execução e entrega continuam visíveis.
- Verificação: `pnpm rules:check`, `pnpm typecheck`, `pnpm test` (571 Vitest + 75 testes de Postgres temporário), `pnpm build` e `git diff --check` aprovados. Capturas isoladas com os componentes reais em 1366 px e 390 px; viewport móvel sem transbordamento da página e funil com rolagem interna. Entrada JS de 465,68 kB. Sem nova migration, escrita remota, envio real, publicação ou reinício do worker nesta evolução visual.

## 2026-10-16 — Integração departamental do painel (local, não publicada)

- Corrigidas telas estáticas de Projetos e Comercial: carteira, entregáveis e tarefas usam a API compartilhada da Central; oportunidades e combinados de CS têm persistência, origem, próxima ação, revisão e histórico.
- Migração aditiva `20261016180722_maia_department_workspace.sql`, sem alterar versões aplicadas. RPCs revalidam identidade, capacidade e escopo; RLS fecha acesso direto. Conversão comercial é atômica/idempotente e não aceita cliente/projeto incompatível.
- Ferramentas `area_registro_salvar` e `oportunidade_converter` nos catálogos comuns de Claude/Codex, com permit de chamada vinculado ao payload. Novas escritas exigem capacidade vigente; não promovem OK pontual a acesso permanente.
- Marketing usa tarefas/calendário reais; fontes gerais da Meta continuam separadas e exclusivas do proprietário. Financeiro lê observações autorizadas, inclusive concessão herdada por cliente, sem coletor novo ou totais incompatíveis.
- Removido editor de tarefas duplicado da área técnica. Navegação começa em Meu dia, preserva links e libera somente as telas operacionais autorizadas; cadastros globais e administração não são liberados.
- Métricas de Comercial/CS têm fórmula, população, fonte e IDs detalhados, com cálculo comum no backend/frontend e indisponibilidade sem denominador. Identidade entra na versão de cache para impedir reaproveitamento entre pessoas com permissões iguais.
- Testes locais com mocks e PGlite, sem produção ou serviços pagos; resultados e limites em `docs/integracao-painel-maia.md`. Banco remoto, push/merge, deploy e reinício não executados nesta etapa.

## 2026-10-16 — Painel colaborativo, carteira e planejamento concluídos

- Implementados API autenticada, identidade por login vinculada a pessoa cadastrada, papéis operacionais por escopo, RLS/RPCs, workflow e painel com Meu dia/Equipe/Coordenação/Planejamento/Indicadores/Direção.
- Reutiliza `work_tasks`, `people`, `maia_clients`, grupos/permissões e navegação existentes; adiciona migrations aditivas para relações, histórico, baseline, capacidade e catálogo de métricas. Criação manual no painel continua restrita.
- Concluídos editores de plano existente, contrato/projeto/entregável, calendário mensal, filtros, briefing, critérios, esforço, comentários, artefatos e dependências. Baseline original preservada após urgência/remoção e revisão de concorrência capturada ao editar.
- Corrigidos parâmetro SQL de redistribuição, atalhos de revisão/aprovação, inferência de acesso por equipe e exposição de projetos/entregáveis não necessários. Nova consulta `trabalho_contexto` nos dois executores e capacidade de revisão reconhecida na política do WhatsApp.
- Capacidade usa compromissos e disponibilidade da mesma semana; ausência de alocação/esforço não vira sobrecarga. Indicadores sem fontes configuradas exibem indisponibilidade, com catálogo completo.
- `db:guard` inclui worktree e arquivos novos; leitura de drift pode usar CLI autenticada, com projeto conferido e search_path fixado na transação de leitura.
- Verificação local: regras, tipos, 552 testes Vitest + 67 de banco, validação/guard das migrations e build aprovados. Aplicação remota e integração foram autorizadas pelo proprietário; evidência final no documento do painel. Worker não reiniciado nesta etapa.
- Matriz, métricas, limites e rollout: `docs/painel-colaborativo.md`.
- Banco aplicado por CLI com autorização do proprietário antes do merge do PR #21: duas migrations, 1697 objetos sem drift e 40 regras alinhadas ao catálogo. Sem publicação de conteúdo, mensagens reais ou reinício do worker.
- PR #21 integrado em `2fcd839`; CI da main aprovado, Vercel Production Ready e rotas de colaboração retornando 401 sem login. Checkout local atualizado; reinício do worker continua separado.

## 2026-10-16 — Aplicação das migrações do núcleo e preparação do rollout

- **Banco:** após autorização do owner, reconciliados dois pares de versões com SQL idêntico (`20261015131351`/`20261015123609` e `20261015131420`/`20261015124400`); aplicadas em ordem as migrations `20261016120000`, `20261016130000`, `20261016140000` e `20261016150000` no Supabase configurado no `.env` local.
- **Verificação:** o histórico remoto contém as versões locais; tabelas principais, função de acesso e RLS foram conferidas por leitura. Documentação de implantação atualizada para distinguir esquema aplicado de código publicado e worker atualizado.
- **Limite:** nenhuma mensagem, imagem ou publicação externa foi gerada; o worker não foi reiniciado. Testes comportamentais operacionais ainda dependem do código publicado e do worker atualizado.
- **Guard de migração:** a versão de acessos já aplicada troca `approvals_status_check` sem a marca textual; para não alterar SQL aplicado, o guard aceita apenas o hash SHA-256 exato dessa versão autorizada. Novas migrações destrutivas continuam bloqueadas sem aprovação e marcação.
- **Rollout concluído:** PR #19 integrado na `main` no commit `a5e31e4`; CI e deploy Production da Vercel aprovados. Um único worker local foi reiniciado em 16/10/2026, carregou a nova versão e voltou a aguardar a fila; a transcrição local permaneceu ativa.
- **Ainda pendente:** validação operacional controlada dos fluxos de histórico de membro, revogação e aprovação pontual. Nenhuma mensagem real foi enviada durante o reinício.

---

## 2026-10-16 — Núcleo persistente: integração local e segurança

- **Sintoma/causa:** a migração inicial permitia colisão de escopo quando `client_id` era nulo, impedia arquivar/reabrir múltiplas sessões e contratos de núcleo não estavam ligados aos handlers/worker/painel.
- **Correção:** migration compensatória `20261016130000_maia_nucleus_safety.sql`; sessões e busca com autorização atual, histórico de membros isolado e retenção, resumos com linhagem, ativação de skill pelo owner, reservas idempotentes para planos/rotinas/subagentes, tratamento de resultado externo incerto, painel autenticado e flags independentes no worker.
- **Limites:** MCP externo tem sondagem e chamadas de leitura explicitamente permitidas, mas ainda não é ferramenta dos executores; navegador/comandos isolados e gatilhos de resposta/arquivo privado continuam pendentes. Retomada por horário e contadores de cache Claude estão registrados na entrada seguinte. Nenhuma migration foi aplicada remotamente, nem integração ou rotina foi ativada.
- **Validação local:** `pnpm rules:check`, `pnpm typecheck`, `pnpm test` (530 Vitest + 50 banco temporário), `pnpm db:validate` (46 migrations), `pnpm db:guard` e `pnpm build` passaram. Sem mensagens reais, imagens ou chamadas pagas nos testes.

## 2026-10-16 — Cache de entrada do Claude e retomada de plano por horário

- **Mudança:** grava `cache_read_input_tokens` e `cache_creation_input_tokens` quando Claude CLI/SDK os informa; Codex e respostas sem esses campos permanecem nulos. O painel de modelos mostra as somas observadas. Sem estimativa ou promessa de economia.
- **Planos:** `plano_atualizar` aceita horário ISO futuro em até sete dias; o worker retoma por reserva idempotente a cada 30 segundos. Nenhum efeito incerto recebe replay.
- **Validação:** migration aditiva `20261016140000_maia_cache_usage.sql`; testes focados cobrem métricas e horário. A migration permanece local e não aplicada remotamente.

---

## 2026-10-16 — Núcleo persistente da Maia (preparação)

- **Continuidade:** adicionados contratos para sessões por canal/conversa/solicitante/cliente, mensagens com autoria/origem e resumos com cobertura; o histórico original permanece separado da memória do owner.
- **Procedimentos:** catálogo Markdown inicial em `skills/` e persistência de skills/propostas/uso, sem permitir que uma skill altere regras ou permissões.
- **Execução:** etapas de planos têm dependências, lease, evidência, bloqueio e estado externo incerto; subagentes e rotinas registram limites, vínculo pai/filho, concorrência e entrega separada.
- **Extensibilidade segura:** registro configurável de MCP e contrato para execução controlada, ambos com allowlist e desabilitados por padrão; catálogo HTTP existente permanece separado.
- **Banco:** migration aditiva `20261016120000_maia_nucleus_v1.sql`, com RLS e funções de reserva; não aplicada remotamente neste trabalho.
- **Validação:** testes locais cobrem orçamento/linhagem, isolamento por ferramentas, dependências, cron, allowlist MCP e bloqueio padrão da execução controlada. Resultados completos ficam no handoff após a execução dos comandos exigidos.

---

## 2026-10-15 — Trabalhos criativos retomáveis

- **Sintoma/causa:** pedidos de imagem eram executados de forma síncrona dentro do turno do agente; séries longas podiam exceder o timeout e perder progresso, sem checkpoint separado por arte.
- **Implementação:** pedidos explícitos passam a criar um job idempotente por tarefa e itens individuais. O worker local gera uma imagem de cada vez, guarda checkpoint em diretório determinístico e retoma uma arte pronta sem regenerar. Ferramentas antigas `gerar_imagem` também enfileiram um job de um item.
- **Segurança/entrega:** trabalhos e briefings ficam em tabelas com RLS, acessíveis apenas por `service_role`; o endpoint do painel não devolve briefing nem caminho local completo. O worker envia rascunhos só ao owner, nunca publica automaticamente. Se o resultado de um envio for incerto, não repete às cegas.
- **Painel/docs:** a página de tarefas mostra estado global e progresso por arte. Procedimento, limites de retenção, recuperação e rollback estão em `docs/trabalhos-criativos-retomaveis.md`.
- **Banco/rollout:** `20261015140811_maia_resumable_creative_jobs.sql` foi aplicada no projeto Agent Maia; RLS, privilégios e RPCs foram verificados. O código está no PR #17; após merge/publicação, ainda é preciso atualizar e reiniciar o worker local.
- **Validação:** `pnpm test` passou com 520+ testes Vitest e 40 testes PostgreSQL locais; `pnpm build` e `pnpm db:guard` passaram. Nenhuma geração ou mensagem real foi executada no smoke test.

---

## 2026-10-15 — Confiabilidade e verificação de envios WhatsApp

- **Repetição:** o controle de acesso compara destino e HMAC-SHA-256 (chave `EVOLUTION_API_KEY`) do texto na janela de 24 horas; não persiste conteúdo claro. Duplicatas exigem aprovação explícita do owner, inclusive no grupo. Falha ao consultar histórico aborta antes do envio. A regra vigente proíbe retry automático quando o estado é incerto.
- **Recibos:** IDs aceitos em helpers compartilhados de envio são registrados; `MESSAGES_UPDATE` é convertido em metadados mínimos e processado sem invocar IA. Estados aceitos seguem códigos Baileys explícitos; callbacks duplicados são deduplicados e updates atrasados não rebaixam leitura.
- **Agente e painel:** ferramenta owner-only `mensagem_status` nos executores Claude e Codex; workspace autenticado e página de tarefas exibem os 50 status mais recentes sem conteúdo da mensagem ou telefone completo.
- **Banco/configuração:** migration aditiva `20261015123609_outbound_message_receipts.sql`, migration versionada da regra e atualização das verificações essenciais. Recibos técnicos são expurgados após 30 dias pelo worker. A instância Evolution precisa emitir `MESSAGES_UPDATE` (com `webhook_by_events=false` para a rota atual); o worker local precisa ser atualizado e reiniciado.
- **Validação:** pendente até executar typecheck, testes, validação de migrations e build após esta alteração. Migration ainda não aplicada em produção; nenhum envio real foi realizado nos testes.
- **Rollout:** abrir PR, aguardar checks, pedir autorização específica para migration, aplicar antes do merge/deploy; então habilitar evento Evolution e fazer smoke test com destino de teste.

---

## 2026-10-15 — Evitar resposta duplicada em grupos do WhatsApp

- **Sintoma:** em um pedido no grupo, a Maia publicava texto pela ferramenta `grupo_enviar_texto` e também enviava a resposta final automática ao mesmo grupo.
- **Causa:** a ferramenta enviava diretamente, mas `handleGroupMessage` sempre entregava o texto final pelo outbox, sem verificar se a mesma tarefa já havia escrito naquele grupo.
- **Correção:** Claude e Codex registram evento de sucesso associado à tarefa e ao JID do destino. O handler suprime a segunda resposta apenas para o mesmo grupo; preserva respostas para grupos diferentes. Se a verificação falhar, não envia outro texto potencialmente duplicado e marca a tarefa como incerta.
- **Validação:** `pnpm typecheck` e `pnpm build` passaram; `NODE_OPTIONS=--experimental-strip-types pnpm test` passou com 507 testes Vitest e 36 testes de banco. Testes de regressão cobrem resposta já enviada, envio a outro grupo, caminho de erro e falha de consulta.
- **Rollout:** a branch precisa ser integrada e o worker local atualizado/reiniciado para ativar a correção; nenhuma mensagem real foi enviada nos testes.

---

## 2026-10-15 — Memória sincronizada entre agente e painel

- **Motivação:** as conversas eram persistidas, mas o prompt só levava 14 falas selecionadas das 60 últimas, de modo que conversas movimentadas podiam desaparecer do contexto sem serem apagadas do banco.
- **Contexto:** janela privada ampliada para 24 h; seleção de até 48 falas com orçamento total de 28 mil caracteres e 160 linhas carregadas. Memórias ativas são carregadas independentemente do histórico recente.
- **Banco/agente:** migração aditiva `20261015005000_maia_owner_memory.sql` cria `owner_memories`, com revisão, status, prazo, origem e RLS. Claude e Codex recebem ferramentas owner-only para busca e registro de compromissos explícitos; memória não confirma execução.
- **Painel:** nova página **Agente Maia > Memória e combinados**, conectada ao endpoint de workspace autenticado para listar, criar, concluir, arquivar e reativar registros na mesma tabela.
- **Documentação/plano:** README e guia de migrações atualizados; plano detalhado em `docs/plano-memoria-sincronizada.md`.
- **Segurança/rollout:** migration aplicada em produção por workflow protegido após aprovação explícita do owner; antes do deploy do código que a consulta. A tabela não expõe acesso a `anon`/`authenticated` e tem RLS habilitado.
- **Validação:** `pnpm typecheck` e `pnpm build` passaram; `node --experimental-strip-types scripts/db/validate.ts` aplicou as 40 migrações em banco temporário; `NODE_OPTIONS=--experimental-strip-types pnpm test` passou (501 testes Vitest + 36 testes de banco). O sandbox está em Node 22.13, que exige essa opção experimental para executar scripts `.ts` nativos; sem ela, os scripts padrão falham antes de iniciar.
- **Ledger/rollout:** o primeiro dry-run encontrou quatro versões remotas com timestamps diferentes dos arquivos locais. Após conferir o schema e o hash da regra, a reconciliação autorizada do ledger foi executada pelo workflow `38664093265`; o dry-run listou somente `20261015005000_maia_owner_memory.sql`. A aplicação e o `db:drift` concluíram com sucesso no workflow `38664184391`; a tabela, as colunas e o RLS foram verificados em leitura.
- **Deploy do código:** o PR #14 ainda precisa ser integrado para publicar o código do agente e do painel; executar smoke test após o deploy. Esta alteração não recupera mensagens que já tenham sido apagadas de `messages`/`inbox`.

---

## 2026-10-13 — Etapa 0 Vibe Code: contratos compartilhados e novos departamentos

- **Motivação:** implementação do Plano 01 + Plano 02 começa pela fundação: contratos TypeScript compartilhados entre os dois planos e reorganização da navegação do painel.
- **`src/lib/operationalContext.ts`:** contrato TypeScript central — `OperationalArea`, `OperationalContext`, `DataProvenance`, `AREA_LABELS`, `AREA_VALUES`. Toda tarefa, plano e ação da Maia pode ter contexto organizacional opcional; nunca adivinha cliente a partir do texto.
- **`src/lib/navigation.ts`:** 10 seções (antes 7). Adicionados **Comercial** (oportunidades, funil), **Projetos** (projetos, implementações) e **Financeiro** (receitas, custos). "Grupos e clientes" renomeado para **Clientes e CS** (clientes, grupos). Redirects de legado para `#grupos-clientes/*`.
- **`src/features/departments/DepartmentPages.tsx`:** 6 novas páginas com estados honestos ("Não conectado", "Sem dados disponíveis") — nenhum dado simulado.
- **`src/App.tsx`:** ícones `TrendingUp`, `Layers`, `Landmark` (lucide-react); lazy imports; novos casos no `Screen` switch.
- **`supabase/migrations/20261013210000`:** colunas `area`, `client_id`, `project_id` opcionais em `work_tasks` (aditivo, todos nullable).
- **Verificação:** `pnpm typecheck`, `pnpm build`, `pnpm db:validate`, `pnpm test` (495/495). Commit `d13d339`, pushed.

---

## 2026-10-13 — Ferramenta `planilha_criar` (xlsx formatado via exceljs)

- **Motivação:** o agente não tinha ferramenta dedicada para criar planilhas. Quando recebia um pedido de xlsx, improvisava com Python — que está bloqueado no modo operacional — resultando em datas como número serial (ex.: `46308` em vez de `13/10/2026`), fórmulas com `#ERROR!` e dezenas de linhas em branco desnecessárias.
- **O que foi feito:** adicionado `server/planilha.ts` com geração nativa via `exceljs 4.4.0` (Node.js puro, sem Bash). Ferramenta `mcp__maia__planilha_criar` registrada em `maiaImageTool.ts` e `codexMaiaMcp.ts` (paridade Claude/Codex). Dependência instalada via pnpm.
- **Formatação automática:**
  - Strings ISO 8601 → `Date` com `numFmt DD/MM/AAAA` (nunca mais número serial).
  - Strings começando com `=` → fórmula Excel nativa (`=COUNTIF(...)` funciona).
  - Colunas cujo cabeçalho contém "valor", "r$", "total", "fixo", "comissão" → `"R$" #,##0.00`.
  - Colunas cujo cabeçalho contém "%" ou "taxa" → `0.00%`.
- **Estilo:** cabeçalho azul escuro (#1A1A2E) com texto branco, negrito; linhas alternadas (azul claro); bordas finas em todas as células; freeze da linha de cabeçalho; largura automática (máx. 55).
- **Entrega:** o arquivo é salvo em `data/midia/` e enviado via `sendFile()` como documento ao número do owner.
- **Verificação:** `pnpm typecheck` sem erros. Commit `7f3e739`, pushed para GitHub.
- **Pendências:** teste ao vivo com um pedido real pelo WhatsApp após reiniciar o worker.

---

## 2026-10-13 — Link de convite enviado ao número errado (dono em vez do Ítalo)

- **Sintoma:** no teste "Projeto Italo Teste 2", o pedido dizia "manda para o Ítalo" e o contato "Ítalo" existia na agenda com o número certo. A Maia mandou o link de convite ao número 2658, que é o segundo número do próprio dono (contato "Herickson maia"). O plano #3 ficou esperando esse número entrar no grupo, o que dispararia as boas-vindas quando o próprio dono entrasse.
- **Causa provável:** o contexto do pedido novo incluiu o pedido antigo "Projeto Italo Personal", que dizia "manda para o Herickson 85998372658". O agente usou esse número em vez do que estava na agenda para "Ítalo". Não houve checagem de que o destinatário é o dono.
- **Correção feita agora:** plano #3 cancelado no banco, com nota explicando o erro. O link não foi reenviado ao Ítalo: enviar a uma pessoa de fora precisa do OK do dono.
- **Correção pendente (ainda não implementada):** (1) ao enviar mensagem a um contato, usar o número da agenda que casa com o nome pedido, e não números de pedidos anteriores; (2) recusar envio para número do próprio dono, salvo confirmação explícita.
- **Também observado:** depois de o dono aprovar a criação do grupo, a Maia mandou um segundo aviso "aguardando aprovação", que confunde. Não foi corrigido.

## 2026-10-13 — Validação ao vivo: PDF no grupo continua o plano

- **Resultado do teste (grupo "Projeto Italo Teste", plano #2):** o PDF enviado pelo número 2658 chegou à fila às 02:56, o sistema reconheceu que o plano esperava um arquivo daquele grupo e daquele número, baixou e leu o arquivo, chamou a Maia (tarefa 401, "Continuação do plano #2") e ela mandou a análise no grupo e respondeu ao dono às 02:58. O plano #2 terminou concluído, com as 5 etapas feitas.
- **Validado:** criação de grupo com OK do dono, plano gravado e retomado sozinho depois do OK, link enviado sem pedir de novo, gatilho de arquivo no grupo, leitura de PDF e continuação do plano sem o dono avisar.
- **Não validado ainda:** a entrada de alguém no grupo retomando o plano sozinha com o identificador interno (@lid) já resolvido para telefone. Nesse teste a entrada ocorreu antes da correção, então o fluxo caiu no aviso "Quer que eu dê as boas-vindas?". Repetir com um grupo novo e outra pessoa entrando pelo link.
- **Observação:** o plano #2 foi ajustado à mão para esperar o arquivo (a Maia tinha seguido o caminho manual depois do "Sim" do dono); no fluxo normal, a retomada pela entrada orienta a Maia a marcar essa espera.

## 2026-10-13 — Entrada em grupo pelo identificador interno (@lid) retoma o plano

- **Sintoma (teste ao vivo, grupo "Projeto Italo Teste", plano #2):** o plano foi gravado, o OK criou o grupo e a Maia mandou o link sozinha. Mas quando a pessoa entrou, o plano não retomou: a Maia só perguntou "Quer que eu dê as boas-vindas?". Depois da sua resposta "Sim", ela fez as boas-vindas à mão e prometeu "leio o PDF, sem precisar me avisar", mas o plano continuava esperando a **entrada**, não o arquivo; o PDF enviado pelo número 2658 foi ignorado.
- **Causa:** a Evolution informou quem entrou pelo identificador interno do WhatsApp (`...@lid`, 15 dígitos), não pelo telefone. O plano esperava o telefone, então não casou. A lista de participantes da Evolution traz os dois (`id` @lid e `phoneNumber`), mas o código lia só o `id`. Isso também fazia `mencionar_todos` descartar essas pessoas (um @lid não passa no filtro de 12 a 13 dígitos).
- **Correção:** `fetchGroupParticipants` agora usa `phoneNumber` como número e guarda o `lid`; `groupJoinFrom` lê `phoneNumber` quando o participante vem como objeto; `resolveJoinNumbers` (`server/groupJoin.ts`) troca um identificador interno pelo telefone da lista de participantes do grupo (duas tentativas, 2 s entre elas). Se mesmo assim não casar com o plano, o aviso ao dono cita o plano que esperava uma entrada ("responda Sim e eu sigo o plano").
- **Verificação:** `pnpm typecheck` e `vitest` (495 testes, com os casos do identificador interno em `tests/grupoEntrada.test.ts`).
- **Observação:** o formato real foi conferido lendo a lista de participantes na Evolution (campos `id`, `phoneNumber`, `admin`, `name`, `imgUrl`). O evento do webhook em si ainda não foi capturado; a correção cobre tanto o telefone no evento quanto só o identificador.
- **Pendências:** repetir o teste ao vivo (entrada e PDF); a promessa "sem precisar me avisar" no caminho manual só é verdadeira se o plano estiver esperando o arquivo.

## 2026-10-13 — Teste de comportamento do agente e correções

- **Método:** rodei o agente de verdade (Claude CLI, mesmo prompt de sistema e mesmas descrições de ferramenta) com o servidor real de ferramentas, trocando só os efeitos por respostas simuladas. Nada foi enviado, criado ou gravado. Cinco cenários: Projeto Italo com várias etapas, grupo sem participantes, número sem o 55, renomear grupo (função inexistente) e mensagem com aviso de resposta.
- **Achados antes da correção:** (1) o agente gravou o plano mas criou o grupo só com o Ítalo, sem o dono, contra o pedido de mandar o link depois, e disse "grupo criado com o Italo já dentro"; (2) ao renomear grupo, disse "não tenho essa ferramenta"; (3) ao pedir "me avisa quando ele responder", disse que não conseguia monitorar, embora o repasse automático exista (a regra de não prometer o fez prometer de menos); (4) um número sem o 55 não era achado na agenda.
- **Correções:** o dono entra automaticamente em todo grupo criado pela Maia (`participantsWithOwner`); `participantes` passa a ser opcional e só traz outras pessoas que entram na criação (quem será convidado por link não entra). Número DDD + número sem o 55 ganha o DDI na agenda e no cadastro (`withCountryCode`). O prompt lista o repasse automático ao dono (até 48 h) como mecanismo real, manda confiar no resultado de uma ação que diz que algo acontece sozinho e proíbe a palavra "ferramenta" ao falar com o dono ("ainda não consigo renomear grupos").
- **Depois da correção (mesmos cenários):** Projeto Italo: plano gravado, contato salvo, grupo só com o dono, link depois; renomear grupo: "Ainda não consigo renomear grupos", com o caminho manual; aviso de resposta: "a resposta chega automaticamente pra você"; grupo sem participantes: pergunta quem entra, oferecendo criar só com o dono; número sem o 55: pede só o nome.
- **Verificação:** `pnpm typecheck` e `vitest` (491 testes, com `tests/comportamentoTestado.test.ts`).
- **Limites do teste:** as ferramentas são simuladas, então não valida a entrega real nem as aprovações; cenários de um turno só (a retomada do plano depois do OK não foi exercitada com o agente). Um agente é probabilístico: o resultado de um cenário pode variar entre execuções.

## 2026-10-13 — Seguir o plano sempre; se não puder, dizer o que falta

- **Decisão do dono:** a Maia segue sempre o plano. Quando não conseguir cumprir uma etapa, deve afirmar que não é permitido (ou possível) e dizer o que é preciso para ter acesso, em vez de improvisar ou prometer.
- **Mudança:** linha fixa no prompt (`server/rules.ts`) e no texto de retomada do plano (`server/plans.ts`): seguir o plano na ordem, sem pular etapa nem trocar de caminho; se não puder, dizer com clareza que não é permitido e exatamente o que falta (qual permissão, quem aprova, o que o dono precisa enviar ou avisar). Testes em `tests/semPromessa.test.ts` e `tests/planos.test.ts`.
- **Limite:** é instrução ao agente, não uma trava no código; a obrigatoriedade do plano em pedidos com várias etapas segue pendente.

## 2026-10-13 — Arquivo no grupo continua o plano; a Maia não promete o que não executa

- **Sintoma:** o dono mandou o PDF do Ítalo no grupo "Projeto Italo Personal" e a Maia tinha prometido "quando ele mandar o PDF, leio e trago sugestões". O PDF foi descartado: o webhook só tratava texto e áudio em grupo, e mídia virava um evento vazio. Não havia plano gravado e nenhum gatilho de arquivo, então a promessa era impossível de cumprir.
- **Decisões do dono:** arquivos de grupo ficam 24 horas (não 7 dias); o agente não deve prometer o que não tem como executar.
- **Correção (arquivo):** `server/inbox.ts` enfileira documento, imagem e vídeo de grupo cadastrado como referência (sem baixar). `handleGroupMedia` (`server/ownerRouter.ts`) só baixa e lê se um plano ativo espera um arquivo daquele grupo e daquele número (`waitingForFile`); o arquivo fica 24 h em `data/midia` (mesma pasta e retenção da mídia do dono). O plano retoma uma vez com o conteúdo, marcado como informação de terceiro, nunca ordem. Novo gatilho `file_received` em `server/plans.ts` e `esperar: arquivo_no_grupo` em `plano_atualizar`. A leitura do arquivo foi extraída para `understandMedia` (o comportamento do dono não mudou). Sem plano esperando, nada é baixado, como antes.
- **Correção (promessa):** `server/rules.ts` ganhou uma linha fixa no prompt (como a de permissões): só continuam sozinhos um plano com gatilho, lembretes e tarefas agendadas; fora disso a Maia diz o que o dono precisa fazer. Também manda explicar bloqueios em português natural, sem citar ferramenta. `requestCreateGroup` avisa a Maia, no resultado, quando não há plano gravado: "NADA continua sozinho depois do OK".
- **Arquivos:** `server/plans.ts`, `server/planTools.ts`, `server/inbox.ts`, `server/inboxWorker.ts`, `server/ownerRouter.ts`, `server/media.ts`, `server/rules.ts`, `server/groups.ts`, `server/maiaImageTool.ts`, `server/codexMaiaMcp.ts`, `CLAUDE.md`, testes.
- **Verificação:** `pnpm typecheck` e `vitest` (485 testes) passando.
- **Pendências:** o PDF já enviado antes desta mudança não pode ser recuperado (nada foi guardado) e precisa ser reenviado com um plano esperando; teste ao vivo; a criação de grupo ainda não obriga o plano em pedidos com várias etapas.

## 2026-10-13 — Modelo econômico (Haiku) só para pedido curto e de uma ação

- **Sintoma:** a Maia parecia burra em pedidos difíceis.
- **Causa:** qualquer mensagem com a palavra "resumo" era classificada como simples e ia ao Haiku, mesmo com várias etapas (ex.: "resume a conversa, depois cria o grupo e manda o link"). O restante (pedidos de ação, consultas, planos) já ia ao modelo principal, que na conta é o Sonnet 4.6.
- **Correção:** "resumo" só é simples quando a mensagem tem até 100 caracteres e não tem sinais de várias etapas (depois, quando, em seguida, primeiro, segundo, plano, "e crie/manda/envie..."). Caso contrário, vai ao modelo principal. Cumprimentos curtos continuam no econômico.
- **Verificação:** `pnpm typecheck` e `vitest` (480 testes, incluindo `tests/modeloEconomico.test.ts`).

## 2026-10-13 — Pedido do dono é aprovado só pelo dono

- **Sintoma:** os pedidos de criação de grupo feitos pelo dono iam para todos os que têm permissão de aprovar, inclusive a Gessica. O dono disse que a aprovação dele tem que ser dele, não de outra pessoa.
- **Causa:** `requestCreateGroup` enviava o pedido para `approverNumbers` (todos com `escrita.aprovar`), sem distinguir quem pediu.
- **Correção:** novo `ownerNumbers` (pessoa com papel `proprietario` mais o número do `.env`). O pedido do dono vai só para os números dele. Pedidos de outras pessoas, fora do escopo, continuam indo para os aprovadores.
- **Permissões:** nenhuma regra de ninguém foi alterada. Uma remoção feita por engano na Gessica foi desfeita com a mesma linha (`escrita.aprovar`).
- **Verificação:** `pnpm typecheck` e `vitest` (476 testes) passando.
- **Pendência:** a Maia reconhece como dono só o número do `.env`. Se o dono responder OK pelo segundo número (2658), a resposta pode não ser reconhecida como dele; confirmar com um teste.

## 2026-10-13 — Planos de várias etapas retomam sozinhos

- **Sintoma:** o dono mandou "crie o grupo Projeto Italo, pegue o link e mande a ele no privado, dê boas-vindas quando ele entrar e peça o PDF". A Maia pediu a aprovação da criação, prometeu "assim que confirmado, pego o link e mando", e parou: depois do OK nada a chamou de volta. O mesmo padrão da promessa "te aviso quando o João responder".
- **Causa:** o agente termina o trabalho ao abrir o pedido de aprovação; o OK é tratado pelo fluxo de aprovação (`handleApproverText`), que cria o grupo mas não retoma o agente. Não existia nenhum registro do plano, então as etapas seguintes não tinham quem as executasse.
- **Correção (decisão do dono: o agente segue o plano dentro do que foi proposto, sem roteiro fixo no código):**
  - Migração `20261013012115_maia_plans` (aplicada em produção com `supabase db push` e conferida com `db:drift`, 811 objetos iguais): tabela `maia_plans` com pedido do dono, etapas, o que o plano espera (`waiting`) e contexto. RLS ligada, acesso só pelo servidor.
  - `server/plans.ts`: criar, atualizar, reservar e retomar planos. Cada plano é reservado antes de retomar, então um evento repetido não executa a etapa duas vezes. Plano parado há mais de 7 dias é cancelado em vez de retomar. Recusa ou expiração do OK cancelam o plano e avisam o dono.
  - Ferramentas `plano_criar`, `plano_atualizar` e `planos_ativos` (só dono, nos dois executores, lógica em `server/planTools.ts`) e o parâmetro `plano` em `grupo_criar`: depois do OK, o grupo é criado e a Maia é chamada de volta com o pedido original, as etapas e o grupo criado, para executar só a próxima etapa.
  - Gatilho de entrada no grupo (`server/groupJoin.ts`): se um plano esperava aquela pessoa entrar, o plano segue (boas-vindas e demais etapas) em vez de só perguntar ao dono.
  - A mensagem de retomada diz que não é uma mensagem nova do dono e manda perguntar se faltar informação ou algo fugir do pedido.
- **Verificação:** `pnpm typecheck`, `vitest` (476 testes, com `tests/planos.test.ts`), `db:validate` (35 migrações) e os 35 testes de banco passando.
- **Limites (honestos):** só há dois gatilhos, o OK da criação de grupo e alguém entrar no grupo. Ainda não há gatilho para arquivo recebido (o PDF do Ítalo): mídia enviada dentro de grupo não é processada hoje. A descrição das ferramentas manda a Maia deixar essa etapa pendente e avisar o dono, sem prometer que continua sozinha. A retomada usa o mesmo executor do dono; envio de mensagem a terceiros segue a política atual de aprovação. Não testado ao vivo.
- **Observação:** ficou na tabela um plano de teste (`id 1`, cancelado) criado na conferência.

## 2026-10-13 — Entrada em grupo cadastrado avisa o dono

- **Sintoma:** a Maia não percebia quando alguém entrava no grupo (ex.: o Ítalo), então não avisava o dono para dar as boas-vindas.
- **Causa:** o webhook reconhecia `group-participants.update` só com o nome exato em minúsculas com ponto, e tratava qualquer evento de grupo apenas como reset de cache. A Evolution envia o evento de participantes com a ação `add` (entrou) e `remove` (saiu).
- **Correção:** `classify` aceita o nome com ponto e o em maiúsculas com `_`; `groupJoinFrom` extrai grupo, ação e números; uma entrada (`add`) vira evento na fila com o join; o worker invalida o cache e, se o grupo estiver cadastrado, avisa o dono com o nome da agenda: "Fulano (+número) entrou no grupo X. Quer que eu dê as boas-vindas?". O dono não é avisado de si mesmo, e a Maia não dá boas-vindas sem perguntar.
- **Arquivos:** `server/evolutionWebhook.ts`, `server/inbox.ts`, `server/groupJoin.ts`, `server/inboxWorker.ts`, `tests/grupoEntrada.test.ts`.
- **Verificação:** `pnpm typecheck` e `vitest` (466 testes) passando.
- **Atenção:** o formato exato do payload da Evolution (`data.id`, `data.action`, `data.participants`) foi inferido da documentação, não de um evento real capturado. Confirmar com um teste ao vivo (adicionar alguém a um grupo cadastrado) antes de considerar fechado. Eventos repetidos da Evolution não são deduplicados, porque o evento não tem `key_id`.

## 2026-10-13 — Aprovação de grupo mostra quem entra; sem padrão fixo de execução

- **Sintoma:** o dono pediu para criar o grupo "Projeto Ítalo" e depois mandar o convite ao Ítalo no privado. O agente disse que mandaria o convite, mas o pedido de criação (#9) já levava o Ítalo e o dono como participantes, e a aprovação só dizia "2 participante(s)". O Ítalo entrou direto e o convite foi desnecessário.
- **Causa:** o agente sabia que o grupo precisa de alguém além dele (incluiu o dono), mas também incluiu o Ítalo, contra o que ele próprio tinha anunciado, e não perguntou quem deveria entrar na criação. A mensagem de aprovação escondia a lista, então o erro passou. O pedido do dono também não dizia quem entrava primeiro.
- **Decisão do dono:** não impor um padrão fixo de execução; o agente deve entender o pedido e perguntar quando for ambíguo.
- **Correção:** `requestCreateGroup` (`server/groups.ts`) lista cada participante com nome da agenda e número, e avisa que a Maia entra por ser quem cria; a resposta devolvida ao agente repete a lista. A descrição de `grupo_criar` (Claude e Codex) traz só fatos (participantes entram na criação, a Maia entra sozinha, o WhatsApp exige ao menos um participante além dela) e manda perguntar ao dono quando não estiver claro quem entra, sem ditar o fluxo.
- **Verificação:** `pnpm typecheck` e `vitest` (460 testes, com `tests/grupoCriarAprovacao.test.ts`) passando.
- **Pendências:** a Maia não percebe quando alguém entra no grupo (as boas-vindas dependem do dono avisar); texto de mensagem enviada a terceiros ainda pode sair sem o OK do dono quando ele pede o envio.

## 2026-10-12 — grupo_criar no executor do Claude

- **Sintoma:** o dono pediu para criar o grupo "Projeto Ítalo"; a Maia respondeu que não tinha a ferramenta de criar grupo no executor.
- **Causa:** `grupo_criar` existia só na ponte do Codex (`server/codexMaiaMcp.ts`). O executor principal (Claude, `server/maiaImageTool.ts`) não tinha a ferramenta, o que quebra a regra do `CLAUDE.md` de manter as ferramentas nos dois executores.
- **Correção:** `grupo_criar` adicionada ao `maiaImageTool.ts` com o mesmo fluxo do Codex: só o owner, só pelo WhatsApp, e a criação aguarda o OK do aprovador (`requestCreateGroup`) antes de sair para a Evolution.
- **Verificação:** `pnpm typecheck` e `vitest` (459 testes, incluindo o de paridade) passando.

## 2026-10-12 — Transcrição de áudio pelo Whisper local (no PC)

- **Decisão do dono:** usar o Whisper do próprio PC em vez do servidor da VPS. O áudio fica na máquina do dono; nada sai para fora.
- **O que entrou:** `scripts/whisper_local.py`, um servidor de transcrição em `127.0.0.1:8000` com o mesmo contrato do servidor antigo (`POST /transcribe` com `audio_file`, resposta `{"text": ...}`) e `GET /health`. Usa o faster-whisper com o modelo `small` já instalado no PC, em CPU (int8), carregado só do cache local. A biblioteca padrão do Python atende as requisições, sem FastAPI, porque o disco do C: tinha 0,3 GB livres.
- **Configuração:** `WHISPER_API_URL=http://127.0.0.1:8000` no `.env` (o `.env` não vai para o git). Para voltar à VPS, basta trocar esse valor de volta e reiniciar o worker.
- **Teste:** fala sintética de 18 s transcrita em ~5 s, com texto correto. O `/health` respondeu `model_loaded: true`.
- **Sobe sozinho:** `scripts/start-worker.ts` inicia `whisper_local.py` junto com o worker quando `WHISPER_API_URL` aponta para 127.0.0.1 (não sobe outro se já houver um respondendo). Reinicia até 5 vezes seguidas. Se cair de vez, os áudios vão para a retomada de 24 h.
- **Pendências:** o modelo `large-v3` ainda não está no PC (não foi encontrado; falta espaço no C:); decidir se o `small` local basta; teste ao vivo com um áudio do WhatsApp.

## 2026-10-12 — Áudio: falha rápida e retomada quando o Whisper volta

- **Sintoma:** o dono mandou um áudio de 59 s; a Maia não reagiu e o pedido ficou sem resposta. Um áudio anterior (21:21 UTC) só gerou "Não consegui processar o áudio agora" depois de 8,4 min.
- **Causa:** o servidor Whisper do EasyPanel responde na página inicial (HTTP 200), mas não conclui a transcrição (um tom de 5 s não terminou em 200 s). Cada tentativa esperava 240 s e havia uma segunda tentativa após 20 s, chegando a cerca de 8 min de silêncio. O áudio original era descartado, então nada podia ser retomado.
- **Correção:** `server/transcribe.ts` — 120 s por tentativa, 10 s de espera e sem repetir quando estoura o tempo (pior caso ~2 min). `server/ownerRouter.ts` — se a transcrição falha, avisa na hora e guarda o áudio. Novo `server/audioRetry.ts` — o áudio fica em `data/midia` por 24 h (mesma retenção da mídia do dono), e o worker tenta de novo a cada 10 min, um por vez; quando consegue, mostra o texto ao dono e apaga o áudio. Não executa o pedido sozinho: um pedido atrasado pode já não valer.
- **Arquivos:** `server/transcribe.ts`, `server/audioRetry.ts`, `server/ownerRouter.ts`, `server/inboxWorker.ts`, `tests/transcribe.test.ts`, `tests/audioRetry.test.ts`.
- **Verificação:** `pnpm typecheck` e `vitest` (455 testes) passando.
- **Membro (mesmo dia):** a retomada vale também para áudio de membro. Um `.json` ao lado do áudio guarda quem mandou; o membro recebe na hora "Não consegui ouvir seu áudio agora. Guardei por 24 h e te respondo..." e, quando o servidor volta, o texto vira a mensagem dele via `resumeMemberAudio` (confere de novo a permissão `conversa.maia`, grava na conversa e segue `handleMemberMessage`, dentro das permissões e aprovações dele). O dono não é avisado nesse caso. Áudio guardado pela versão anterior, sem o `.json`, é tratado como do dono. Testes: 457 passando.
- **Grupo (mesmo dia):** a retomada vale também para áudio em grupo cadastrado. O `.json` guarda grupo, autor, nome, se a mensagem era para a Maia, horário original e id da mensagem. No grupo, só avisa quem estava falando com a Maia (menção, resposta a ela ou conversa em andamento): "{nome}, não consegui ouvir seu áudio agora. Guardei por 24 h e te respondo aqui..."; os demais áudios continuam em silêncio, como antes. Quando o servidor volta, `resumeGroupAudio` confere o escopo do grupo, grava na memória com a autoria e o horário originais e só responde se a Maia foi chamada (menção, resposta, conversa em andamento ou o nome dela no texto). O áudio de grupo agora também passa o id da mensagem (`keyId`), então a Maia pode citar o áudio com `citar_id`. Testes: 458 passando.
- **Whisper reiniciado (mesmo dia):** o serviço `whisper-api` (compose, projeto `n8n` do EasyPanel) foi reiniciado pelo MCP do EasyPanel, a pedido do dono. Voltou com o modelo carregado em ~70 s (`/health`: `model_loaded: true`). Medido depois do reinício: 5 s de áudio levam ~36–44 s para transcrever; um áudio de 30 s e um de 18 s de fala não terminaram em 110–200 s. No momento da consulta o servidor tinha 4 núcleos com 99% de CPU usada. O servidor processa um áudio por vez, então pedidos abandonados por timeout continuam ocupando a fila.
- **Limite da retomada:** a retomada em segundo plano (`retryPendingAudio`) agora usa 360 s por tentativa (`transcriberFromEnv(timeoutMs)`), porque ninguém espera por ela e um áudio longo pode levar minutos; o atendimento ao vivo continua em 120 s. Testes: 459 passando.
- **Pendências:** o Whisper `small` em CPU é lento para o tamanho do servidor; avaliar o modelo `base`, mais CPU dedicada ou um serviço de transcrição externo (decisão do dono, pois o áudio hoje não sai do servidor dele); teste ao vivo da retomada (membro e grupo).

## 2026-10-12 — Contato avulso e repasse da resposta a quem a Maia procurou

- **Sintoma:** o dono pediu para a Maia mandar mensagem ao João (contato avulso). A Maia prometeu avisar quando ele respondesse e não avisou; só contou quando o dono perguntou.
- **Causa:** `contato_enviar_mensagem` exige o número na agenda e a única ferramenta para salvar era `membro_cadastrar`, que sempre cria Pessoa com role `equipe` e as permissões `conversa.maia` e `resumo.ver`. A resposta do João entrou na fila como `member`, e o caminho de membro não repassa ao dono (o repasse "fulano respondeu: ..." só existia para quem não é cadastrado). A promessa "Se ele responder, eu repasso ao owner" é texto fixo da ferramenta de envio. Além disso, a resposta chegou sem o nono dígito (`558597292636`) e o `outreach` tinha o número com ele (`5585997292636`).
- **Correção:** nova ferramenta `contato_salvar` (Claude e Codex), só dono, que grava só em `contacts`, sem Pessoa, papel ou permissão. `membro_cadastrar` passa a ser só para quando o dono pedir expressamente para adicionar alguém como membro da equipe. Novo `hasRecentOutreach` (compara número canônico, com ou sem nono dígito) e `relayIfContacted` no worker: texto, áudio e mídia de um membro que a Maia procurou nas últimas 48 h agora também são repassados ao dono. A mensagem de erro de `resolveContact` aponta para `contato_salvar`.
- **Arquivos:** `server/contacts.ts`, `server/inboxWorker.ts`, `server/maiaImageTool.ts`, `server/codexMaiaMcp.ts`, `server/access.ts`, `server/actionDescriptions.ts`, `tests/contatoAvulso.test.ts`; `tests/contexto.test.ts` ajustado para a janela de 12 h.
- **Verificação:** `pnpm typecheck` e `vitest` (450 testes) passando.
- **Pendências:** remover o cadastro de equipe do João em produção (Pessoas, números e as permissões `conversa.maia`/`resumo.ver`), mantendo só o contato na agenda; áudio e mídia de quem não é membro (contato avulso) ainda não são repassados; reiniciar o worker; teste ao vivo.

## 2026-10-12 — Subir criativo do WhatsApp direto nos anúncios

- **O que é:** o dono manda uma imagem ou vídeo no WhatsApp com a legenda do que quer anunciar; a Maia usa `anuncio_midia_url_temporaria` para gerar um link temporário (2h) no Supabase Storage e então passa esse link para `ads_creative_upload_media` (Meta Ads MCP) com `upload_source: URL`.
- **Já existia:** `server/integrations/adsMedia.ts` (bucket `ads_media_temp`, limpeza a cada ciclo do worker), a ferramenta no servidor da Maia e a menção no prompt de vídeo.
- **O que faltava:** o prompt de imagem não mencionava a ferramenta; adicionado agora.
- **Fluxo:** imagem/vídeo recebido → `anuncio_midia_url_temporaria` → URL Supabase Storage → `ads_creative_upload_media` → criativo no Meta Ads.

## 2026-10-12 — Texto citado (reply) passa para o agente

- **Causa:** ao responder uma mensagem no grupo (ou no privado), o agente recebia só o texto novo, sem o conteúdo citado. Isso o fez perder o contexto do pedido e responder de forma incorreta.
- **Correção:** `quotedTextFrom` extrai o texto da mensagem citada (`contextInfo.quotedMessage`); `withQuoted` prefixa o texto com `[Citando: "..."]` antes de guardar no payload. Vale para grupos, dono e membros.
- **Verificação:** TypeScript e 445 testes.

## 2026-10-12 — maxTurns elevado para 30 e aviso de parcial

- **Causa:** tarefas de planilha com muitas células chegavam a 25+ chamadas e estourravam o limite de 12 passos do CLI/SDK, sem resposta ao dono.
- **Correção:** `maxTurns` elevado de 12 para 30 nos dois executores (CLI e SDK) no handler do dono. Quando ainda bater o limite, a mensagem é "Completei parte do pedido, mas atingi o limite de passos antes de terminar. Confira o que já foi alterado e me reenvie o que ainda faltar."
- **Verificação:** TypeScript e 445 testes.

## 2026-10-12 — Jev: régua corrigida e métricas por intenção

- **Causa da nota baixa (51%):** a concordância comparava a categoria do Jev com `toolCategory`, que só devolve arte/consulta/escrita e contava ToolSearch como escrita. Categorias como grupo, tarefa e conversa nunca podiam bater.
- **Correção:** `toolLabels` traduz cada ferramenta para as categorias do Jev (ignora ToolSearch/TodoWrite/Read/Grep/Glob/WebSearch); `agreement` trata conversa com ferramenta como divergência e sem ferramenta como acerto só para conversa/fora do escopo; `intentAgreement` compara pela intenção. `toolCategory` e a decisão de efeito do fallback não mudaram.
- **Métricas:** `jevMetrics` recalcula na visualização, a partir de categoria/intenção/ferramentas gravadas, a concordância total, por categoria e por intenção, a calibração por faixa de confiança, a latência (p50/p90/p99/max) e o % de pedidos simples. Mantém triadas, comparaveis, concordancia, meta, alertasManipulacao, falhas e ultimas.
- **Medição prévia (288 triagens, 09–12/10):** 51% gravado; 62% com a régua corrigida. Modo sombra mantido (`activeRouting` falso).
- **Verificação:** TypeScript e 445 testes (novo tests/jevMetrics.test.ts). Sem migração. Pendente: reiniciar o worker para a nova régua valer nas triagens novas; conjunto rotulado (~100 mensagens) antes de qualquer roteamento ativo.

- **Estado (12/10/2026):** PR #9 mesclado na `main` (commit `91dadd0`). Worker reiniciado sem tarefas em andamento; um único worker ativo. Pendentes: PRs #7 e #8 sem merge; testes ao vivo de cofre, prospecção, citação/áudio em grupo e menção fantasma.

## 2026-10-12 — Aba de conversa desativada

- **Pedido:** desativar a aba de conversa com a Maia no painel.
- **Mudança:** removida a aba Conversa e o carregamento do chat na interface local/publicada. Agente Maia abre em Regras ativas; links antigos do chat redirecionam para essa tela.
- **Verificação:** navegação, TypeScript, testes de aplicação/banco e build conferidos antes da publicação.

## 2026-10-12 — Fechamento dos formulários do painel

- **Causa:** após conflito de edição, atualizar cadastros mantinha o formulário com a revisão antiga; clientes também guardavam uma cópia desatualizada do cadastro selecionado.
- **Correção:** seleção de cliente por ID e formulários de cliente, grupo de acesso e grupo WhatsApp reiniciados quando muda a revisão. A atualização carrega os valores atuais antes de uma nova tentativa, preservando a proteção contra edição concorrente.
- **Salvamento:** resposta de escrita tipada separadamente da leitura. Se a gravação é aceita e a releitura falha, o painel informa que o cadastro foi salvo e permite atualizar a lista sem repetir a escrita.
- **Verificação:** 426 testes de aplicação e 35 de banco aprovados, incluindo cinco regressões de conflito/releitura; TypeScript e build aprovados. O build principal ficou em 458,90 kB, sem aviso de chunk acima de 500 kB. Revisão React realizada. Browser sem navegadores disponíveis; inspeção visual autenticada e publicação desta correção continuam pendentes.

## 2026-10-12 — Painel organizado por áreas, clientes e grupos de acesso

- **Pedido:** reduzir opções repetidas na coluna, agrupar as telas relacionadas e separar grupos de clientes. A antiga Operação exibia mapa de grupos e permissões com dados de demonstração, ao lado das telas reais.
- **Navegação:** sete áreas — Visão geral, Marketing, Execução, Grupos e clientes, Equipe e acessos, Agente Maia, Sistema e integrações — com abas de contexto. Pessoas passa a Acessos; Regras ativas e Continuidade ficam no Agente Maia; Executor e roteamento fica com Conexões e fontes. Links antigos continuam funcionando. Mapa/permissões de demonstração saem do fluxo e o cabeçalho usa a identidade autenticada. O proprietário também recebe as telas operacionais na versão publicada.
- **Conteúdo:** investimento em mídia fica em Campanhas; Indicadores apresenta entrega e qualidade. Conexões mostra disponibilidade das fontes; Executor e roteamento mostra configuração e execução observada. Estado da Zernio não é mais apresentado como confirmado sem consulta. Atualização manual e conversa local não são oferecidas como rotas disponíveis na Vercel.
- **Cadastros reais:** clientes e grupos de acesso (membros/permissões) associados ao cadastro existente `maia_groups`. Filtros por cliente, tipo e cadastro; novos grupos ficam pausados por padrão. API publicada exclusiva do proprietário, RLS e RPC transacional para alterar membros e permissões. Revisões impedem sobrescrever edições concorrentes. A permissão de aprovar ações continua individual.
- **Contexto e permissões:** grupos de clientes não recebem histórico privado do owner nem de outros grupos. Histórico filtrado por cliente e início do escopo; mensagens antigas na fila não são tratadas como pedidos do cliente novo. Permissões herdadas de clientes valem somente nos grupos deles; equipes internas também permitem conversa privada quando configuradas. Ferramentas globais e outros grupos são bloqueados no contexto de cliente. Revalidação na fila, nas ferramentas, depois de aprovação e em cada parte da resposta persistida. Codex de cliente usa ambiente de autenticação temporário, sem configuração/MCPs/memória globais, com shell, imagens locais, delegação e apps desativados.
- **Banco reconciliado:** a migração `20261011185724` foi conferida contra `supabase_migrations.schema_migrations` por consulta somente leitura. Removida a inclusão posterior de `response_deliveries.requester`; a coluna pertence à migração nova `20261012014613`, aplicada em outra sessão. Nenhum DDL remoto foi executado nesta entrega.
- **Desempenho:** páginas carregadas sob demanda e uma consulta de snapshot compartilhada entre cabeçalho e telas. Preservadas as mudanças concorrentes já commitadas no projeto.
- **Verificação:** 421 testes Vitest em 56 arquivos e 35 testes de banco aprovados; `pnpm typecheck`, `pnpm build`, `pnpm db:validate` (34 migrações) e `pnpm rules:check` aprovados. Entrada JavaScript de 458,90 kB, abaixo do aviso de 500 kB. A guarda de migrações é conferida após o commit.
- **Pendências:** inspeção visual autenticada (navegador indisponível nesta sessão), publicação da interface e exercício real de grupo de cliente autorizado. Não houve envio de WhatsApp nem chamada paga a modelos como teste. Documentos de clientes continuam fora do RAG do projeto.

---

## 2026-10-12 — Correção: coluna response_deliveries.requester ausente (respostas da Maia falhando)

- **Sintoma:** a Maia não conseguia gravar respostas: `Persistência da resposta: Could not find the 'requester' column of 'response_deliveries' in the schema cache`. Tarefas terminavam como `falhou`.
- **Causa:** a linha `alter table response_deliveries add column requester` foi editada dentro da migração `20261011185724_maia_client_groups_access.sql` depois dela já estar aplicada em produção. O banco nunca recebeu a coluna, mas o código novo grava nela.
- **Correção:** migração nova `20261012014613_maia_response_deliveries_requester.sql` com `add column if not exists requester jsonb` (idempotente, só adiciona). Aplicada pelo owner com `supabase db push --linked`.
- **Pendência:** a migração `20261011185724` (da outra sessão) ainda contém a linha editada e precisa voltar ao que foi aplicado; o `db:guard` acusa a alteração quando a migração é comparada com a base.
- **Verificação:** coluna confirmada no banco, migração no histórico remoto, `db:validate` com 30 migrações. Worker reiniciado às 22:48.

---

## 2026-10-12 — Correção: Maia não respondia à menção em grupo (identificador @lid)

- **Sintoma:** uma pessoa marcou a Maia no grupo Operacional e ela não respondeu; só respondeu depois que o dono pediu no privado.
- **Causa:** o WhatsApp passou a citar a Maia pelo identificador interno (`@lid`, 15 dígitos) nos grupos. `addressedToMaia` (`server/inbox.ts`) comparava o `mentionedJid` só com o **telefone** da instância, então a mensagem era guardada como contexto e ignorada. Nenhuma tarefa de grupo foi criada.
- **Correção:** variável `MAIA_LID` no ambiente. O webhook (`inbox.ts`) passa a comparar menção e citação também com ela. No worker, `server/groupMention.ts` reconhece o `@MAIA_LID` no texto como rede de segurança, sem depender de o webhook na Vercel já conhecer a variável.
- **Verificação:** testes em `tests/groupMention.test.ts` (reproduzem o incidente: com `MAIA_LID` a menção conta; sem ele, não).
- **Pendência:** acrescentar `MAIA_LID` no ambiente da Vercel; sem isso a correção vale só pelo worker. Se a instância mudar de número, o valor muda.

---

## 2026-10-12 — Áudio do dono: sem repetir a transcrição no WhatsApp

- **Pedido do owner:** a Maia não deve responder com o texto transcrito do áudio ("Entendi: ..."). A transcrição acontece no backend e vira o pedido; o dono só vê a resposta ao pedido.
- **Correção:** removida a mensagem de eco em `handleOwnerAudio` (`server/ownerRouter.ts`). Continua transcrevendo, guardando o texto e tratando-o como pedido; os avisos de falha ("Não consegui entender o áudio" e "Não consegui processar o áudio agora") ficam.
- **Verificação:** `tests/audioSemEco.test.ts` protege a decisão; 438 testes e typecheck passam.

---

## Atualização 12/10/2026 (estado atual)

- **Menção em grupo:** PR #6 mesclado (`1692a42`); `MAIA_LID` cadastrada na Vercel como variável plain em Production. Falta testar ao vivo citação e áudio.
- **Whisper:** serviço fora do ar (container em loop no boot). Compose corrigido salvo no EasyPanel, ainda não implantado.
- **Aplicado no banco:** `20261012030526_maia_secrets_vault` (cofre), `20261012104713_maia_rules_contatos_prospeccao` (regra de contatos com prospecção) e as demais migrações de hoje. Conferido por leitura.
- **Chave do cofre:** `INTEGRACAO_VAULT_KEY` criada no `.env` da pasta `agent-maia` (sem registro no repositório). Backup é responsabilidade do owner.
- **Worker:** reiniciado depois da chave; há um só worker na pasta original.
- **Ainda falta validar ao vivo:** cofre (`cofre teste | ...`), prospecção pelo WhatsApp, menção fantasma e rotas de escrita.

## 2026-10-12 — Regra de contatos: prospecção pedida pelo dono

- **Problema:** a Maia recusava prospecção pedida pelo dono ("não faço prospecção por conta própria"). A regra de contatos não citava as ferramentas prospeccao_* nem o fluxo com OK a cada envio.
- **Correção:** texto da regra `contatos_membros` (versão `2026-10-12.2`) explica o fluxo: prospeccao_preparar, prospeccao_enviar_proximo com OK a cada envio, teto de 30 por dia, SAIR e prospeccao_descadastrar. Migração `20261012104713_maia_rules_contatos_prospeccao` (**ainda não aplicada**), que confere o texto anterior antes de trocar.
- **Verificação:** 421 testes, `rules:check`, `db:validate` e `db:guard`.

---

## 2026-10-12 — Cofre de segredos: token enviado no privado, sem passar pela IA nem pelo histórico

- **Pedido do owner:** mandar token de uma API nova só no privado da Maia, ela guardar e depois apagar do histórico do banco; nenhuma credencial pode aparecer em grupo.
- **Como funciona:** o dono manda `cofre NOME | valor` no privado. O worker intercepta no início de `processItem` (`server/vault.ts`, `handleVaultItem`), **antes** da IA, do lote da conversa e de qualquer gravação em `messages`/`group_messages`. Guarda o valor criptografado (AES-256-GCM) na tabela `maia_secrets` (migração `20261012030526`, **ainda não aplicada**), com chave `INTEGRACAO_VAULT_KEY` que existe só no `.env`. Apaga o texto do registro da fila (`inbox.payload`) na hora. A resposta ao dono não repete o valor. Também aceita `cofre listar` (só nomes) e `cofre apagar NOME`.
- **Grupos e outros números:** o mesmo comando é recusado, nada é guardado nem registrado, o registro da fila é apagado e o dono é avisado no privado para apagar a mensagem e trocar o token.
- **Catálogo:** `callIntegration`, `activateIntegration` e `listIntegrations` procuram o segredo primeiro no `.env` e depois no cofre. Só nomes `INTEGRACAO_*` entram no cofre; as chaves da Evolution e da Zernio seguem só no `.env`.
- **Limites:** a mensagem continua no celular do dono e na base da Evolution, que não temos como apagar; o registro da fila na Vercel existe por alguns segundos antes de o worker rodar (zerar isso exigiria mudar o webhook da Vercel, um deploy). Sem `INTEGRACAO_VAULT_KEY` o cofre recusa guardar e explica como criar a chave.
- **Verificação:** typecheck, build, `db:validate` e testes (`tests/vault.test.ts`: criptografia, comando, privado, grupo, sem chave e catálogo lendo do cofre).
- **Pendências:** aplicar a migração; criar `INTEGRACAO_VAULT_KEY` no `.env` e reiniciar o worker; decidir se o webhook da Vercel deve apagar o texto antes de gravar.

---

## 2026-10-12 — Fase 4: prospecção pedida pelo dono, com OK a cada envio

- **Pedido do owner:** prospectar uma lista de contatos quando ele pedir, com aprovação a cada envio, teto diário e descadastro.
- **O que entrou:** módulo `server/prospeccao.ts` e as ferramentas `prospeccao_preparar` (lote com mensagem final, confere WhatsApp, descadastro e repetições), `prospeccao_enviar_proximo` (um contato por chamada, **sempre com OK do dono**) e `prospeccao_descadastrar` (só o dono). Tabelas `maia_prospect_batches`, `maia_prospects` e `maia_optouts` na migração `20261012021430_maia_prospeccao_v1` (**ainda não aplicada**).
- **Regras aplicadas pelo código:** teto de 30 envios por dia (dia de São Paulo); sem repetir quem já foi contatado em 30 dias ou em outro lote; a mensagem precisa conter a palavra SAIR; quem pediu para sair nunca recebe, mesmo depois de entrar no lote; lote de até 200 contatos; checagem de WhatsApp na Evolution antes de gravar.
- **Limites:** descadastro por resposta no WhatsApp ainda é manual (ferramenta `prospeccao_descadastrar`); a checagem de WhatsApp (`/chat/whatsappNumbers`) e os envios ainda não foram exercitados ao vivo; a contagem do teto e do histórico lê até 1000 linhas por consulta.
- **Verificação:** typecheck, build, `db:validate` (32 migrações), 407 testes Vitest (novos em `tests/prospeccao.test.ts`) e `smoke:maia-tools` com 63 ferramentas.
- **Pendências:** aplicar a migração `20261012021430`; reiniciar o worker; resposta automática de descadastro ("SAIR") no inbox.

---

## 2026-10-12 — Mencionar todos no grupo (menção fantasma)

- **Pedido do owner:** a Maia poder mencionar todos os participantes de um grupo, sem marcar cada um no texto. Não existia: não havia endpoint no catálogo nem opção na ferramenta de texto de grupo.
- **O que entrou:** `grupo_enviar_texto` ganhou `mencionar_todos` (nos dois executores), em **menção fantasma**: os participantes com número válido vão só no campo `mentioned`, então todos são avisados e o texto não mostra número nenhum (`sendGroupText` ganhou o parâmetro `ghost`). Quem for citado de forma visível em `mencionar` continua aparecendo como @número.
- **Limite:** a Evolution não tem um "@todos" próprio nem documenta campo para isso; a menção fantasma usa o mesmo campo `mentioned` das menções que já funcionavam. Não foi testada ao vivo.
- **Verificação:** typecheck e testes (`tests/mencionarTodos.test.ts`: texto limpo, mentioned completo, sem repetir).

---

## 2026-10-12 — Fase 2: busca na web para o dono, trava depois da busca e regra "Limites"

- **Pedido do owner:** o dono pede pesquisa na web direto, sem OK; quando a Maia não tem a ferramenta, ela pergunta se a demanda deve ser passada ao Herickson.
- **O que entrou:** `WebSearch` oferecida ao CLI só para o dono (`CLI_OWNER_TOOLS`) e liberada pelo `decideBuiltin` só para o dono; `WebFetch` segue bloqueado (abrir páginas traria o conteúdo inteiro de terceiros). Regra "Limites" nova (versão `2026-10-12.1`, migração `20261012020001_maia_rules_limites_busca`, que confere o texto anterior antes de trocar).
- **Trava contra injeção:** depois de uma busca na web na tarefa (registro em `task_events`, `tool_use` / `WebSearch`), ações que não são de leitura pedem OK, até do dono (`decideAccess`, `ctx.webTainted`).
- **Limite:** a pergunta "passar ao Herickson?" é regra de texto; quem decide se a ferramenta existe continua sendo o modelo. Para quem é o dono, a regra só manda dizer que não tem a ferramenta, sem a pergunta.
- **Verificação:** typecheck, build, `rules:check`, `db:validate` (31 migrações), 393 testes Vitest (novos em `tests/webSearch.test.ts`). **Pendência:** `db:guard` acusa o `drop constraint` da migração `20261012012214` (já aplicada); a marcação `-- destrutivo-aprovado` precisa ser acrescentada num commit próprio.

---

## 2026-10-12 — Catálogo: Instagram pela Zernio (Fase 3), parâmetros no caminho e opcionais

- **Pedido do owner:** disponibilizar à Maia os endpoints do Instagram que ainda não tinham ferramenta.
- **O que entrou:** seção `zernio` em `config/integrations-catalog.json` (18 rotas, tiradas da documentação oficial docs.zernio.com) e migração `20261012013924_maia_integrations_zernio_v1.sql` (ainda **não aplicada em produção**). 10 de leitura: contas, limite de publicação, insights da conta, histórico de seguidores, demografia, comentários, detalhe de conversa, solicitações de mensagem, ice breakers. 8 externas (OK a cada uso): responder, ocultar, reexibir e apagar comentário, resposta privada, reagir e tirar reação no Direct, aceitar solicitação.
- **Código:** `server/integrationCatalog.ts` aceita parâmetro `{{nome}}` no caminho (valor simples, sem barra, nunca `.`/`..`, sempre codificado), parâmetro opcional `{{nome?}}` (some da URL ou do corpo quando não vem) e a chave `ZERNIO_API_KEY` presa ao endereço `zernio.com` (como a da Evolution). O gerador `scripts/db/catalog-sql.ts zernio` produz as linhas.
- **Fora de propósito:** o que já tem ferramenta própria com travas (publicar/editar/cancelar post, Direct com janela de 24 h, automações, Stories, áudio, seguidor), conectar conta (OAuth) e gravar ice breakers (formato dos itens não documentado).
- **Verificação:** typecheck, build, `db:validate` (29 migrações), `smoke:maia-tools` (60 ferramentas) e 384 testes Vitest. Rotas de escrita da Zernio não foram exercitadas ao vivo.
- **Pendência:** aplicar a migração (`supabase db push`); Fase 2 (busca na web, trava contra injeção, pergunta "passo para o Herickson?") e Fase 4 (prospecção, teto de 30/dia) ainda não começaram.

---

## 2026-10-12 — Correção: a Maia ficou sem as ferramentas mcp__maia__ (grupos, contatos, etc.)

- **Sintoma:** no WhatsApp a Maia dizia que não tinha ferramenta de grupo ("só aparecem carrossel e Meta Ads") e não listava os grupos salvos.
- **Causa:** as ferramentas novas do catálogo (`integracao_chamar`, `integracao_chamar_externa` e `integracao_propor`) declaravam parâmetros com `z.record(...)`. Esse esquema faz a resposta `tools/list` do servidor MCP falhar inteira (`Cannot read properties of undefined (reading 'push')`), então **nenhuma** ferramenta `mcp__maia__` chegava ao Claude. O mesmo valia para a ponte do Codex. Não era o executor CLI, a instância nem a migração de grupos. Os testes unitários não listavam as ferramentas pelo protocolo, por isso não pegaram.
- **Correção:** `parametros` e `corpo` passaram a ser texto JSON, lido e validado no servidor (`parseParams` e `parseJsonObject` em `server/integrationCatalog.ts`: objeto plano, até 20 chaves, valores texto até 500 caracteres, número ou booleano). Teste novo `tests/mcpToolsList.test.ts` lista as ferramentas pelo MCP de verdade e proíbe `z.record(` nos dois arquivos de ferramentas.
- **Verificação:** `pnpm smoke:maia-tools` volta a listar 60 ferramentas; typecheck, build e 380 testes Vitest.
- **Pendência:** reiniciar o worker para carregar a correção.

---

## 2026-10-12 — Catálogo de integrações: endpoints da Evolution, nível externa e parâmetros na URL

- **Pedido do owner:** deixar disponíveis à Maia os endpoints da Evolution API que ainda não tinham ferramenta, para ela usar quando ele pedir.
- **O que entrou:** nível de risco `externa` (a ferramenta `integracao_chamar_externa` pede OK do owner a cada uso, até para ele); parâmetros `{{nome}}` na parte de consulta da URL, sempre codificados (nunca no host nem no caminho); `config/integrations-catalog.json` (34 endpoints da Evolution v2) com o gerador `scripts/db/catalog-sql.ts` e a migração `20261012012214_maia_integrations_evolution_v2.sql` (ainda **não aplicada em produção**).
- **Ativos (25):** consultas (números, perfil, etiquetas, privacidade, convite), ações internas (digitando, arquivar, não lida, etiqueta) e envios/alterações com OK por uso (localização, contato, figurinha, áudio, status, apagar/editar mensagem, nome, descrição, convite e configurações de grupo, entrar por convite).
- **Pausados (9), o owner liga um a um com `integracao_ativar` (pede OK):** apagar, desconectar e reiniciar a instância, alterar privacidade, nome/recado/foto do perfil, bloquear contato e sair de grupo.
- **Fora de propósito:** `sendText`, `sendPoll`, criar grupo, participantes, convites (já têm ferramenta com limites do servidor) e `webhook/set`, `webhook/find`, `instance/fetchInstances`, `instance/create` (vazam segredo ou desviam mensagens).
- **Verificação:** typecheck, build, `rules:check`, `db:validate` (28 migrações) e 375 testes Vitest (novos em `tests/integrationCatalog.test.ts` e `tests/integrationsCatalogFile.test.ts`). Corpos das rotas de escrita seguem a documentação da v2 e **ainda não foram exercitados ao vivo**.
- **Pendências:** aplicar a migração (`supabase db push`); regra "Limites" (propor ao Herickson com pergunta), busca na web nativa, importação do Instagram (Zernio) e modo de prospecção com teto de 30/dia ficam para as próximas fases.

---

## 2026-10-12 — Catálogo de integrações por endpoint (primeira fatia)

- **Pedido do owner:** a Maia usar APIs novas (começando pela reação do WhatsApp na Evolution) sem alguém editar código a cada uma, mantendo a decisão de que o código só muda em sessão direta.
- **O que entrou:** tabela `maia_integrations` (migração `20261012005057_maia_integrations_v1.sql`, ainda **não aplicada em produção**), permissão `integracao.usar`, módulo `server/integrationCatalog.ts` e as ferramentas `integracao_listar`, `integracao_chamar`, `integracao_propor` e `integracao_ativar` (Claude em `maiaImageTool.ts` e Codex em `codexMaiaMcp.ts`). A primeira linha do catálogo é `whatsapp_reagir` (Evolution `/message/sendReaction`), já ativa.
- **Regras de segurança:** a Maia só **propõe** (sempre pendente); **ativar pede aprovação** do owner a cada vez (`approvalPolicy.ts`). O catálogo guarda só o NOME da variável de segredo, que precisa começar com `INTEGRACAO_` (a chave da Evolution só vale para o endereço da Evolution); nunca o valor, e o token não deve ser enviado pelo chat. A URL é https literal, sem endereço interno/local e sem usuário/senha; só `{EVOLUTION_API_URL}` e `{EVOLUTION_INSTANCE}` são trocados por ambiente. A chamada recusa redirecionamento, limita tempo (15 s) e resposta (4 000 caracteres) e apaga o segredo de qualquer retorno. Membro só chama com `integracao.usar`; propor é só do dono.
- **Limites desta fatia:** sem cofre de segredos (o dono coloca a variável no ambiente do servidor), sem interceptar token enviado por mensagem, sem integração de risco externo (só `leitura` e `interna`), sem mudança em `maia-rules.json`. Para reagir a uma mensagem a Maia precisa do id dela, que nem sempre está no contexto.
- **Verificação:** typecheck, build, `rules:check`, `db:validate`, 340 testes Vitest e 32 de banco (novos: `tests/integrationCatalog.test.ts`).
- **Pendência:** aplicar a migração antes de ligar o código em produção (`supabase db push`, com aprovação do owner); regra "Limites" ainda manda dizer que não faz e avisar o dono; busca na web continua bloqueada.

---

## 2026-10-11 — Claude Code CLI como executor principal da Maia

- **Pedido do owner:** trocar o Claude Agent SDK pelo Claude Code CLI (`claude -p`) como executor principal, mantendo WhatsApp, Jev, Codex, Supabase, RAG, memória, regras e aprovações, com possibilidade de voltar ao estado anterior.
- **Como funciona:** novo `server/ai/providers/claudeCli.ts`. O worker sobe um MCP HTTP local (só 127.0.0.1, token por execução) com o mesmo servidor de ferramentas que o SDK já usava (`createImageServer`, 53 ferramentas) e um verificador de permissão. O CLI roda com `--restricted`, `--tools Read,Grep,Glob,ToolSearch,TodoWrite`, `--permission-prompt-tool` e `--mcp-config`; **toda** ferramenta passa pelo mesmo `CanUseTool` de antes (`makeWhatsAppPermission`/`makePanelPermission`), então papéis, aprovação por OK (10 min), grupos e limites não mudaram. Prompt vai por stdin e regras por arquivo temporário (sem limite de linha de comando); ambiente do CLI sem segredos do projeto; leitura de `.env`, `.git`, `.ssh` etc. negada por regra do CLI e por `decideBuiltin`.
- **Conectores:** Gmail, Drive, Agenda, Sheets e Supabase da conta continuam pelo login do Claude. `--restricted` não carrega servidores MCP do computador (equivalente ao `settingSources: []`). Bash, PowerShell, Edit, Write, WebFetch, WebSearch e NotebookEdit seguem bloqueados.
- **Roteamento intacto:** classificação, orçamento (`--max-budget-usd`), passos (`--max-turns 12`), saúde dos provedores e fallback para o Codex não mudaram; erros do CLI usam o mesmo texto que o classificador já lê (limite de uso ainda aciona o Codex).
- **Voltar ao estado anterior:** `MAIA_CLAUDE_EXECUTOR=sdk` (ou `providers.claude.executor: "sdk"` em `config/ai-routing.json`) devolve a execução ao Agent SDK, que continua no código. Se o CLI não existir ou a versão não aceitar uma opção, a chamada cai sozinha no SDK **antes de qualquer ação** (evento `executor_sdk`). Marcos no Git: tag `pre-claude-cli-executor` e branch `backup/pre-claude-cli-executor`.
- **VPS:** `MAIA_CLAUDE_BIN` (caminho do `claude`), `MAIA_CLAUDE_WORKDIR` (pasta de trabalho) e `MAIA_CLAUDE_ADD_DIRS` (repositórios extras, só leitura e só para o owner; separador `:` no Linux, `;` no Windows). Pedem `claude` instalado e logado na conta (ou `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` no ambiente do worker).
- **Codex com paridade:** a ponte `server/codexMaiaMcp.ts` não tinha 9 ferramentas que o Claude tem: `grupo_gerenciar_participantes`, `grupo_info`, `grupo_participantes`, `grupo_convite_link`, `grupo_enviar_convite`, `grupo_alterar_foto`, `conversas_listar`, `contato_instancia_buscar` e `arquivo_reenviar`. Adicionadas, com as mesmas mensagens e a mesma proteção (`guarded`/`access.ts`). Fica de fora só `anuncio_midia_url_temporaria`, que existe para o conector Meta Ads do Claude. Teste de paridade impede nova divergência.
- **Decisão do owner:** não haverá "modo dev" por WhatsApp (editar código e rodar comandos pelo chat). Foi desenhado e descartado; a edição do código da Maia segue por sessão direta do Claude Code no repositório, que atende pelo nome Maia (registrado no `CLAUDE.md`). Nenhum código do modo dev foi mantido.
- **Tudo no Claude Code CLI:** a atualização periódica do painel (`refreshJob.ts`: Gmail, Meta Ads, Sheets, Agenda) e a Maia de demonstração do painel local (`maiaAgent.ts`) também passaram para o CLI, por um ponto único (`server/ai/providers/claudeSimple.ts`) com a mesma escolha de executor (CLI por padrão; `MAIA_CLAUDE_EXECUTOR=sdk` ou `providers.claude.executor` voltam ao SDK; CLI ausente cai no SDK). O CLI roda sem ferramentas internas e só os conectores da fonte são liberados. O Agent SDK deixa de ser executor, mas continua no código como alternativa e porque `createImageServer` usa o construtor de ferramentas dele.
- **Custo medido (mesma consulta de Agenda, haiku, com todos os conectores da conta carregados):** CLI ≈ US$ 0,091 contra SDK ≈ US$ 0,055. O CLI sai cerca de 65% mais caro nas consultas do refresh; se isso pesar, `MAIA_CLAUDE_EXECUTOR=sdk` volta o refresh (e a Maia) ao motor anterior. Não medido: o custo do CLI nas conversas reais do WhatsApp.
- **Não alterado:** Edit/Write/Bash para desenvolvimento seguem bloqueados no agente operacional. Decisão do owner: sem VPS; as variáveis `MAIA_CLAUDE_BIN`/`WORKDIR`/`ADD_DIRS` são opcionais e ficam sem uso.
- **Verificação:** `pnpm typecheck`, `pnpm build`, `pnpm test` (325 Vitest em 43 arquivos + 32 de banco) e `rules:check` aprovados. Teste real com o CLI instalado (`pnpm smoke:claude-cli`, haiku, ≈US$ 0,004): chamou a ferramenta pelo MCP local, consultou o verificador, a ferramenta recusada não executou e a leitura de `.env` foi negada. `pnpm smoke:maia-tools`: o servidor real lista 53 ferramentas por HTTP. **Não testado:** mensagem real pelo WhatsApp/Evolution e aprovação por OK ponta a ponta (exige gastar e enviar de verdade).

## 2026-10-11 — Mais contexto de conversa e simulação de digitação

- **Sintoma (autodiagnóstico da Maia no WhatsApp):** ela perdia contexto — 5 posts longos viraram só o começo do primeiro. **Causa** em `server/context.ts`: cada mensagem cortada em 400 caracteres, só as últimas 8 linhas e só os últimos 30 minutos. Um "Ok" do dono confirmava um rascunho que ela já não via inteiro.
- **Correção:** 4000 caracteres por linha, 14 linhas, janela de 2 horas; a busca crua no banco subiu de 30 para 60 linhas. Orçamento de `conversa` em `config/ai-routing.json` de US$ 0,25 para US$ 0,50, porque o contexto ficou bem maior.
- **Simulação de digitação:** `sendTextChecked` agora manda `delay` à Evolution (~45 ms por caractere, piso 1,2 s, teto 6 s), que mostra "digitando..." enquanto espera. Tempo limite do pedido ampliado na mesma medida.
- **Decisão registrada:** a plataforma bloqueou construir uma ferramenta para a Maia editar o próprio código, mesmo com aprovação ("Create Unsafe Agents"). Não foi implementada; mudanças de código continuam por sessão de desenvolvimento com revisão. Para "não quero mais que você faça X", vale o fluxo de preferências do PR #4 (`CONFIRMAR PREFERENCIA`).
- **Verificação:** `pnpm typecheck` e `pnpm test` (306) aprovados.

## 2026-10-10 — Trava de geração de arte e preferências persistentes do owner

- **Incidente de arte:** depois de uma conversa sobre Stories e uma oferta para criar arte, o gerador foi iniciado sem o owner aceitar; consumiu até 240 s antes de expirar. Causa: o modelo podia chamar `gerar_imagem` mesmo quando a mensagem original não pedia criação.
- **Correção de arte:** agora a mensagem original precisa ser um pedido direto e afirmativo; Claude e Codex verificam autorização no servidor, inclusive papel owner. Consultas, ofertas, perguntas de capacidade e recusas não iniciam geração. O bloqueio é negado por padrão.
- **Preferências permanentes:** o owner pode pedir uma preferência de resposta, sugestões ou uma restrição mais estrita. A IA cria apenas uma proposta pendente, mostra o texto exato e não altera nada até o comando literal `CONFIRMAR PREFERENCIA <id>` em até 10 min. `CANCELAR PREFERENCIA <id>` descarta. Permissões, aprovações e segurança permanecem fora desse mecanismo; a migração cria tabelas RLS privadas e RPC de ativação exclusiva do servidor.
- **Documentação:** novo guia `docs/owner-preferences.md`; README, CLAUDE.md, contrato de migrações, TODO e resumo de erros atualizados.
- **Verificação:** typecheck, build, 301 testes Vitest, 32 testes nativos de banco via Node 24, `db:validate` (25 migrações em Postgres temporário) e `rules:check` aprovados localmente. Após alinhar o arquivo ao version Supabase, CI/validate (incluindo `db:guard`) e Vercel Preview passaram no PR #4.
- **Produção:** por exceção explícita do owner, a migração foi aplicada diretamente via Supabase MCP após o workflow protegido falhar por ausência de segredos no ambiente GitHub `production`. O banco registrou a versão `20261011012443`; o arquivo local foi renomeado para corresponder ao histórico. As tabelas estão vazias, com RLS, sem grants para `anon`/`authenticated`; a RPC está disponível somente ao servidor. O código segue no PR #4 e ainda não está ativo em produção até o merge/deploy.

## 2026-10-10 — Eventos de grupo da Evolution ativados (e um incidente corrigido na hora)

- **Pedido do owner:** depois da ferramenta de trocar foto de grupo, verificar se os eventos da Evolution necessários para usar os endpoints de forma eficiente estavam ativados.
- **Implementado:** `evolutionWebhook.ts` reconhece `groups.upsert`, `group.update` e `group-participants.update` como `group_change`; `inbox.ts` transforma isso num item de fila (`sender: "group"`, `payload: "cache_reset"`, sem key_id); `inboxWorker.ts` chama `resetGroupCache()` ao processar — assim o cache de 15 min de `server/groups.ts` é invalidado na hora que algo muda, em vez de só expirar por tempo ou a Maia reconsultar e bater no limite da Evolution (rate-overlimit).
- **Bug real encontrado ao vivo:** o enum de eventos desta instância usa `GROUP_UPDATE` (singular) e não `GROUPS_UPDATE` (plural, como a documentação pública da Evolution mostra) — a Evolution recusou com HTTP 400 e devolveu o enum aceito; corrigido em `scripts/register-evolution-webhook.ts`.
- **Incidente causado e corrigido na mesma sessão:** o script usava `WEBHOOK_PUBLIC_URL` (variável do túnel Cloudflare do launcher legado, `pnpm start:legacy`, que muda a cada execução) com o caminho `/webhook`. Esse valor estava parado no `.env` de uma sessão antiga. Rodar o script com `--apply` **sobrescreveu o webhook de produção**, apontando a Evolution para esse túnel morto em vez de `api/webhook.ts` na Vercel — ou seja, por alguns minutos a Maia não teria recebido nenhuma mensagem nova. Percebido e corrigido na hora (webhook restaurado para a URL certa, com os eventos novos). Script corrigido para nunca mais depender de `WEBHOOK_PUBLIC_URL`: nova variável `EVOLUTION_WEBHOOK_URL`, estática, só para a URL real de produção (documentada em `.env.example`).
- **Verificação:** `pnpm typecheck` e `pnpm test` (296) aprovados; webhook real conferido (`GET /webhook/find`) com a URL e os 6 eventos corretos.

## 2026-10-10 — Trocar foto de grupo (e auditoria dos eventos da Evolution)

- **Pedido do owner:** mandou a logo da Worki e pediu pra Maia colocar como foto do grupo Operacional; ela respondeu que não tem ferramenta pra isso. O owner questionou se a Evolution de fato não tem endpoint — não tinha: o código-fonte da Evolution API confirma `POST /group/updateGroupPicture/{instance}`, corpo `{ groupJid, image }`, aceitando tanto URL https quanto base64. Só não estava implementado neste projeto.
- **Implementado:** `updateGroupPicture` em `server/groups.ts`, mesmo padrão das outras chamadas de grupo. Nova ferramenta `grupo_alterar_foto` (`server/maiaImageTool.ts`): aceita uma imagem de `data/midia` (que o dono mandou) ou `data/arte`, lê o arquivo e manda em base64 — sem precisar de URL pública. Mesma regra das outras ações de grupo: livre pro owner em grupo cadastrado, aprovação em grupo não cadastrado ou para membro.
- **Auditoria dos eventos da Evolution** (pedido do owner): confirmado ao vivo que a instância só tem 3 eventos ativos no webhook (`CONNECTION_UPDATE`, `MESSAGES_UPSERT`, `MESSAGES_UPDATE`). Nenhum evento de grupo (`GROUPS_UPSERT`, `GROUPS_UPDATE`, `GROUP_PARTICIPANTS_UPDATE`). Isso não impede as ações (são chamadas HTTP diretas, com resposta síncrona), mas explica o cooldown de rate-overlimit já existente: sem evento reativo, a única forma de saber de uma mudança de grupo é consultar de novo. **Pendência, não implementada:** avaliar se vale ativar esses eventos e ensinar `api/webhook.ts`/`inbox.ts` a invalidar o cache do grupo (`resetGroupCache`) ao recebê-los, em vez de só expirar por tempo.
- **Verificação:** `pnpm typecheck` e `pnpm test` (294) aprovados.

## 2026-10-10 — Sem aviso de "recebi/transcrevendo/analisando" em áudio e mídia

- **Feedback do owner:** ao mandar áudio ou documento, a Maia avisava "Recebi o áudio, transcrevendo (pode levar até um minuto)..." / "Recebi o documento, analisando...". Mecânica interna irrelevante, mesmo padrão da correção anterior sobre "o WhatsApp aceitou o envio".
- **Correção:** removido esse aviso intermediário de `handleOwnerAudio`, `handleOwnerMedia`, `handleMemberAudio` e `handleMemberMedia` (`server/ownerRouter.ts`). A Maia processa e responde direto, sem anunciar que está processando.
- **Verificação:** `pnpm typecheck` e `pnpm test` (291) aprovados. Corrigido de passagem um teste (`rules.test.ts`) que passou a estourar o timeout padrão do vitest ao montar o Postgres de teste com as 24 migrações reais.

## 2026-10-10 — Ponte temporária Supabase → Meta Ads para vídeo/imagem do WhatsApp

- **Pergunta do owner:** mandar um vídeo pra Maia e pedir pra subir na conta de anúncio funcionaria? Ele suspeitava que precisaria de uma conexão temporária com o Supabase.
- **Confirmado no schema real da ferramenta:** `ads_creative_upload_media` (Meta Ads) só aceita `LOCAL_FILE` (exige app interativo, que não existe no fluxo headless do WhatsApp) ou `URL` (link https público e direto, sem login). O vídeo do WhatsApp só ficava salvo em `data/midia` (disco local, sem endereço público) — faltava exatamente a ponte que o owner imaginou.
- **Implementado:** `server/integrations/adsMedia.ts` — bucket privado `ads_media_temp` no Supabase Storage (criado sob demanda, idempotente, nunca por migração SQL porque o schema `storage.*` não existe no Postgres de teste do projeto — PGlite via `supabase/ci/bootstrap.sql`); `uploadTempAdMedia` sobe o arquivo e devolve uma URL assinada (2h); `purgeTempAdMedia` apaga o que passou do teto, chamada a cada 10 min pelo `inboxWorker.ts`, junto da limpeza de mídia já existente.
- **Nova ferramenta `anuncio_midia_url_temporaria`** (só o dono): recebe o caminho do arquivo em `data/midia` (exposto agora também para vídeo em `buildMediaPrompt`, que antes só mandava quadros/transcrição) e devolve o link temporário. Não sobe nada no Meta Ads por si só — o próximo passo (chamar `ads_creative_upload_media` com esse link) é do próprio agente, que já tem o conector Meta Ads disponível.
- **Regra nova no catálogo** (`anuncios_midia_url`, versão 2026-10-10.3): explica o fluxo de dois passos e que o link expira.
- **Verificação:** `pnpm typecheck`, `pnpm test` (291), `pnpm rules:check` e `pnpm db:validate` aprovados. Upload real ao Meta Ads não foi testado (exigiria subir conteúdo de fato na conta de anúncio real).

## 2026-10-10 — LinkedIn simétrico entre Claude e Codex

- **Correção do owner:** a Zernio é uma API nossa, direta — diferente de um conector MCP exclusivo de um provedor (Gmail/Meta Ads/Instagram do claude.ai, que o Codex de fato não herda). Não há motivo pra um executor ter uma ferramenta Zernio e o outro não.
- **Achado:** `linkedin_contas`, `linkedin_organizacoes`, `linkedin_desempenho` e `linkedin_publicar` só existiam em `server/codexMaiaMcp.ts` (a ponte do Codex) — o executor principal (Claude, via `server/maiaImageTool.ts`) não tinha nenhuma ferramenta de LinkedIn.
- **Correção:** as 4 ferramentas de LinkedIn foram copiadas para `maiaImageTool.ts`. Novo par simétrico nos dois lados: `linkedin_post_cancelar` e `linkedin_post_editar`, reaproveitando `cancelScheduledPost`/`updateScheduledPost` (já criadas para o Instagram; não são específicas de uma rede, operam por `postId` da Zernio). `approvalPolicy.ts` passa a exigir OK para cancelar/editar também no LinkedIn.
- **Verificação:** `pnpm typecheck`, `pnpm test` (285), `pnpm rules:check` e `pnpm db:validate` aprovados.

## 2026-10-10 — Instagram: carrossel, Reels, Story, cancelar e editar post

- **Pedido do owner:** publicar Reels, Stories e carrossel, e poder cancelar/editar um post, "que funcione já".
- **Confirmado ao vivo antes de codar** (rascunho de teste, nunca publicado, apagado depois): `platformSpecificData.isReel`/`isStory` são aceitos e preservados pela Zernio para Instagram; `POST /media/presign` aceita `video/mp4` do mesmo jeito que imagem; `PUT /v1/posts/{id}` edita post não publicado (legenda, mídia, agendamento); `DELETE /v1/posts/{id}` cancela post não publicado e devolve a cota. Post já publicado no Instagram não pode ser cancelado (Unpublish não suporta Instagram) nem editar legenda — a Zernio recusa, e as ferramentas repassam esse erro em vez de inventar sucesso.
- **`server/integrations/zernio.ts`:** `InstagramPostInput` agora aceita `mediaUrls[]` + `kind` (foto/carrossel/reels/story); `buildInstagramPost` valida 2-10 imagens no carrossel, exatamente 1 mídia nos demais, e `.mp4` para Reels. Novas `cancelScheduledPost` e `updateScheduledPost`. `resolveVideoPost` aceita `.mp4` até 200 MB na pasta de artes.
- **`instagram_publicar`** ganhou o parâmetro `tipo` e aceita várias artes (carrossel); novas ferramentas `instagram_post_cancelar` e `instagram_post_editar`, ambas sempre com aprovação.
- **Achado da sessão:** `GET /connect/instagram` (reconectar a conta) devolveu 402 — a conta já usa as 2 contas sociais grátis do plano Zernio; precisaria de forma de pagamento para reconectar via Facebook Login (necessário para o catálogo de música de Reels).
- **Verificação:** `pnpm typecheck`, `pnpm test` (284), `pnpm rules:check` e `pnpm db:validate` aprovados.

## 2026-10-10 — Alinhamento de regras, prompt e conhecimento

- **Causa:** decisões antigas e atuais conviviam como instruções vigentes: identidade negava áudio, regras divergiam sobre aprovação e retenção, planos da demo eram consultados como estado operacional e faltava regra específica de LinkedIn.
- **Mudança:** catálogo versionado em `config/maia-rules.json`, documento gerado e prompt estruturado por código/categoria/título. A reserva inicial usa o catálogo completo; após leitura válida, preserva a última versão, inclusive desativações. Cache por cliente de banco; identificação do ambiente é atualizada fora do cache. Zero regras ativas interrompe a execução.
- **Conhecimento:** apenas o documento vigente entra na busca operacional. Histórico e plano permanecem preservados como fontes inativas; a sincronização confere catálogo/documento/banco e só retira as fontes antigas após indexar a nova.
- **Bug corrigido:** indexação gravava checksum e apagava trechos antes de concluir os vetores. Falha deixava documento incompleto aparentemente atualizado. Nova RPC transacional, exclusiva de `service_role`, prepara a troca completa e rejeita versão concorrente. Fonte inativa/incompleta é reparada mesmo quando o checksum coincide.
- **Banco:** migração aplicada `20261010175923_maia_knowledge_atomic_rules_alignment.sql`, aditiva para a RPC e com atualização de regras protegida por comparação de baseline/seed/versão final. Arquivo local identificado pela versão efetivamente atribuída pelo Supabase, com SQL preservado. Migrações anteriores e RLS preservados; backup das regras anteriores em `data/backups/rules-2026-10-10-before.json` (ignorado pelo Git).
- **Documentação:** CLAUDE/README/TODO descrevem a operação real; planos anteriores identificados como históricos. `pnpm start` passa a usar o mesmo launcher de `Iniciar Maia.bat`; o launcher antigo continua em `start:legacy`.
- **Escopo ampliado pelo owner:** incluir nas regras os recursos de Instagram desenvolvidos em paralelo no Claude: consultas de Stories/áudio/seguidores/Direct, resposta elegível em 24 horas e automações criadas pausadas, com aprovação para criar/ativar/pausar/excluir. A implementação paralela das ferramentas é preservada; disponibilidade depende do executor e da conta.
- **Ampliação de recursos:** catálogo 2026-10-10.2 registra foto, carrossel, Reels e Story, edição/cancelamento antes da publicação e privacidade do inbox/automações. Migração `20261010181720_maia_instagram_media_policy_alignment.sql` aplicada; hash ativo `5f40630d48d31010801c35e10eedcdd4507dcce36d943c5c00b6a56b0326c0ca`. Documento sincronizado.
- **Correções de fechamento:** Direct rejeita timestamp futuro; pedidos de aprovação mostram ação e conteúdo resumido e persistem a descrição legível; painel e manual atualizados; Codex tem as consultas, Direct, automações e formatos de publicação com os mesmos controles.
- **Verificação:** `pnpm db:validate`, `pnpm db:guard`, `pnpm typecheck`, `pnpm rules:check`, `pnpm rules:verify` e sincronização do conhecimento concluídos. A última suíte completa anterior a estas correções passou com 281 testes Vitest + 32 de banco; não foi repetida nesta revisão. Build mantém aviso de bundle acima de 500 kB. Conversas reais, inspeção autenticada do painel e ações externas não foram testadas; busca de áudio ainda depende de reconexão Facebook Login.


## 2026-10-10 — Confirmação de envio sem narrar o WhatsApp

- **Feedback do owner:** ao mandar mensagem para um contato (ex.: a Jéssica), a Maia respondia explicando "o WhatsApp aceitou o envio, mas ainda não dá para saber se ela leu" — informação irrelevante, já que o owner já usa WhatsApp e não precisa da mecânica interna.
- **Correção:** `server/rules.ts` (`EXECUTION_GUIDELINES`) deixa claro que o ID de mensagem é confirmação interna, não algo a explicar ao owner; a Maia agora só confirma que mandou, e só fala em leitura/resposta quando perguntada ou quando ela de fato ocorrer.
- **Verificação:** `pnpm typecheck` e `pnpm test` (254 vitest) aprovados. Mudança só de texto de prompt; sem teste automatizado possível para fraseado de LLM.

## 2026-10-10 — Áudio em grupo cadastrado

- **Bug corrigido:** áudio mandado dentro de um grupo cadastrado nunca chegava à Maia, mesmo chamando pelo nome na própria fala. **Causa:** `server/inbox.ts` só extraía texto (`conversation`/`extendedTextMessage.text`) no ramo de grupo; `audioMessage` não tinha nenhum tratamento ali e caía no fallback de "atividade do grupo" (sem baixar nem transcrever). A função que baixa áudio (`audioFrom`) só era alcançada para conversas privadas.
- **Correção:** `toInboxRow` agora também reconhece `audioMessage` em grupo cadastrado, decidindo ali o que já dá para saber sem o texto (menção à Maia, resposta a uma mensagem dela, ou continuação de conversa na janela de 10 min — mesma lógica de `addressedToMaia`). Nova função `handleGroupAudio` (`server/ownerRouter.ts`) transcreve pelo Whisper do owner, grava na memória do grupo (7 dias, com autoria, igual ao texto) e só chama `handleGroupMessage` se o pedido já estava endereçado ou se a própria fala transcrita chamou "Maia" (`CALLS_MAIA`, agora exportada de `inbox.ts`). `server/inboxWorker.ts` roteia o novo item `{ sender: "group", kind: "audio" }` para essa função.
- **Fora do escopo:** `server/webhookServer.ts` (porta 3100, caminho local antigo) não suporta grupo cadastrado nem para texto — não foi tocado; o caminho real em produção é `api/webhook.ts` → `inbox.ts` → `inboxWorker.ts`.
- **Verificação:** `pnpm typecheck` e `pnpm test` (254 testes vitest + 27 de banco) aprovados; novo teste em `tests/inbox.test.ts` cobre áudio em grupo cadastrado/não cadastrado, janela de conversa e `fromMe`.

## 2026-10-10 — Permissões sem moldura

- **Esclarecimento do pedido:** o incômodo era a moldura clara ao redor de cada permissão. Removidos borda, fundo branco e fundo verde dos itens selecionados; permanecem checkbox, título, descrição e indicador de seleção. Tamanho compacto e autorização preservados.
- **Verificação:** `pnpm build` e os 7 testes de Pessoas aprovados. Alteração apenas visual em CSS; inspeção visual no navegador não realizada e aviso de bundle acima de 500 kB permanece.

## 2026-10-10 — Permissões compactas

- **Ajuste solicitado:** os cartões de permissão ficaram altos demais. Altura mínima reduzida de 91 para 44 px, padding de 14×12 para 9×10 px e espaçamento entre cartões de 9 para 6 px; título e descrição continuam completos, sem corte de texto.
- **Grade:** colunas se ajustam à largura disponível do perfil, sem forçar uma coluna em todos os tamanhos abaixo de 1150 px. Em telas estreitas, os cartões continuam empilhados.
- **Verificação:** `pnpm build` e os 7 testes de Pessoas aprovados. Sem alterações de lógica ou autorização. Conferência visual no navegador não realizada; aviso de bundle acima de 500 kB permanece.

## 2026-10-10 — Pessoas

- **Interface:** substituídos os blocos repetidos de permissões por um diretório compacto e um perfil selecionado. Resumo de cadastros, busca por nome (sem exigir acentos) ou WhatsApp, filtros por status, iniciais por papel, números formatados e permissões em cartões; identidade marfim/dourado/verde preservada.
- **Responsividade e acessibilidade:** no celular, lista e perfil têm navegação de ida e volta. Campos rotulados, seleção/filtros com `aria-pressed`, foco visível, mensagens de erro/sucesso e estado de carregamento. Nenhuma dependência adicionada.
- **Acesso:** mantidos o RPC `is_owner`, as consultas existentes e o modo somente leitura; permissões do proprietário continuam protegidas. Nenhuma tabela, migration ou regra de RLS alterada.
- **Bug corrigido:** adicionar WhatsApp rejeitava números com espaços/parênteses porque removia apenas a letra `D` (`/D/g`). Agora remove caracteres não numéricos (`/\D/g`). Gravações têm bloqueio contra duplo clique e tratamento de falhas.
- **Cadastro parcial:** se a pessoa é salva mas o vínculo do número falha, a tela abre o perfil salvo e orienta a adicionar o número; o formulário não fica convidando a cadastrar a mesma pessoa novamente.
- **Verificação:** `pnpm typecheck` e `pnpm build` aprovados; `pnpm test`: 240 testes da aplicação (7 novos da tela Pessoas) e 27 testes de banco temporário aprovados. Interações da tela testadas com Supabase simulado, sem gravações no banco remoto. O build mantém o aviso de bundle acima de 500 kB.
- **Pendente:** inspeção visual autenticada em desktop/celular. O navegador desta sessão está indisponível; testes de DOM e build não substituem essa conferência.

## 2026-10-10

### Dois bugs reais confirmados na conversa (tarefas #5 e #6 do painel): status por participante e pedido de OK técnico
- **#6 — confirmado:** você pediu para adicionar a Gessica ao grupo "Operacional Worki Digital"; a Evolution aceitou (HTTP 200), mas ela **não entrou de fato** (você conferiu no grupo). Causa: `updateGroupParticipants` só olhava o HTTP geral; a Evolution devolve um status por número dentro do corpo (ex.: 403 quando a privacidade da pessoa exige convite em vez de adição direta), e isso nunca era lido. Corrigido: `parseParticipantOutcomes` lê o status de cada número; a ferramenta `grupo_gerenciar_participantes` agora diz exatamente quem foi confirmado e quem não, com o motivo quando é 403 (sugere `grupo_convite_link`/`grupo_enviar_convite`). `task_verified` só é gravado para quem foi de fato confirmado.
- **#5 — confirmado:** você reclamou duas vezes, nas suas palavras, do pedido de OK mostrando o nome técnico da ferramenta e o JSON cru (ex.: "mcp__maia__grupo_adicionar_participante" + `{"grupo":"..."}`). Corrigido: novo `server/actionDescriptions.ts` (`describeAction`) traduz a ação para português comum ("adicionar 1 pessoa no grupo \"X\""), usado no pedido de OK em `maiaOwnerAgent.ts` e `codexMaiaMcp.ts`. O JSON cru continua só no registro interno da aprovação (auditoria), nunca na mensagem que você recebe.
- Testes novos: `tests/actionDescriptions.test.ts` (7), mais 2 casos em `tests/groups.test.ts`. 253 testes no total. Tarefas #5 e #6 marcadas como concluídas no painel, com a evidência. **Não testado ao vivo.**

### Marcar mensagem como lida (markMessageAsRead), de forma honesta
- **Pedido do owner:** implementar `markMessageAsRead` "de forma profissional". Decisão: não é ferramenta do agente (ele poderia marcar como lido sem ter processado de verdade, o que seria falso para quem mandou). É um efeito automático, no worker, só quando a mensagem realmente entra para processamento: do dono, do aprovador, de membro autorizado, de grupo cadastrado e endereçado, e de contato que respondeu (`server/chats.ts`, `markMessagesRead`; `server/inboxWorker.ts`, `markRead`/`dmJid`). Nunca marca mensagem de grupo que ela não vai responder. Cosmético: falha nunca impede a resposta.
- Testes novos em `tests/chats.test.ts` (corpo da chamada, sem ids não liga a rede, erro não derruba quem chama). 244 testes no total.

### Mais endpoints da Evolution: grupo (info, participantes, convite) e conversas/contatos da instância
- **Pedido do owner:** uma lista de endpoints da Evolution ainda não usados pela Maia (grupos, mensagens, perfil). Implementei os de prioridade alta que são seguros e têm uso claro agora; o resto fica pendente, por decisão explícita (ver abaixo).
- **Generalizei** a ferramenta de participante criada ontem: `grupo_gerenciar_participantes` substitui `grupo_adicionar_participante` e agora aceita `adicionar`, `remover`, `promover` (admin) e `rebaixar` — um só endpoint da Evolution (`/group/updateParticipant`), um parâmetro de ação.
- **Novas ferramentas, grupo:** `grupo_info` (`findGroupInfos`, livre), `grupo_participantes` (`participants`, livre), `grupo_convite_link` (`inviteCode`, só owner — é um link sensível), `grupo_enviar_convite` (`sendInvite`, mesma regra de grupo cadastrado).
- **Novas ferramentas, conversas/contatos:** `conversas_listar` (`chat/findChats`, livre), `contato_instancia_buscar` (`chat/findContacts`, livre) — nova `server/chats.ts`.
- **Não implementado agora (decisão do owner pendente, não assumi sozinho):** `markMessageAsRead` (sem gatilho de uso hoje); renomear/descrever/trocar foto do grupo, revogar convite, configurar grupo, mensagem temporária, sair do grupo; enviar áudio/contato/localização/reação/figurinha/status, digitando, editar/arquivar/apagar mensagem; todo o bloco de perfil (nome/foto/recado/privacidade da própria Maia, perfil de terceiros) — muda a identidade pública da Maia ou expõe dados de terceiros.
- Regra do banco `grupos_acoes` atualizada. Testes novos: `tests/chats.test.ts`, mais casos em `tests/groups.test.ts` e `tests/approvalPolicy.test.ts`. 233 testes no total. **Não testado ao vivo** nenhuma das ferramentas novas (nem a generalizada).

### Adicionar participante a grupo existente; lembrete sem contexto; painel sem criação manual
- **Pedido recorrente do owner (3 vezes em 09–10/10):** "coloca a Gessica/Jéssica no grupo Operacional" — a Maia sempre respondia que não tinha ferramenta para isso (correto: só existia criar grupo novo). Nova ferramenta `grupo_adicionar_participante` (`server/groups.ts`, `addGroupParticipants`, `/group/updateParticipant`), com a mesma regra de acesso de `grupo_enviar_texto` (owner livre em grupo cadastrado; membro precisa de `mensagem.enviar`); `accessContext.ts` ajustado para calcular `groupRegistered` também para essa ferramenta. A resposta é honesta: confirma que a Evolution aceitou o pedido, não que a pessoa entrou de fato (sem endpoint de conferência conhecido).
- **Bug corrigido: lembrete chegava sem contexto.** Sintoma: o owner respondeu "feito, falei com ele" ao lembrete da tarefa #4, e a Maia disse não ter contexto de quem era a pessoa nem o assunto. Causa: `taskReminders.ts` mandava o lembrete direto pela Evolution, sem `recordMessage` — o texto nunca entrava na conversa que alimenta `conversationContext`. Corrigido: a mensagem do lembrete agora é gravada na conversa após o envio aceito (nunca se falhar). `EXECUTION_GUIDELINES` (server/rules.ts) ganhou a instrução de relacionar uma resposta vaga com o lembrete mais recente antes de perguntar de novo.
- **Painel "Tarefas e eficácia" sem criação manual** (decisão do owner: tudo deve nascer da conversa com a Maia, não de clique no painel). Removidos do `TarefasPage.tsx`: formulário de nova tarefa, formulário de novo lembrete e o formulário de avaliação humana manual. Ficou: editar/corrigir tarefa existente, reagendar/cancelar lembrete existente, reenviar entrega falha, e o resumo de relevância/resolução (sem o botão de salvar avaliação). O backend (`/api/workspace`) não foi alterado.
- Regras do banco atualizadas: `grupos_acoes` (nova ferramenta).
- Testes novos: `tests/taskReminders.test.ts`, mais casos em `tests/groups.test.ts` e `tests/approvalPolicy.test.ts`. 222 testes no total. **Não testado ao vivo:** adicionar participante de verdade a um grupo.

### Números do dono/aprovador não ficam mais escritos nas regras (painel)
- O owner notou, na tela "Regras da Maia", duas regras com o próprio número e o do aprovador escritos em texto puro (`criar_grupo`, `dono_numero`). Removidos do banco; o comportamento continua igual porque o número real passou a ser acrescentado ao prompt em tempo de execução, a partir do `.env` (`server/rules.ts`, `buildSystemPrompt`/`runtimeNumbers`), nunca gravado na tabela `maia_rules`.

### Integração LinkedIn via Zernio
- **Melhoria:** a Maia passou a consultar contas LinkedIn, páginas/organizações administradas e analytics pela Zernio; também pode publicar ou agendar texto e imagem no LinkedIn.
- **Segurança:** `linkedin_publicar` exige aprovação do owner, como a publicação no Instagram. DMs/InMail, comentários, seguir e prospecção continuam fora do escopo.
- **Painel:** Conexões e dados exibe o status "LinkedIn conectado" e o objetivo atual da integração.
- **Validação:** a chave existente em `.env` foi conferida contra a Zernio; há uma conta LinkedIn ativa e nenhuma organização retornada. `pnpm typecheck` passou; `pnpm test` passou com 214 testes da aplicação e 27 de banco.
- **Banco:** nenhuma tabela ou migration nova foi necessária; a integração usa o cliente server-side já existente e `ZERNIO_API_KEY` permanece fora do frontend.
- **Ajuste de interface:** o painel de Conexões e dados agora exibe Instagram e LinkedIn juntos no bloco de redes sociais da Zernio.

## 2026-10-10

### Membro conversa com a Maia no privado; áudio/imagem/vídeo/documento de membros e contatos
- **Decisão do owner:** membro cadastrado com a permissão `conversa.maia` fala com a Maia no privado, dentro do que pode (igual ao que já existia em grupos). Arquivo enviado por membro ou contato fica 7 dias (não 24 h, que é só para o dono), porque o owner pode pedir o arquivo de volta dias depois. Prospecção (contato por iniciativa da Maia) continua limitada a quem já aceitou falar com ela (`contato_enviar_mensagem`, já existente); nada novo foi liberado aqui.
- **Texto:** `server/inbox.ts` passa a aceitar um 7º parâmetro `members` (números com `conversa.maia`, carregado em `api/webhook.ts` por `membersWithConversa()`, join `person_permissions`→`people`→`person_numbers`); `server/maiaOwnerAgent.ts` ganha `handleMemberMessage` (mesma ideia de `handleGroupMessage`, mas a resposta sai no privado do membro, não num grupo; a aprovação pedida ao owner mostra "... no privado" em vez de "... no grupo"). A entrega usa `deliverResponse`/`response_deliveries`, que passou a distinguir dono (histórico comum) de membro/contato (`dm:<número>`, mesma convenção já usada por `contato_enviar_mensagem`).
- **Áudio e mídia de membro:** `server/ownerRouter.ts` ganha `handleMemberAudio`/`handleMemberMedia` (mesma transcrição e entendimento de imagem/PDF/Word/Excel/vídeo já feitos para o dono), com duas diferenças: o arquivo vai para `data/midia-membros` (7 dias, `MEMBER_MEDIA_DIR`/`MEMBER_MEDIA_TTL_MS`, não `data/midia`) e o metadado (quem mandou, tipo, nome, legenda, caminho) é gravado em `received_media`. `buildMediaPrompt` (server/media.ts) ganhou o campo opcional `sender`, para a frase inicial dizer quem mandou (dono continua "O dono enviou...", sem mudança).
- **Pedir o arquivo de volta:** ferramenta `mcp__maia__arquivo_reenviar` (só o owner; `server/evolutionSend.ts` ganhou `sendFile`, envio genérico de imagem/vídeo/documento conferido pelo id da mensagem) procura em `received_media` por nome/número de quem mandou (ou o mais recente, sem filtro) e reenvia ao owner.
- **Banco:** `supabase/migrations/20261010050000_maia_received_media_v1.sql` (tabela nova) e `20261010050100_maia_member_sender_v1.sql` (amplia `events.sender`/`inbox.sender` para aceitar `member`; só amplia, sem perda de dados). Aplicadas em produção com o OK do owner; `pnpm db:drift` sem divergência (583 objetos).
- **Segurança:** `handleMemberAudio`/`handleMemberMedia` conferem de novo a permissão `conversa.maia` (`canConverse`, nova em `server/access.ts`) antes de processar, para o caso de a permissão ter sido retirada entre o envio e o processamento. `arquivo_reenviar` entra na lista `OWNER_ONLY` (`decideAccess`).
- **Testes:** 15 novos (`tests/inbox.test.ts`, `tests/media.test.ts`, `tests/approvalPolicy.test.ts`, `tests/evolutionDelivery.test.ts`, `tests/receivedMedia.test.ts`). Em `tests/responseDelivery.test.ts`, os testes existentes passaram a fixar `EVOLUTION_OWNER_NUMBER` (antes dependiam, sem dizer, do único destinatário possível ser o dono); mais um teste cobre o destinatário novo (membro/contato). 211 testes no total.
- **Não testado ao vivo:** conversa de membro, áudio/mídia de membro e `arquivo_reenviar`. Precisa de um membro cadastrado (`membro_cadastrar`) e de um teste real pelo WhatsApp. **Pendente:** reiniciar a Maia.

### Aplicação do plano de eficácia: tarefas, lembretes, entrega e avaliação

- Fechamento documentado: implementação `e0e7407` enviada a main e deploy READY; 195 testes de aplicação e 27 de banco aprovados, 565 objetos sem divergência. Pendências explícitas: abrir `Iniciar Maia.bat` para ativar o worker local, realizar 20 avaliações humanas e inspecionar o painel autenticado. Detalhes em `docs/erros-e-mudancas.md`.

- Teste real pela LLM encontrou bloqueio de `tarefas_listar` pela aprovação interativa do CLI, apesar da autorização correta na ponte. Configuração explícita `default_tools_approval_mode = approve` apenas no servidor local Maia elimina a segunda pergunta impossível em modo não interativo. O gate `allowed/guarded` da Maia continua exigindo permissões/OK antes de qualquer efeito; sandbox read-only e rede do modelo continuam desligados. Consultas têm metadados read-only. Orientação conferida na documentação oficial de MCP do Codex.
- Revalidação pela LLM confirmou a consulta real de tarefas/lembretes via SDK; erros de chamada do transporte/política geram `tool_failed` mesmo com resposta textual. Ativação do worker em segundo plano recusada pela política da sessão; abrir `Iniciar Maia.bat` para consumo contínuo. Deploy inicial READY; rota nova sem login testada (401).
- Resumo/Indicadores passam a chamar os registros antigos de execuções, sem misturar sua conclusão com a página nova de trabalho. Plano atualizado com estado efetivo de cada etapa, incluindo ativação e revisão humana pendentes.
- Respostas aceitas são adicionadas ao contexto comum pelo consumidor da outbox, inclusive ao retomar após reinício; remove registro duplicado de resposta/conclusão no caminho imediato. Nenhum reenvio de parte aceita.

- Tarefas de trabalho separadas de `tasks` (execuções da IA): Pendente, Em andamento e Concluída; responsável, prazo em Brasília, revisão concorrente, histórico transacional e evidência informada obrigatória ao concluir. Atraso é calculado, não um estado adicional.
- Lembrete de prazo automático e lembretes manuais persistidos, editáveis/canceláveis enquanto pendentes; claim atômico e ID de aceitação. Reinício/timeout/erro 5xx fica incerto e não gera repetição. Conclusão cancela pendências. Envio em andamento não pode ser reagendado silenciosamente.
- As mesmas cinco ferramentas de trabalho são compartilhadas pelos SDKs Claude e Codex. Dados completos do owner exigem autorização para outros papéis; conectores exclusivos do Claude e regras de risco permanecem iguais. O comando `tarefa ...` deixa de criar apenas log de execução.
- Respostas WhatsApp persistidas antes do POST e divididas em partes de até 3000 caracteres. ID obrigatório; execução e entrega registradas separadamente. Corpo de erro não é salvo: diagnóstico controlado, sem número, texto ou segredo. Causa histórica do HTTP 400 não foi inventada.
- Retomada de partes pendentes após reinício não chama a LLM nem repete trabalho externo. Partes aceitas nunca são reenviadas; falhas definitivas exigem reenvio pontual pelo owner, resultados incertos exigem conferência manual.
- Nova página Tarefas e eficácia: cadastro/edição, estados, atraso, lembretes, falhas de entrega e revisão humana do pedido esperado, resposta e evidências. Relevância/resolução permanecem sem avaliação até revisão real; amostra abaixo de 20 é exploratória. Não altera pesos nem fabrica melhora histórica.
- API de produção requer JWT do proprietário; API local restrita a loopback com proteção same-origin. Tabelas novas com RLS, sem acesso direto de anon/authenticated; RPCs internas restritas a service_role. Migração aditiva `20261010040520_maia_work_tasks_reminders_reviews.sql`.
- Verificações e ativação: ver registro desta aplicação em `docs/erros-e-mudancas.md`. Navegador integrado indisponível nesta sessão (erro de inicialização), sem alegação de validação visual autenticada. Guardar `.temp` do Supabase fora do Git; não modificar o `.env` para contornar seu BOM.

### Corrigido e melhorado (qualidade, relevância e eficácia da Maia)

- Diagnóstico real: nota 3/10 limitada por dois falsos incidentes. `tool_use` de publicação bloqueada/expirada era tratado como escrita executada; agora apenas `external_done` dispara a auditoria de efeito externo. Aprovação deve vir antes, na mesma tarefa/operação, e vale uma vez. Recusas/expirações respeitadas contam como controles corretos.
- Precisão liga a prova à mesma tarefa/operação e à ordem dos eventos; prova repetida não infla a nota. O histórico do Codex com ferramenta e `kind: conversa` entra na amostra sem reescrever o banco; novos usos marcam o tipo operacional.
- Codex registra efeitos/provas de artes, mensagens, enquetes e Instagram, consulta o estado do post e registra `dm_sent` para o limite já previsto de mensagens a contatos. Bloqueios, falhas de ferramenta e expirações ficam identificados.
- `operacao_resumo` dá aos dois modelos uma consulta ao estado atual no banco, com pedidos recentes, aprovações e conexões. O resumo interno é do owner; membro/visitante requer aprovação. Orientações comuns cobram consulta real, resposta útil, resultado conferido e nenhuma promessa de lembrete inexistente.
- Painel mostra amostras por dimensão, prioridades com evidência, falhas de envio, falhas incluindo conversas simples, ações sem prova e mediana/p95. Execução encerrada não é apresentada como resolução comprovada do pedido.
- Plano em `docs/plano-eficacia-maia.md`; auditoria somente leitura em `scripts/quality-report.ts`. Sem alteração de esquema ou eventos históricos. Reavaliação: 8,15/10 sobre os mesmos 106 registros; precisão continua 3 de 9. Isso corrige a nota, não o passado.
- Pendências: causa específica do HTTP 400 no envio, revisão dos dois resultados incertos, teste real das ferramentas, inspeção visual e módulo futuro de tarefas com prazo/lembretes.
- Verificação: 174 testes de lógica/renderização e 24 de banco temporário passaram, além de TypeScript/build. Consulta real pela ponte do Codex leu 106 registros, quatro conexões e dez pedidos recentes, sem mensagens/publicações. O worker precisa carregar a nova versão; o build mantém aviso de bundle acima de 500 kB.

### Corrigido (status do WhatsApp aparecia como "Não verificado")
- Causa observada: a tela tratava somente o texto minúsculo `open` como conectado e usava "Não verificado" quando o estado vinha vazio, misturando ausência de leitura com conexão inativa.
- A consulta direta à Evolution nesta sessão respondeu HTTP 200 e `state: open`.
- A interface agora reconhece estados conectados/desconectados sem diferenciar maiúsculas e exibe "Sem leitura do estado" quando a API não informa o estado. O resumo global usa a mesma normalização.

### Corrigido (Indicadores e Conexões exibiam dados semelhantes)

- Problema: ambas as telas usavam cartões de gasto, e-mails não lidos e planilhas recentes, misturando resultados com diagnóstico de integrações.
- Conexões e dados passou a usar tabelas de serviços e sincronização: estado observado, última tentativa e diagnóstico. A coleta fica desatualizada após 60 minutos; ausência de dados não aparece como conexão ativa. O registro atual não informa separadamente o horário do último dado bom quando há erro.
- Indicadores passou a mostrar entrega operacional da semana: pedidos, taxa de resposta, taxa de conclusão entre tarefas encerradas, falhas, resultados incertos e aprovações pendentes atuais. Mostra também nota operacional, ações conferidas e percentual de respostas em até dois minutos.
- Investimento do Meta Ads fica em Indicadores, separado por moeda e identificado pela data da coleta. CTR, CPC, conversões e ROAS dependem de uma futura ampliação da coleta (etapa 2, ainda não implementada).
- Mudança apenas na apresentação: usa o contrato de dados existente, sem migração ou alteração na coleta.
- Verificação: TypeScript e build de produção passaram. A revisão de React conferiu dependências/limpeza do polling, estados vazios, tabelas e ausência de valores inventados. Ainda sem inspeção visual no navegador autenticado.

## 2026-10-09

### Corrigido (fallback do Claude para o Codex no limite)
- O classificador agora reconhece limite semanal do Claude Agent SDK (`weekly limit`), registra o cooldown e encaminha a próxima mensagem ao Codex.
- Cumprimentos repetidos como `oii` e qualquer mensagem elegível seguem para o Codex enquanto o Claude estiver em cooldown.

### Alterado (Codex via SDK com ferramentas internas)
- `@openai/codex-sdk` substituiu a chamada bruta ao CLI. No Windows, o SDK usa o `codex.exe` nativo; o atalho `codex.cmd` não funciona com o `spawn` do SDK.
- Novo `server/codexMaiaMcp.ts`: ponte MCP local para conhecimento, contatos, grupos/enquetes, artes, Instagram, imagem, agendamento e cadastro de membros.
- `grupo_criar` entrou na ponte: usa o mesmo fluxo persistido do roteador do owner (somente owner, participantes com DDI/DDD, aprovação do tipo grupo e criação na Evolution somente depois do OK).
- A ponte reaplica permissões e aprovações. Credenciais do Supabase, Evolution e Zernio ficam somente no servidor e no `.env`, nunca no modelo.
- Conectores exclusivos do Claude (Gmail, Meta Ads, Drive/Sheets e Agenda) continuam fora do Codex. Não houve migração de banco: são usadas as tabelas e funções existentes.
- Verificado: SDK respondeu pelo Codex e `buscar_conhecimento` retornou dados reais do banco. O typecheck completo foi bloqueado por memória/espaço insuficientes neste PC; sintaxe e diff foram validados.

## 2026-10-08

### Adicionado (registro do launcher em arquivo)
- **Logs em disco** (`scripts/start.ts`): a saída do webhook, do painel e do túnel e os eventos do launcher (início, parada, reinício, erro) são gravados em `logs/<origem>-AAAA-MM-DD.log`, com data e hora em UTC. A janela continua mostrando tudo.
- **Motivo de parada registrado:** Ctrl+C, janela fechada, erro não tratado, webhook ou túnel saindo com código e sinal.
- Pasta `logs/` ignorada pelo git.

### Alterado (launcher abre a Vercel)
- Ao iniciar, o launcher abre `https://agent-maia.vercel.app` em vez de `localhost:3000`. O painel local continua disponível em `localhost:3000` quando o Vite está rodando.

### Alterado (números do dono e do aprovador trocados)
- **Dono:** EVOLUTION_OWNER_NUMBER (conversa com a Maia). **Aprovador:** EVOLUTION_APPROVER_NUMBER (SIM/NÃO das ações de escrita).
- Trocados: tabela `person_numbers` no Supabase (página Pessoas), `.env` local e CLAUDE.md.
- **Pendente:** na Vercel, ajustar `EVOLUTION_OWNER_NUMBER` = EVOLUTION_OWNER_NUMBER e `EVOLUTION_APPROVER_NUMBER` = EVOLUTION_APPROVER_NUMBER, e fazer Redeploy.

### Alterado (configuração de autenticação do Supabase)
- Site URL trocado para https://agent-maia.vercel.app (links de convite e recuperação agora abrem o painel da Vercel).
- Endereços permitidos: a Vercel e o localhost:3000 (para testes locais).
- Cadastro público desligado. O proprietário continua entrando, e convites feitos pelo administrador continuam funcionando.
- Feito pela API de gestão do Supabase, com o token guardado no .env. Login do proprietário confirmado depois da mudança.

### Decidido (envio a grupos com aprovação)
- Regra no CLAUDE.md: envio a grupos só com `SIM <número>` do aprovador, por ação, a grupo validado pelo JID. Nada foi implementado ainda.
- Pendente: JID do grupo Operacional Worki Digital; decisão sobre o escalonamento automático.
- Achado: a instância `wt_yrxexuou6jwp` apareceu com estado `close` numa consulta e `open` em outras, com o perfil "Herickson Maia". Ou seja, a queda foi intermitente, não permanente. Confirmado `open` no fim da sessão.
- Grupo operacional: o pedido autorizado dentro do grupo é o EVOLUTION_OWNER_NUMBER. Criar o grupo passa pela aprovação. Pendente: escopo de conectores dentro do grupo.

### Adicionado (aviso ao Herickson quando pedirem algo que a Maia não faz)
- Ferramenta mcp__maia__avisar_dono: envia ao privado do Herickson o pedido e quem pediu. Liberada nos dois canais do dono.
- Regra 7 do banco: diz que não faz, avisa o Herickson e não promete prazo.
- Pendente: reiniciar a Maia no PC.

### Adicionado (a Maia entende imagem, vídeo e documento do WhatsApp)
- **Pedido do owner (2026-10-09):** o agente precisa ler imagens, vídeos e documentos enviados no WhatsApp. Só do número do dono; de outros números nada é baixado.
- **Fluxo:** o webhook grava só a referência (tipo `media` na fila `inbox`); o worker baixa pela Evolution (limites: imagem 10 MB, documento 20 MB, vídeo 50 MB), salva em `data/midia` (apagado em 24 h), avisa "Recebi…, analisando" e trata o resultado como um pedido do dono, com as mesmas permissões e aprovações do texto. A legenda é o pedido.
- **Imagem e PDF:** o agente lê pelo caminho com a ferramenta Read. **Texto, CSV, JSON:** conteúdo inline (até 12 mil caracteres). **Word (.docx) e Excel (.xlsx):** texto extraído (biblioteca `fflate`). **Vídeo:** 4 quadros (ffmpeg) + áudio transcrito pelo Whisper do owner (até 180 s de áudio; acima de 10 min só quadros). Outros formatos: a Maia diz quais aceita.
- **Segurança:** o conteúdo do arquivo é tratado como dado, nunca como instrução. As ferramentas internas do agente passaram a ser limitadas por quem pede (`decideBuiltin`): o dono lê o projeto (nunca `.env`, `.git`, `.ssh`, `node_modules`); membros e visitantes só leem `data/midia`; ferramentas internas desconhecidas só para o dono. Antes, Read/Grep estavam liberados sem limite.
- **Banco:** migração `20261009224229_maia_inbox_kind_media` amplia `inbox.kind` para aceitar `media` (só amplia valores; sem perda de dados). **Aplicada em produção em 09/10/2026 com o OK do owner** (versão 20261009224229 no histórico do Supabase; `db:drift` sem divergência), antes do merge do código.
- `classify` do webhook passou a reconhecer imagem, vídeo e documento como mensagem (antes caíam em "desconhecido").
- Testes: 14 novos (referência de mídia, fila só do dono, docx/xlsx, prompts, limites de leitura, vídeo com ffmpeg real); os testes de banco rodam no executor nativo do Node (`pnpm test:db`, com uma nova tentativa automática) porque o PGlite derrubava os workers do Vitest no Windows com pouca memória livre.
- **Pendente:** reiniciar a Maia; testar com arquivos reais (a transcrição do vídeo leva de 30 a 90 s).

### Adicionado (transcrição de áudio do WhatsApp pelo Whisper do owner)
- **Decisão do owner (2026-10-09):** áudios do dono são transcritos pelo servidor Whisper dele no EasyPanel ("Whisper Official API", modelo small, CPU). `WHISPER_API_URL` e `WHISPER_API_KEY` ficam só no `.env`; o áudio não vai para terceiros nem é gravado.
- `server/transcribe.ts`: `POST /transcribe?language=pt&task=transcribe` (multipart `audio_file`), com tentativa extra se o servidor estiver reiniciando (502/503/504), tempo máximo de 240 s e erros sem a chave. A Maia avisa "Recebi o áudio, transcrevendo…", mostra o que entendeu ("Entendi: …") e trata o texto como se tivesse sido digitado (mesmas permissões e aprovações).
- **Medido:** o servidor leva de 27 a 64 s para 2 s de áudio (CPU, primeiro uso carrega o modelo) e o contêiner reiniciou (502 por ~100 s) após a primeira chamada. Áudios longos podem demorar mais; a chave não é exigida hoje pela API (a Maia envia mesmo assim).
- Testes: 4 novos (envio, nova tentativa, áudio vazio, erros sem vazar a chave). **Pendente:** reiniciar a Maia e testar com um áudio real; imagens, vídeos e documentos (próxima etapa, exige migração do `inbox`).

### Adicionado (migrações versionadas, validação automática e detecção de drift)
- **Problema:** das 18 migrações aplicadas no Supabase, só 2 tinham arquivo no repositório (sem versão). As outras 16 existiam só no histórico do Supabase.
- **Baseline:** as 18 migrações foram recuperadas exatamente de `supabase_migrations.schema_migrations` e gravadas em `supabase/migrations/AAAAMMDDHHMMSS_nome.sql` com a versão e o SQL do histórico. As 2 cópias antigas (reformatadas, sem versão) foram trocadas pelas versões exatas. Nada foi aplicado, recriado ou apagado na produção.
- **Auditoria:** esquema real x migrações = 449 objetos comparados, 0 divergências. Código x banco: as 28 tabelas e 11 funções usadas pelo código existem nas migrações. Relatório em `docs/database-audit-2026-10-09.md`.
- **Validação (`pnpm db:validate`):** aplica todas as migrações do zero num Postgres temporário (PGlite + pgvector), confere tabelas, RPCs, constraints, RLS e políticas essenciais e barra uso de tabela/função que nenhuma migração cria.
- **Guarda de PR (`pnpm db:guard`):** migração existente alterada/apagada, comando destrutivo sem `-- destrutivo-aprovado:` e migração sem CHANGELOG falham.
- **Drift (`pnpm db:drift`):** compara o Supabase real com as migrações, somente leitura (consulta recusa qualquer escrita), sem imprimir segredos; gera `db-drift-report.md`. Nunca altera a produção.
- **CI (`.github/workflows`):** `ci.yml` (typecheck, db:validate, db:guard, testes) em todo PR; `db-drift.yml` diário; `db-apply.yml` manual, em ambiente protegido, com simulação antes de aplicar. PR com checklist de banco.
- **Testes de banco:** `tests/db/migrations.nodetest.ts` (executor nativo do Node: `pnpm test:db`) (23 testes): reconstrução do zero, RPCs (fila `inbox`, lotes, cota de imagens, agendamentos, memória das conversas, busca de conhecimento), RLS (anon/authenticated sem acesso), constraints (inclui regressão do `people_role_check`) e drift.
- **Edge Function `embed`** versionada em `supabase/functions/embed/index.ts` (só existia no Supabase). `supabase/config.toml` mínimo para o CLI.
- **Regra permanente** em `CLAUDE.md` e `docs/database-migrations.md`. Comandos novos: `db:new`, `db:validate`, `db:guard`, `db:drift`.
- **Pendente (precisa do owner):** segredos `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_REF` no GitHub, ambiente `production` com revisor, proteção da `main` exigindo o check "CI / validate". Corrigir o nome `SUPABASE_ACCESS_TOKKEN` no `.env`.

### Corrigido (erro 500 ao listar grupos: rate-overlimit do WhatsApp)
- **Sintoma:** a Maia respondeu que `GET /group/fetchAllGroups` devolvia erro 500. O banco não tinha nenhuma ocorrência (a consulta falhou sem virar tarefa com erro).
- **Causa (confirmada chamando a Evolution direto):** resposta `{"status":500,"response":{"message":"rate-overlimit"}}`. É o limite do próprio WhatsApp para consultas de grupos, não defeito da instância. Valia para `getParticipants` falso e verdadeiro. A Maia consultava a lista a cada resolução de grupo (nome para identificador), a cada checagem de permissão, no painel e na conferência de grupo criado, e repetia a chamada mesmo após o limite.
- **Correção:** (1) o nome do grupo é resolvido primeiro pelos grupos cadastrados no banco (`maia_groups`), sem consultar o WhatsApp; (2) cache da lista de 5 para 15 minutos; (3) ao receber `rate-overlimit`, para de consultar por 10 minutos e usa a última lista; (4) a criação de grupo confere pelo id devolvido na resposta da própria Evolution, e só consulta a lista se esse id faltar; (5) a mensagem de erro diz que é limite do WhatsApp.
- **O que fazer:** esperar o limite passar (costuma ser minutos) e reiniciar a Maia. Não é preciso mexer na instância. Teste novo cobre o cooldown (137 testes).

### Corrigido (cadastro de membro falhava com people_role_check)
- **Sintoma:** ao pedir para cadastrar a Max Hellen (5511982033172), a Maia respondeu que o banco recusou com `people_role_check`; a mensagem para ela também não saiu. **Causa:** meu código (`registerMember`) gravava o papel `membro`, mas a tabela `people` só aceita `proprietario`, `aprovador` e `equipe`. Passou despercebido porque o teste não toca o banco.
- **Correção:** o cadastro usa o papel `equipe`. A Max Hellen foi cadastrada direto no banco (conversa e resumo) e entrou na agenda de contatos. **Lição:** valores gravados em tabelas com CHECK precisam ser conferidos contra a constraint antes de dizer que está pronto. **Pendente:** reiniciar a Maia; pedir de novo a mensagem para a Max Hellen.

### Adicionado (permissões por pessoa, memória dos grupos, contatos e mensagem direta)
- **Decisão do owner:** aprovação (OK) só para ação pública ou de risco. O que o owner pede em privado ou em grupo cadastrado (mensagem a contato, mensagem em grupo cadastrado, planilha, e-mail, evento, apagar) a Maia faz sem pedir confirmação. Membros têm permissões próprias; fora delas, a Maia pede o OK do owner (no grupo ou no privado), dizendo quem pediu.
- **Controle por código** (`server/access.ts`, `decideAccess`): papéis owner / membro / visitante, permissões da tabela `person_permissions` (nova: `mensagem.enviar`). Lista pública/risco em `server/approvalPolicy.ts` (Instagram, anúncios, compartilhar arquivo, DM de Instagram). Grupo não cadastrado e mais de 3 contatos no mesmo pedido pedem OK. O dono só é reconhecido pelo número real; sem número, vira visitante.
- **Memória das conversas** (`group_messages`, 7 dias, `purge_group_messages`): em grupo cadastrado todo texto entra, com autoria (número, nome, hora); a Maia só responde quando chamada. O contexto vem do banco (sobrevive a reinício) e também vai ao privado do owner. Texto de outras pessoas é tratado como informação, nunca como ordem.
- **Agenda de contatos** (`contacts`): preenche sozinha com quem fala nos grupos; busca por nome sem acento, apelido ou número; nome ambíguo faz a Maia perguntar. Ferramentas: `contato_buscar`, `contato_enviar_mensagem`, `membro_cadastrar` (só owner).
- **Mensagem direta:** envio conferido pelo id da mensagem; limites: 3 contatos por pedido sem OK, 20 por hora, sem repetir o mesmo texto ao mesmo contato em 24 h. Registro em `outreach`. A resposta do contato (48 h) entra na fila com texto, é guardada na conversa `dm:<número>` e repassada ao owner.
- Regras do banco: `aprovacao`, `proatividade`, `grupos_privacidade`, `grupos_acoes` reescritas; nova `contatos_membros`.
- **Aviso aos participantes:** o grupo passa a guardar o texto por 7 dias; avise o grupo. **Não testado ao vivo:** mensagem direta, resposta de contato e reconhecimento do owner dentro do grupo (depende do número real do participante). **Pendente:** reiniciar a Maia.

### Corrigido (Maia dizia que não lê grupos e que não tinha acesso a planilhas)
- **Sintoma (14:23 e 14:45, privado):** "Crie a planilha que foi solicitado lá no grupo" -> a Maia respondeu "não leio nem guardo as mensagens dos grupos" e "não tenho acesso ao Google Sheets agora".
- **Causa 1:** a regra `grupos_privacidade` no banco, de antes do atendimento em grupo, dizia que mensagens de grupo não têm texto guardado; o modelo seguiu a regra velha. Além disso o privado não recebia nenhuma fala do grupo, então ela não tinha como saber o pedido.
- **Causa 2:** nas tarefas 59 e 61 ela nem tentou procurar ferramenta (nenhum `tool_use`); na tarefa 60 (grupo, 14:30) só rodou ToolSearch e respondeu sem criar nada. O Drive cria planilha (`create_file` com `application/vnd.google-apps.spreadsheet` ou CSV), mas nenhuma regra dizia isso, e os conectores são ferramentas adiadas que precisam de ToolSearch.
- **Correção:** regra `grupos_privacidade` reescrita para a realidade; nova regra `conectores_ferramentas` (29): procurar a ferramenta com ToolSearch antes de dizer que não tem, como criar planilha/documento pelo Drive e devolver o link, propor padrão em vez de só perguntar. O privado agora recebe as falas recentes dos grupos (30 min, em memória).
- **Limite:** o pedido de 14:13 nunca chegou à Maia (antes da correção do webhook) e a memória dos grupos some se o worker reiniciar. **Pendente:** reiniciar a Maia.

### Corrigido (Maia não respondeu a continuação da conversa no grupo)
- **Sintoma:** no grupo, a Maia ofereceu criar a planilha de CRM e o Herickson respondeu "Cria uma planilha e depois me envia o link aqui!" (14:13); ela não respondeu. **Causa:** o texto só entrava na fila se a mensagem trouxesse a palavra "Maia"; a resposta não trazia.
- **Correção:** a mensagem vale como dirigida à Maia se (1) chama pelo nome, (2) menciona ou responde (cita) uma mensagem dela, ou (3) é da mesma pessoa com quem ela falou nos últimos 10 minutos (`maia_groups.last_reply_at` e `last_reply_to`, migration `maia_groups_last_reply`). Pessoas diferentes continuam precisando chamar pelo nome.
- A Maia agora lembra as últimas falas do grupo (30 min, só em memória) para entender "cria a planilha" depois de oferecer a planilha. Cache do webhook caiu para 10 s.
- **Pendente:** reiniciar a Maia. Até lá, o pedido do 14:13 não foi atendido: mande de novo.

### Adicionado (a Maia responde no grupo operacional)
- **Sintoma:** mensagem "Maia, a reunião com o lead foi sensacional…" no grupo "Operacional Worki Digital" ficou sem resposta (duas vezes). **Causa:** o grupo nunca tinha sido ligado ao agente: o webhook só contava atividade do grupo, sem texto, e o worker não respondia.
- **Correção:** só no grupo operacional (tabela `maia_groups`), e só quando a mensagem chama "Maia", o texto entra na fila (apagado em 24 h; outros grupos e outras mensagens continuam sem texto). O worker roda o agente, responde no próprio grupo começando pelo nome de quem pediu e, se for ação que altera algo, pede o OK ao owner no privado dizendo quem pediu (`handleGroupMessage`). Relato que não é pedido: a Maia reconhece e pergunta o que fazer.
- **Sem configuração manual:** todo grupo que a Maia cria entra sozinho em `maia_groups` (migration `maia_groups_v1`) depois de conferido na lista da instância; o webhook da Vercel consulta a tabela (cache de 60 s). Grupo que já existia pode ser cadastrado pela ferramenta `grupo_cadastrar` (com OK do owner). Grupo novo em que a Maia foi apenas adicionada: o dono escreve nele "Maia, cadastra este grupo" (ou "passa a atender"); só a mensagem do número do dono vale, e a Maia confirma no grupo. O grupo Operacional Worki Digital já foi cadastrado.
- **Pendente:** reiniciar a Maia; o deploy da Vercel sai com o push.

### Adicionado (ações em grupos, apagar e convites com aprovação)
- **Política:** agora também pedem aprovação (OK/NÃO): apagar (qualquer ferramenta de conector com delete/trash no nome), criar/alterar/responder evento da agenda (convites) e as ações novas de grupo.
- **Ferramentas de grupo** (`server/groupTools.ts`, expostas em `maiaImageTool.ts`): `grupo_enviar_texto` (com menção por número ou por nome de Pessoas; o texto ganha @número), `grupo_enviar_enquete`, `grupo_ler_enquetes` (livre; lê pela Evolution as enquetes e a contagem, e mostra "—" quando a Evolution não informa votos) e `grupo_agendar` (texto ou enquete em horário futuro, até 90 dias). O grupo é achado pelo nome na lista da instância (JID), com nome único.
- **Agendamento:** tabela `scheduled_actions` + função `claim_due_actions` (migration `maia_scheduled_actions_v1`, também em `supabase/migrations/`). A aprovação é pedida ao agendar; o worker confere a cada 30 s e envia uma vez. Falha avisa o dono e não repete; envio interrompido por reinício vira falha.
- **Conferência:** envio só conta como entregue com o id da mensagem aceito pela Evolution (`task_verified`).
- Regras do banco: `aprovacao` reescrita, `grupos_acoes` nova (28), `identidade` atualizada.
- **Não testado ao vivo:** envio de texto/enquete e a contagem de votos (nenhuma enquete existia no grupo). A leitura rodou contra a Evolution e voltou vazia. **Pendente:** reiniciar a Maia; testar uma enquete no grupo Operacional.

### Alterado (aprovar com OK)
- O aprovador agora responde **OK** (ou SIM) para aprovar e NÃO para recusar; os pedidos passam a dizer "Responda OK ... ou NÃO". Número só é necessário com mais de um pedido aberto. "OK" só vale com um pedido aberto e a mensagem inteira sendo "ok" (frases como "ok, muda a legenda" não aprovam).

### Alterado (política de aprovação reduzida)
- **Decisão do owner:** aprovação só para publicar/postar, enviar mensagem (e-mail, privado, outro grupo) e subir anúncios. Antes, qualquer ferramenta fora das leituras pedia SIM/NÃO.
- Novo `server/approvalPolicy.ts` (`requiresApproval`), usado na permissão do WhatsApp e na detecção de escrita sem aprovação do indicador de risco (que também deixa de acusar ferramentas locais seguras). Regras `aprovacao`, `aprovacao_regras` e `proatividade` do banco reescritas. Pelo painel, escrita continua recusada.
- Sem aprovação agora: ações internas dos conectores (rascunhos, etiquetas, eventos de agenda, apagar/arquivar). Atenção: apagar não está na lista.
- **Pendente:** reiniciar a Maia.

### Alterado (objetivo da Maia)
- Regra `identidade` no banco e seção Objetivo do manual (`src/data/manual.ts`, página Operação) reescritas: incluem Instagram, artes, precisão e conferência, proatividade e aviso ao Herickson. Lista de "ainda não faz" mantida.

### Alterado (launcher não sobe mais a porta 3000)
- **Sintoma:** ao iniciar a Maia, a porta 3000 era ocupada pelo painel local (Vite), conflitando com o Bryan, que também usa a 3000. **Causa:** `scripts/start-worker.ts` subia o painel local junto com o worker. **Correção:** o launcher sobe só o worker; o painel é o da Vercel. Para o painel local, `pnpm dev`.

### Adicionado (precisão e conferência: instrução e indicador)
- **Problema:** o indicador Precisão e conferência (25% da nota) ficava zerado: o sistema registrava `external_done` (ação feita) mas nunca `task_verified` (ação conferida), e nenhuma regra mandava conferir.
- **Regra no banco:** `precisao_conferencia` (27): conferir na fonte antes de dizer "feito", dizer com clareza quando não der para conferir, perguntar quando faltar dado.
- **Conferência real, gravando `task_verified`:** criação de grupo (o nome precisa aparecer na lista da instância; senão grava `verification_failed` e avisa que não está confirmado); publicação no Instagram (lê o post de volta na Zernio, `getPostStatus`); arte enviada (id da mensagem devolvido pela Evolution, `sendOwnerImage` agora retorna esse id).
- A ferramenta `instagram_publicar` e o envio de arte pela ferramenta agora gravam os eventos na tarefa (`createImageServer(channel, taskId)`).
- Testes novos: grupo existente/inexistente, status do post, cálculo do indicador.
- **Pendente:** reiniciar a Maia no PC.

### Adicionado (proatividade: instrução e indicador)
- **Regra no banco:** `proatividade` (26). A Maia avisa o Herickson, sem pedido, de conexão com erro, aprovação parada, gasto fora do esperado e riscos ou oportunidades que perceber, e sugere o próximo passo. Proatividade é avisar e propor: nunca age sem aprovação nem contata terceiros por conta própria.
- **Indicador Proatividade (15% da nota):** já existia no painel, mas nunca tinha dados, porque nenhum aviso gravava os eventos que ele conta. Agora todo aviso automático (resumo diário, alerta de conexão, aprovação parada, gasto do Meta Ads) vira uma tarefa de conversa com os eventos `handoff` (enviado) e `handoff_confirmed` (entrega confirmada). Falha de entrega grava `handoff_failed` e aparece em Ocorrências.
- **Cálculo:** avisos confirmados sobre avisos enviados, na semana. Sem aviso enviado, continua sem nota.
- **Verificado de verdade:** com um aviso entregue e outro que falhou, a nota da semana foi de sem nota para 5 de 10; os registros de teste foram apagados e a nota voltou ao estado anterior. 108 testes.
- **Achado, não corrigido:** a dimensão Precisão e conferência está em 0, porque há ações externas concluídas (artes enviadas) e nenhuma conferência registrada (`task_verified`). O ponto já estava pendente no plano do painel. Decidir o que conta como conferência antes de ligar isso.
- **Pendente:** reiniciar a Maia no PC para os avisos passarem a ser registrados.

### Adicionado (integração com o Instagram pela Zernio)
- **server/integrations/zernio.ts:** cliente da API (`zernio.com/api/v1`, chave Bearer). Consulta de contas, desempenho dos posts, artes recentes e envio de imagem; publicação de um post com legenda e imagem, imediata ou agendada.
- **Ferramentas da Maia:** `instagram_desempenho` e `artes_recentes` (leitura, sem aprovação) e `instagram_publicar` (escrita: passa pelo fluxo de aprovação por número, com a legenda e a arte no pedido).
- **Proteções:** só imagens PNG ou JPEG de até 8 MB dentro de `data/arte`; legenda de até 2200 caracteres; endereço da imagem https; agendamento só no futuro; erro da Zernio nunca traz a chave; recusa do Instagram (207 failed) não conta como publicado; falha não repete sozinha.
- **Regras no banco:** regra 1 atualizada e nova regra `instagram`. O resultado da arte passou a informar o caminho do arquivo, para a Maia poder publicá-la.
- **Corrigido na revisão:** a classe de erro usava propriedade no construtor, que o Node em modo de remoção de tipos não executa (o worker quebraria ao iniciar, embora os testes passassem). Agora o campo é declarado de forma explícita.
- **Verificado de verdade:** conta `hericksonmaia` ativa, leitura dos posts reais com métricas, listagem de artes, envio de imagem ao armazenamento da Zernio com endereço público respondendo 200 como PNG. 108 testes, typecheck e build passando.
- **Não testado ao vivo:** a publicação em si (criaria um post real no Instagram sem a sua aprovação). Está coberta por testes unitários com a rede simulada.
- **Fora de escopo, de propósito:** mensagens diretas, comentários, seguir e prospecção. A API da Zernio tem caixa de entrada com conversas reais, e ler ou responder exige decisão sua sobre texto de terceiros.
- **Pendente:** reiniciar a Maia no PC.

### Adicionado (Maia multi-IA: roteador, fallback seguro e arte direta)
- **server/ai/**: tipos, configuração (`config/ai-routing.json`), classificador por regras (plano B do Jev), roteador puro, capacidades por provedor, classificador de erros, circuit breaker persistido (`provider_health`), política de fallback, rastreador de uso e provedores (Claude e Codex).
- **Roteamento:** conversa e resumo simples vão ao modelo econômico (haiku); análises ao principal; arte direto ao executor criativo, sem chamar o Claude; carrossel responde que ainda não existe, sem simular.
- **Fallback Claude para Codex:** só para texto (conversa e resumo), só com erro de provedor confirmado (limite, indisponibilidade, timeout) e sem efeito externo iniciado. Autenticação, permissão, orçamento e limite de passos nunca disparam troca. Cada troca é registrada.
- **Jev:** passou a devolver intenção, complexidade e risco (colunas novas em `jev_triage`). Continua em modo sombra: só decide com `jev.activeRouting` ligado, confiança mínima e risco baixo.
- **Arte direta:** `server/creative/creativeRouter.ts`, com cota diária atômica (`claim_image_quota`, fuso de Fortaleza, padrão 10, devolvida se a geração falhar com certeza) e entrega pelo WhatsApp.
- **Métricas:** `agent_runs` ganhou provedor, modelo, categoria, complexidade, motivo, tokens, duração, fallback e classe do erro. Valor não informado pelo provedor fica nulo.
- **Painel:** página Modelos e Roteamento (saúde dos provedores, execuções por modelo, categorias, trocas de provedor, artes do dia).
- **Verificado de verdade:** Codex respondeu texto em modo somente leitura (6 s); com o Claude forçado a limite, a Maia respondeu pelo Codex e registrou a troca (4 s), e o Claude foi restaurado; arte direta gerada em 50 s e enviada ao WhatsApp, tarefa concluída e cota 1 de 10; métricas lidas do banco de produção. 97 testes, typecheck e build passando.
- **Só simulado (testes unitários):** a decisão de fallback DEPOIS de um erro real do SDK (não foi possível provocar um limite verdadeiro), o circuit breaker em tempo real e o roteamento ativo pelo Jev.
- **Não implementado:** motor de carrossel (precisa de renderizador, fontes e identidade visual por cliente); executor central de ferramentas compartilhadas entre Claude e Codex (o Codex não herda os conectores e não recebeu nenhuma ferramenta); cache e otimização de contexto além do que já existe.
- **Pendente:** reiniciar a Maia no PC.

### Corrigido (Maia sem contexto da conversa)
- O agente não recebia as mensagens recentes e respondia que não lembrava. Agora o pedido leva as mensagens do dono e da Maia dos últimos 30 minutos (server/context.ts).
- Testes: 65 passando. Pendente: reiniciar a Maia.

### Corrigido (pedido natural de criar grupo prometido sem aprovação)
- Causa: pedido fora do formato ia para o agente, que não tem ferramenta de grupo e confirmou sem criar aprovação.
- Correção: parseGroupIntent no roteador; com "me coloca" ou "com você", o dono entra como participante e a aprovação é criada de verdade.
- Testes: 62 passando.
- Pendente: reiniciar a Maia.

### Alterado (webhook da Evolution trocado para a Vercel)
- Instância `wt_yrxexuou6jwp` agora envia os eventos para https://agent-maia.vercel.app/api/webhook (com o token). Mensagens entram na fila do Supabase e o worker responde.
- Teste ponta a ponta: mensagem do dono pela Vercel entrou na fila, o lote foi despachado e a Maia respondeu no WhatsApp.
- Novo launcher scripts/start-worker.ts (Iniciar Maia.bat): sobe o worker e o painel local; não sobe túnel nem registra webhook.
- Os avisos automáticos (resumo diário e alertas) passaram para o worker.
- Pendente: fechar a janela antiga do launcher e abrir o Iniciar Maia.bat novo.

### Alterado (aprovadores vêm da página Pessoas)
- approverNumbers e isApprover (server/approvals.ts): quem tem escrita.aprovar, ativo e com número. Pedidos de aprovação vão a eles e a resposta deles decide.
- Reserva: dono e aprovador do .env se o banco não responder.
- Pendente: reiniciar a Maia no PC.

### Alterado (dono também aprova ações)
- Aprovações vão ao dono e ao aprovador; SIM ou NÃO com número de qualquer um dos dois decide. A mensagem do dono é checada como aprovação antes de virar comando.
- Pendente: reiniciar a Maia no PC.

### Alterado (contexto e respostas curtas da Maia)
- Regras no banco: número do dono usado sem perguntar de novo; respostas com no máximo três linhas, sem menu; criar grupo com aprovação do aprovador.
- Pendente: reiniciar a Maia no PC.

### Alterado (regras importantes que faltavam no painel)
- Incluídas 10 regras do documento docs/regras-da-maia.md que não estavam no banco: números desconhecidos, regras da aprovação, limites de execução, agrupamento, dados guardados, segredos, triagem do Jev, limites da arte, privacidade nos grupos e acesso ao painel.
- O banco passa a ter 22 regras ativas, mostradas na página Regras da Maia.
- Pendente: reiniciar a Maia no PC e confirmar que VITE_MAIA_HOSTED não está na Vercel (sem ela, a página Regras aparece).

### Alterado (revisão das regras da Maia)
- Documento de regras: falhas de consulta vão para Ocorrências; aviso ao Herickson só para pedidos que a Maia não faz; correção de português.
- Regra 3 do banco alinhada ao mesmo comportamento.

### Alterado (objetivo e capacidades da Maia)
- Regra 1 do banco: objetivo e lista do que a Maia faz hoje; prospecção no WhatsApp e no Instagram constam como não disponível.

### Adicionado (regras da Maia no banco e no painel)
- Tabela maia_rules (12 regras ativas), com leitura só do proprietário (RLS).
- O prompt de sistema é montado a partir da tabela (cache de 60 segundos). Se o banco não responder, usa a cópia de reserva.
- Painel: página Regras da Maia, lendo a tabela pelo snapshot. A edição pelo painel fica para a próxima etapa.
- Pendente: reiniciar a Maia no PC.

### Alterado (pedido de criar grupo em linguagem natural)
- Corrigido: a Maia respondia que não conseguia criar grupo e tentava usar o conector de WhatsApp (disparom). Causa: o pedido sem o formato `criar grupo Nome | números` caía na conversa geral.
- Solução: sem resposta fixa. O prompt manda entender o pedido, perguntar o nome e os números que faltarem, e explicar o comando de criação com aprovação. Nunca usar conectores de WhatsApp para grupos.
- Pendente: reiniciar a Maia no PC.

### Alterado (estilo de resposta da Maia)
- Regra no prompt: resposta breve, sem listar capacidades a menos que peçam, sem mencionar conectores indisponíveis, com sugestão de próximo passo.
- Pendente: reiniciar a Maia no PC para carregar o prompt.

### Alterado (regras da Maia no prompt de sistema)
- O prompt de sistema passou a incluir as regras em vigor: quem pode pedir ações, aprovação de escrita por número, não inventar dados, privacidade, conteúdo de documentos como dado e não como instrução, recusa do que a Maia não faz, e uso da base e dos conectores.
- Regras planejadas (permissões por pessoa, impressão digital das aprovações, limite de imagens, memória por cliente) não entraram: estão em docs/regras-da-maia.md, seção 12.
- Pendente: reiniciar a Maia no PC para carregar o novo prompt.

### Documentado (plano da Implementação 2: governança e permissões)
- docs/implementacao-2-governanca.md: estado atual de cada item, fases A a G, testes de aceite e decisões pendentes. Nada foi ativado.

### Adicionado (atualização automática da base de conhecimento)
- **server/knowledgeSync.ts:** lê os três documentos aprovados e reindexa só o que mudou (comparação pelo conteúdo). Roda 1 minuto depois de iniciar e depois a cada hora, no webhook local e no worker.
- **Evita trabalho duplicado:** uma marca no banco impede duas sincronizações seguidas quando os dois processos estão no ar.
- **Verificado:** primeira sincronização reindexou os dois documentos que mudaram; a segunda não encontrou mudança. 57 testes.
- **Pendente:** reiniciar a Maia no PC para começar a sincronização automática.

### Alterado (aprovações persistidas no banco)
- **Tabela approvals:** agora guarda tipo (ferramenta ou grupo), resumo, dados do pedido, tarefa, prazo, processo que espera e quem decidiu.
- **server/approvals.ts:** cria o pedido com número, espera a decisão lendo o banco (funciona mesmo se a resposta chegar por outro processo) e aplica o SIM ou NÃO.
- **SIM e NÃO com número** (SIM 12, NÃO 12). Sem número, só vale com um pedido aberto. Com dois ou mais, a Maia pede o número.
- **Processo que caiu:** se a Maia reiniciou antes da resposta, a ação não é executada e o pedido é encerrado com aviso.
- **Grupos:** o pedido de criação de grupo também é persistido e decidido pelo mesmo caminho.
- **Verificado:** 57 testes. Teste com o banco de produção: resposta ambígua, SIM e NÃO com número, espera pelo banco, resposta repetida e limpeza.
- **Pendente:** reiniciar a Maia no PC para carregar a mudança.

### Adicionado (base de conhecimento com RAG no Supabase)
- **Banco:** extensão vector (schema extensions), tabelas knowledge_sources e knowledge_chunks (embedding 384 dimensões, índice HNSW, índice textual em português), função search_knowledge (busca híbrida por RRF). RLS ligado, sem políticas: só a service role.
- **Função embed** no Supabase (Edge Function, modelo gte-small, verify_jwt ligado). Não usa provedor externo nem chave nova.
- **server/knowledge.ts:** divisão por títulos e parágrafos (trechos de até 900 caracteres, com a seção de origem), geração de vetores, ingestão com checksum (sem reindexar o que não mudou) e busca.
- **Agente:** ferramenta mcp__maia__buscar_conhecimento, só de leitura, liberada nos dois canais do dono. Os trechos são tratados como referência, não como instruções.
- **Documentos indexados:** CLAUDE.md, docs/erros-e-mudancas.md e plan.md (39 trechos).
- **Verificado:** buscas em português acertaram o documento certo entre os dois primeiros resultados em 4 de 4 perguntas de teste. 54 testes passando.
- **Limite conhecido:** o primeiro resultado nem sempre é o melhor, porque o gte-small é treinado sobretudo em inglês. Se a qualidade não bastar, trocar por um modelo multilíngue exige decisão sua (provedor externo).
- **Pendente:** reiniciar a Maia no PC para carregar a ferramenta. Proteção contra senhas vazadas do Supabase Auth: não disponível no plano atual (HTTP 402 na API). Risco aceito pelo owner: manter a senha forte do painel. Reavaliar se o plano mudar.

### Adicionado (agrupamento de mensagens do dono)
- **Janela de agrupamento:** mensagens seguidas do dono viram um só pedido. O lote fica pronto após 15 s sem nova mensagem, ou no máximo 60 s desde a primeira. Configurável por `MAIA_BATCH_WINDOW_S` e `MAIA_BATCH_MAX_S`.
- **Banco:** tabelas `message_batches` e `batch_items`, função `add_batch_item` (atômica, um lote aberto por conversa, repetição do mesmo item da inbox é ignorada) e função `due_owner_batches` (o vencimento é decidido pelo relógio do banco).
- **Despacho:** `server/batching.ts` (`runBatchDispatcher`), reserva atômica de cada lote. Usado pelo webhook local e pelo worker.
- **Correção do worker:** o texto do dono não é mais executado sem espera. Entra no lote e o item da inbox só vira concluído depois de gravado no lote. Um SIM do aprovador não fica preso atrás de uma execução em andamento.
- **Verificado:** 51 testes (regras de vencimento e montagem do texto) e teste com o banco de produção: mensagens em sequência viraram um lote com o texto na ordem, a repetição foi ignorada, e tudo foi apagado.
- **Pendente:** aprovações ainda ficam na memória do processo (ver próxima etapa). Áudio do dono continua fora do lote. RAG não foi implementada: depende do provedor de embeddings e dos documentos a indexar.
- **Pendente:** reiniciar a Maia no PC para usar o agrupamento.

### Adicionado (Jev em modo sombra, na Maia)
- **`server/jev.ts`**: triagem de cada mensagem do dono com a API da TypeSafe (`/v1/systemone`, modelo `jev-latest`). Devolve categoria, confiança, probabilidade de manipulação e de urgência. Limite de 2 s; falha só é registrada.
- **Canais:** WhatsApp e painel. A triagem começa junto com a tarefa e é gravada depois da resposta. Não altera a resposta.
- **Concordância:** compara a categoria do Jev com as ferramentas que a Maia usou (conversa, arte, consulta, escrita). Meta de 80%.
- **Banco:** tabela `jev_triage` (sem texto), com RLS. Migrações `maia_jev_triage_v1` e `maia_jev_triage_probabilities`.
- **Painel:** bloco "Triagem Jev (modo sombra)" no Resumo, com concordância, alertas de manipulação, falhas e as últimas 12 triagens.
- **Verificado:** uma chamada real à API (categoria, confiança e probabilidades devolvidas), registro e leitura do painel com linha de teste apagada. 46 testes passando.
- **Pendente:** reiniciar a Maia no PC para começar a triagem; a coluna "previa" do Bryan não foi incluída (a Maia não mostra texto no painel).

### Adicionado (criação de arte pela Maia, com o Codex)
- **`server/imagegen.ts`**: pedido de arte com o Codex CLI, no mesmo modelo do Bryan. Cada pedido tem pasta própria em `data/arte/pedidos/`. Formatos: feed (4:5), story (9:16) e quadrado (1:1). Referências só de `data/arte/fotos` e `data/arte/referencias`, com nomes simples e no máximo quatro. Tempo máximo de 240 s; se estourar, o pedido fica incerto e não é repetido. O arquivo só é aceito se for PNG ou JPEG acima de 10 KB.
- **`server/maiaImageTool.ts`**: ferramenta `gerar_imagem` para o agente. No WhatsApp, a arte é enviada ao dono; no painel, o caminho do arquivo é devolvido.
- **`server/evolutionSend.ts`**: `sendOwnerImage`, envio de imagem pela instância da Evolution (endpoint `/message/sendMedia`, ainda não testado no WhatsApp).
- **Verificado:** 46 testes passando e uma arte real gerada em 84 s (`data/arte/pedidos/2026-10-08-6196f7/arte.png`), conferida visualmente.
- **Pendente:** testar o envio pelo WhatsApp (sendMedia) e reiniciar a Maia no PC para carregar o código novo.
- Aviso conhecido: `DEP0190` do Node, porque o Codex é um `.cmd` no Windows e precisa de shell. Os argumentos são fixos e validados.

### Adicionado (worker da fila: processa o que a Vercel grava)
- **`server/inboxWorker.ts`** (`pnpm worker`): roda no computador da Maia. Reserva lotes da fila `inbox` com `claim_inbox`, processa e marca cada item como concluído ou falho. Limpa o texto vencido a cada 10 minutos. Ao iniciar, itens presos em "processando" viram falhos (não são reexecutados).
- **`server/ownerRouter.ts`**: comandos do dono (criar grupo, tarefa, conversa) e áudio saíram do webhook local e passaram a ser usados pelos dois.
- **Grupo na fila:** a fila guarda só o endereço do grupo (não o texto), para contar a atividade.
- **Verificado:** typecheck ok, 41 testes, e um teste com a produção usando só itens de terceiros e de grupo (processados e limpos). Mensagens do dono não foram testadas, porque enviariam WhatsApp.
- **Pendente antes de trocar o webhook da Evolution para a Vercel:** (1) cadastrar na Vercel as variáveis do webhook como Segredo; (2) mover o resumo diário e os avisos proativos (`runProactive`) para o worker, porque hoje só o webhook local os executa; (3) testar com uma mensagem real do dono.
- Enquanto a Evolution aponta para o túnel do PC, o worker fica ocioso e nada muda.

### Adicionado (login e permissões por pessoa)
- **Login por e-mail e senha** no painel (`src/features/auth/AuthGate.tsx`). Sem cadastro público: o proprietário convida.
- **Página Pessoas** (`src/features/people/PeoplePage.tsx`): cadastrar pessoa, adicionar e remover números, ativar ou desativar e marcar permissões. Só o proprietário altera.
- **Banco** (migração `maia_people_permissions_v1`): `permission_catalog` (11 permissões atuais), `people`, `person_numbers` (várias por pessoa) e `person_permissions`. Função `is_owner()`. RLS: escrita só do proprietário; cada pessoa lê a própria linha.
- **Chave pública no painel** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). A service role não vai para o navegador.
- **Verificado:** typecheck, build e 41 testes. Advisor de segurança: só avisos informativos e `is_owner()` intencional.
- **Pendente:** vincular o login ao proprietário (convite por e-mail). Sem isso, ninguém altera as permissões.
- **Pendente:** desligar o cadastro público no painel do Supabase (Authentication). Não dá para fazer por aqui.
- **Pendente:** o worker ainda não consulta `person_permissions`. A regra vale no banco; a checagem no processamento vem com o worker.

### Adicionado (rota do webhook na Vercel e preparo para publicar)
- **Rota `api/webhook.ts`** (`/api/webhook`): valida o token, faz a triagem e grava uma linha na fila `inbox` do Supabase. Não chama o Claude, não envia mensagem e não lê o banco. Responde 200 depois de gravar; reenvio do mesmo evento responde 200 com `duplicate`.
- **Triagem** (`server/inbox.ts`, função pura): texto e áudio só do dono e do aprovador; grupo vira atividade sem texto; outros números viram evento sem conteúdo.
- **Configuração:** `vercel.json` (build pnpm, saída `dist`, rewrite do painel para `index.html`, sem interceptar `/api/`) e `.env.example` com os nomes das variáveis, sem valores.
- **Verificado:** 41 testes passando; typecheck ok; teste da rota com o Supabase de produção (token errado 401, gravação 200, reenvio duplicado, linha de teste apagada).
- **Pendente antes de trocar o webhook da Evolution para a Vercel:** o worker do PC que lê a `inbox` e processa. Sem ele, as mensagens ficam paradas na fila.
- **Pendente:** o painel ainda chama `/api/snapshot`, `/api/conversa` e `/api/refresh`, que só existem no servidor local. Na Vercel essas rotas dão 404 até o worker expor os dados.

### Alterado (banco da Maia migrado para o Supabase, direto em produção)
- **`server/store.ts`** agora é assíncrono e usa o Supabase (`getDb()` devolve o cliente). Mesmos nomes de funções. Upsert para snapshots e configurações; `record_group_activity` (função no banco) para contar atividade de grupo; `markMessageSeen` usa a chave única da tabela `seen_messages`.
- **Módulos ajustados para `await`:** `maiaOwnerAgent.ts`, `groups.ts`, `proactive.ts`, `snapshot.ts`, `refreshJob.ts`, `webhookServer.ts`, `vite.config.ts`.
- **Testes:** removidos os 15 casos que usavam SQLite em memória (store, parte de grupos, resumo diário). Não há ambiente de teste de banco; restam 32 testes de lógica pura, todos passando. Typecheck ok.
- **Verificado em produção:** teste de fumaça com as funções reais (tarefa, eventos, kv, deduplicação, atividade de grupo), com limpeza das linhas criadas. As tabelas ficaram vazias.
- **Pendente:** o histórico do SQLite (`data/maia.sqlite`) não foi importado. Painel e webhook começam com o banco vazio. Decidir se importa o histórico.
- **Pendente:** o texto das conversas do dono e da Maia agora fica no Supabase (tabela `messages`). Confirmar essa decisão ou limitar a metadados.
- Processos que estão no ar ainda usam a versão antiga até reiniciar a Maia.

### Adicionado (Supabase: schema e cliente)
- **Schema no projeto Agent Maia** (`cwiidfyzrirphalglaep`, migração `maia_schema_v1`): tabelas espelhando o `store.ts`, mais a fila `inbox` (chave única `key_id`, texto que expira em 24 h), com `claim_inbox` (reserva com SKIP LOCKED) e `purge_inbox_payloads`. RLS ligado em todas; sem políticas, só a service_role acessa.
- **Cliente** (`server/supabaseClient.ts`, pacote `@supabase/supabase-js`): lê `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do `.env`.
- **Segurança:** removido o `EXECUTE` de `anon` e `authenticated` na função `rls_auto_enable()` (já existia no projeto; era SECURITY DEFINER exposta pela API).
- O `store.ts` foi migrado para o Supabase (ver a entrada seguinte).

### Adicionado (áudio do dono no WhatsApp: baixar, transcrever, responder)
- **Recebimento de áudio** (`server/evolutionWebhook.ts`, `audioFrom`): nota de voz do dono é reconhecida e
  deduplicada pelo `key.id`. Áudio de outros números e de grupos é ignorado sem download.
- **Download pela Evolution** (`server/evolutionSend.ts`, `downloadAudio`): `POST /chat/getBase64FromMediaMessage/{instância}`,
  mesma instância e chave já usadas para enviar. Limite de 25 MB, timeout de 30 s, só em memória (não grava arquivo).
- **Fluxo** (`server/webhookServer.ts`, `handleOwnerAudio`): transcreve, mostra "Entendi: ..." ao dono e envia o texto
  pelo mesmo roteamento de um comando digitado (conversa, tarefa, criar grupo).
- **Transcrição** (`server/transcribe.ts`): interface pronta, sem provedor escolhido. Hoje a Maia avisa o dono
  de que não consegue transcrever ainda e pede texto.

### Pendente (áudio)
- **Escolher o provedor de transcrição** (decisão sua, exigida pelo `CLAUDE.md` para novo provedor/credencial):
  OpenAI Whisper (nuvem, paga por minuto, precisa de chave), Gemini (nuvem, chave) ou whisper.cpp local
  (sem rede depois de instalado, mais lento na CPU).
- A rota `getBase64FromMediaMessage` ainda não foi testada com um áudio real na instância.

### Adicionado (grupos do WhatsApp, passos 1 a 3)
- **Painel de grupos** (página Grupos, `src/features/operacao/GruposPage.tsx`): lista real da Evolution
  (cache de 5 minutos), participantes e atividade dos últimos 7 dias. Ações só pelo WhatsApp.
- **Atividade de grupo no webhook** (`server/webhookServer.ts`): cada mensagem de grupo conta na atividade
  (`group_activity`). O texto das pessoas do grupo **não** é guardado, por causa da regra do `CLAUDE.md`.
  Por isso não há resumo por texto de grupo (como o `resumir_grupo` do Bryan): depende de decisão sua.
- **Criar grupo com aprovação** (`server/groups.ts`): o dono manda `criar grupo Nome | 5585..., 5585...`;
  o aprovador responde SIM ou NÃO; só o SIM chama a Evolution (`/group/create`). Expira em 10 minutos.
- **Tarefas pelo WhatsApp do dono:** `tarefa Título` ou `tarefa Título grupo Nome`, criadas na lista de tarefas.
- Testes de comandos, atividade e tarefas (45 testes no total).

### Pendente (grupos)
- A criação de grupo (`/group/create`) ainda não foi executada de verdade, porque escreve na conta.
  Testar com um grupo de teste antes de usar.
- Tarefa ligada a grupo fica registrada, mas nenhuma ação automática é feita a partir de mensagens do grupo.
- Resumo de grupo por texto: exige decisão sobre guardar mensagens de quem não é o dono.

### Adicionado (painel operacional, fases 1 a 6 do plano `docs/plano-painel-operacional.md`)
- **Números-chave e tarefas recentes** no Resumo (`src/features/operacao/OperacaoPages.tsx`).
- **Qualidade operacional** (`server/quality.ts`): mesmos pesos e regras do Bryan. Dimensão sem amostra
  fica em branco, nunca vira nota. Teto de 3/10 por incidente crítico. Precisão exige conferência
  registrada e proatividade exige aviso confirmado; até lá, a nota geral fica "dados insuficientes".
- **Avisos proativos** (`server/proactive.ts`, agendados no webhook): resumo diário no WhatsApp do dono
  (padrão 8h, Brasília; `MAIA_SUMMARY_HOUR`), alerta quando uma conexão cai e aviso quando volta,
  lembrete de aprovação parada há 8 min, alerta de gasto do Meta (`MAIA_META_SPEND_ALERT`, desligado por padrão).
  Tudo local, sem consumo do plano do Claude.
- **Páginas com dados reais:** Resumo, Indicadores, Campanhas (contas do Meta), Vendas (aguarda a planilha),
  Customer insights e Tom de voz (estatísticas das suas mensagens, sem conteúdo), Ocorrências.
- **Manual do operador** na página Operação (`src/data/manual.ts`).
- **Google Agenda** entra como fonte da atualização (lista calendários; sem eventos). Custo: uma consulta
  a mais por atualização.
- **Deduplicação** de reenvios da Evolution e **recuperação** de tarefas interrompidas após reinício.
- Testes de qualidade, avisos proativos e tarefas (39 testes no total).

### Removido
- Páginas de demonstração `src/features/dashboard/DashboardPages.tsx` e `src/features/agent/AgentPage.tsx`.
- Textos de demonstração da interface ("Demo isolada", "Dados fictícios", "Todas as conexões desligadas").
- Painel "Adaptadores futuros" da Operação (substituído pelo status real em Conexões e dados).

### Pendente (painel operacional)
- Vendas: falta o link da planilha de vendas (decisão D3). Mande o link à Maia para ligar.
- Customer insights e Tom de voz por conteúdo (análise por IA): não ativados, porque consomem o plano do Claude.
  Hoje mostram só estatísticas.
- Campanhas por campanha (hoje só o total por conta): exige ampliar a consulta do Meta Ads.
- Precisão e conferência e Proatividade: sem amostra até a conferência e o aviso confirmado serem registrados.
- Os serviços em execução precisam ser reiniciados para usar esta versão.
- Motor de demonstração antigo em `src/App.tsx` (simulações e aprovações locais) ainda existe, sem efeito externo;
  remover numa limpeza futura.

### Adicionado (Fase 0 do painel operacional: tarefas)
- **Tarefas e eventos por tarefa** (`server/store.ts`, tabelas `tasks` e `task_events`): cada pedido do
  WhatsApp ou do painel vira uma tarefa, com eventos `task_persisted`, `task_started`, `tool_use`,
  `approval_requested`/`approved`/`denied`/`expired`, `access_denied`, `replied`, `task_failed` e `task_uncertain`.
- **Tipo da tarefa:** `operacional` quando a Maia usa ferramenta; `conversa` para mensagens leves. Só as
  operacionais contam nos números da qualidade (Fase 2).
- **Deduplicação de reenvios** (`seen_messages`): a Evolution pode reenviar o mesmo evento; cada mensagem
  é processada uma vez.
- **Recuperação após reinício:** tarefas em andamento viram `incerta` ao subir o processo (webhook para o
  WhatsApp, Vite para o painel). Não são reexecutadas.
- Testes de tarefas, deduplicação e recuperação (22 testes no total).
- Plano completo das próximas fases em `docs/plano-painel-operacional.md`.

### Adicionado (conversa e histórico, rodada mais recente)
- **Texto das conversas guardado localmente** (`server/store.ts`, tabela `messages`): mensagens do dono,
  do aprovador e respostas da Maia, nos canais WhatsApp e painel. Mensagens de outros números não são guardadas.
  Decisão do owner registrada no `CLAUDE.md`.
- **Conversa com Maia pelo painel** (`src/features/chat/LiveChatPage.tsx`, rota `/api/conversa` em
  `vite.config.ts`): usa o mesmo histórico do WhatsApp. Pelo painel a Maia só lê; escritas continuam
  exigindo aprovação pelo WhatsApp (`answerFromPanel` em `server/maiaOwnerAgent.ts`).
- Selo "DEMONSTRAÇÃO" removido do topo do painel.
- Teste da tabela de mensagens (18 testes no total).

### Corrigido (conexões)
- **Maia usava um servidor MCP local do computador ("meta-ads") que estava fora do ar, além dos
  conectores do claude.ai.** Correção: o Agent SDK roda com `settingSources: []`, só com os conectores
  do claude.ai (`server/maiaOwnerAgent.ts` e `server/refreshJob.ts`). Efeito colateral: o Disparom
  aparece como "precisa de login" no claude.ai e precisa ser autenticado lá.

### Pendente (conversa)
- A página antiga `src/features/agent/AgentPage.tsx` ficou sem uso; remover quando confirmar.
- O texto "Todas as conexões desligadas" no topo ainda está fixo e fica errado com as conexões ativas.
- Os serviços rodando (`pnpm start`) precisam ser reiniciados para pegar esta versão.

### Corrigido (launcher e painel, rodada mais recente)
- **Painel e túnel caíam juntos e o webhook parava.** Causa provável: o launcher era aberto a partir
  do shell do Claude Code, e a janela recebia um Ctrl+C (código de saída 0xC000013A no túnel) quando
  um comando terminava. Correção: o launcher agora sobe em janela própria (`cmd /k` ou `Iniciar Maia.bat`).
  Causa ainda não confirmada de forma definitiva; se voltar com a janela independente, investigar.
- **Painel subia na 3001 e a página em 3000 ficava sem dados.** Causa: a 3000 estava ocupada no
  momento da reinicialização, e o Vite trocou de porta em silêncio. Correção: `--strictPort` no
  launcher; se a porta estiver ocupada, falha com erro visível.
- **Painel caía e derrubava a Maia.** Correção: o launcher reinicia o painel (até 5 vezes, 3 s entre
  tentativas) e o túnel (até 5 vezes, com novo registro da URL na Evolution). Só a queda do webhook
  para tudo.
- **Cards de conexões com valores gigantes e sobrepostos.** Causa: classes CSS que não batiam com o
  layout de `MetricCard`. Correção: mesma estrutura de `MetricCard` (`src/features/connections/ConnectionsPage.tsx`).

### Adicionado (painel com dados reais, modelo do Bryan)
- **Banco local `data/maia.sqlite`** (`server/store.ts`): eventos (tipo, papel do remetente, decisão),
  aprovações, execuções do agente e snapshots das fontes. Só metadados; nunca o texto das mensagens.
- **Atualização das fontes** (`server/refreshJob.ts`): Gmail, Meta Ads e Sheets pelo Agent SDK,
  só leitura, com ferramentas listadas por fonte, modelo Haiku, teto de US$ 0,50 por fonte, a cada
  30 minutos e pelo botão "Atualizar fontes". Erro não apaga o último dado bom.
- **Snapshot e atualização locais** (`vite.config.ts`): `GET /api/snapshot` e `POST /api/refresh`,
  aceitos só de `localhost`/`127.0.0.1`. `/api/maia` também passou a exigir isso.
- **Página "Conexões e dados"** (`src/features/connections/ConnectionsPage.tsx`): WhatsApp ao vivo,
  webhook, último agente, aprovações pendentes, eventos de 24 h e cards das três fontes. Atualiza
  a cada 30 segundos.
- **Testes do banco e do leitor de JSON** (`tests/store.test.ts`): 17 testes no total.

### Alterado (painel)
- `pnpm dev` agora sobe em `127.0.0.1` (antes `0.0.0.0`, que expunha o app na rede local).
- O launcher passa a URL atual do túnel ao painel (`WEBHOOK_PUBLIC_URL`), em vez da do `.env`.
- `data/` no `.gitignore`.
- `CLAUDE.md`: decisão do owner para leituras periódicas via Agent SDK registrada.

### Corrigido (painel)
- **Atualização estourava o teto de US$ 0,30** (`error_max_budget_usd`). Causa: cada consulta carrega o
  contexto de todos os conectores MCP. Correção: Haiku, ferramentas por fonte e teto de US$ 0,50.
- **Testes deixavam o agendador e o banco rodando** (o Vitest também sobe um servidor Vite). Correção:
  o plugin não inicia nada quando `VITEST` está definido.
- **Painel mostrava o túnel antigo** como host do webhook. Correção: ver "Alterado".

### Pendente (painel)
- Meta Ads: a conexão `meta-ads` caiu (`MCP connection closed`). Reconectar no Claude e clicar em
  "Atualizar fontes".
- Gmail: a contagem de não lidas veio como 201 com o limite de 100 no pedido; confirmar se é
  contagem exata ou aproximada.
- Eventos `messages.update` (confirmações de leitura) caem como "sem tratamento" e geram aviso no log.
- As páginas de demonstração (Resumo, Indicadores, Campanhas etc.) ainda mostram dados fictícios ou
  zerados. Só "Conexões e dados" usa dados reais.

### Corrigido (mais recente)
- **App caía sozinho e o launcher parava tudo (código 1).** Causa provável: o Vite lia o stdin
  herdado da janela do launcher. Correção: o app sobe com stdin isolado (`scripts/start.ts`).
  Como o launcher para tudo quando um processo cai, o webhook também parou e mensagens
  recebidas nesse intervalo não foram respondidas.

### Adicionado
- **Launcher `Iniciar Maia.bat` + `scripts/start.ts`** (`pnpm start`): sobe o webhook, o túnel
  Cloudflare, registra a URL na Evolution, confere a conexão do WhatsApp, sobe o app em
  `127.0.0.1:3000` e abre o navegador. Se um processo cai, para tudo.
- **Roteamento por remetente no webhook** (`server/webhookServer.ts`): a conversa vem só do
  `EVOLUTION_OWNER_NUMBER`; a aprovação de escrita vem só do `EVOLUTION_APPROVER_NUMBER`
  (aceita SIM/NÃO). Demais remetentes são ignorados sem guardar conteúdo.
- **Aprovação pelo número aprovador** (`server/maiaOwnerAgent.ts`): os pedidos de escrita são
  enviados ao `EVOLUTION_APPROVER_NUMBER`, não ao da conversa.
- **`incomingText`** (`server/evolutionWebhook.ts`): extrai remetente e texto de mensagens de
  texto, ignorando mensagens enviadas pela própria conta (`fromMe`).
- **`samePhone`** (`server/evolutionWebhook.ts`): compara números brasileiros com e sem o nono dígito.
- **Agente da Maia no WhatsApp** (`server/maiaOwnerAgent.ts`): leituras (Gmail, Meta Ads,
  Drive/Sheets) rodam direto; escritas esperam aprovação.
- **Webhook local** (`server/webhookServer.ts`, porta 3100, só `/webhook`), com triagem de
  eventos e autenticação por segredo.
- **Registro do webhook** (`scripts/register-evolution-webhook.ts`): dry-run por padrão, `--apply` envia.
- **Envio de texto pela Evolution** (`server/evolutionSend.ts`).
- **Testes**: webhook, autorização e comparação de números (11 testes).

### Corrigido
- **Webhook não recebia nada pelo túnel (404).** Causa: existia um `~/.cloudflared/config.yml`
  global com uma regra catch-all `http_status:404`, que sobrescrevia o `--url`. Correção: o
  túnel sobe com `--config` apontando para um arquivo vazio (`scripts/cloudflared-empty.yml`).
- **Mensagens de contatos não eram reconhecidas.** Causa: o WhatsApp entrega o remetente como
  identificador LID (`…@lid`), não como número. Correção: quando o JID termina em `@lid`, o
  número real é lido de `remoteJidAlt`.
- **Mensagem do número da conversa era ignorada.** Causa: o WhatsApp manda o número sem o nono
  dígito (`EVOLUTION_OWNER_NUMBER`), e o `.env` tem com ele (`EVOLUTION_OWNER_NUMBER`). Correção: `samePhone`
  compara os dois formatos como o mesmo número.
- **Typecheck falhava em `server/`** (sem `@types/node`). Correção: dependência instalada e
  `tsconfig` com `types` e `include` para `server`.
- **Erro de autenticação do Agent SDK aparecia como sucesso.** Correção: `is_error` e
  `subtype` são checados; erro vira HTTP 502.
- **Orçamento de 0,05 USD estourava** (`error_max_budget_usd`). Correção: 0,25 USD no chat e 1 USD
  no agente do WhatsApp.
- **Busca "dm" casava com "admissões".** Correção: casamento só no início da palavra, com teste.
- **Fontes carregadas do Google Fonts** (chamada de rede, contra o `CLAUDE.md`). Correção: fontes
  locais via `@fontsource`.
- **Aviso do Vite sobre import sem extensão** em `vite.config.ts`. Correção: import com `.ts`.
- **Instâncias antigas do `pnpm dev` servindo versão velha** (portas 3000–3002). Correção: processos
  antigos encerrados; uma única instância na 3000.
- **Erro de JSX em `DashboardPages.tsx`** após um corte de string. Correção: linha reescrita.

### Alterado
- **Dados demonstrativos removidos**: métricas zeradas ("—", "Sem dado"), cards de exemplo
  retirados, membros reduzidos a Herickson Maia (owner) e Gessica (participante).
- **Chave de armazenamento demo** passou para `operaflow-maia-demo-v3`.
- **Tamanho da fonte da interface** aumentado (escala 1.25).
- **`CLAUDE.md` e `README.md`** atualizados com as exceções do Agent SDK e do webhook Evolution.

### Pendente
- Trocar a chave da Evolution API, que ficou exposta no histórico do chat.
- Testar ponta a ponta: mensagem pelo número da conversa (EVOLUTION_APPROVER_NUMBER) e aprovação pelo
  aprovador (EVOLUTION_OWNER_NUMBER).
- Atalho na área de trabalho: o Windows bloqueou a gravação em `Desktop`. Criar manualmente a
  partir de `Iniciar Maia.bat`.
- Script `dev` usa `--host 0.0.0.0`, o que expõe o app na rede local. O launcher usa só
  `127.0.0.1`. Decidir se o `dev` também deve mudar.
- A URL do túnel Cloudflare muda a cada execução: o launcher re-registra o webhook, mas um túnel
  iniciado fora dele exige novo `--apply`.
# Acesso de membros por linguagem natural (não implantado)

- Respostas privadas pendentes agora carregam o solicitante e são revalidadas antes do envio, inclusive após retomada do worker; revogação impede novas partes.
- RPC e tabelas de acesso recebem privilégios explícitos para a Data API com RLS; chamadas sem identidade do proprietário são recusadas.
- Consulta distingue concessões de equipes globais e de cliente; testes cobrem revogação durante execução e consumo único da aprovação.
- Ferramentas de localizar, consultar e definir acesso disponíveis no MCP Claude/Codex, com verificação do proprietário no servidor.
- Modos individuais e auditoria transacional em migração nova; bloqueio individual prevalece sobre equipe.
- Aprovação vinculada a solicitante, tarefa, ferramenta e parâmetros, expira em 10 minutos e só pode ser consumida uma vez.
- Releitura das permissões antes das ferramentas e após aprovações; painel de Pessoas relê os modos no banco.
# Lembretes duplicados — correção preparada

O prazo automático e um lembrete manual podiam gerar dois avisos para a mesma tarefa e horário. A nova migration valida a combinação sob bloqueio da tarefa, preservando o histórico; a ferramenta reutiliza o aviso existente. Horários diferentes continuam permitidos. Typecheck, validação de migrações, 692 testes de aplicação, 77 de banco e build passaram. O guard não encontrou origin/main. A simulação remota retornou 401 para o token; aplicação em produção e atualização do worker permanecem pendentes.

