# Contatos compartilhados

Mensagens contactMessage e contactsArrayMessage eram ignoradas. A triagem extrai nome e telefones do vCard, preserva as permissões existentes e não cadastra automaticamente. Passaram 720 testes e build; implantação requer webhook e worker atualizados, sem migração de banco.

# Erros e mudanças — resumo do projeto

## 2026-10-21 — Maia dizia não ter Meta Ads (regra meta_ads)

- **Causa:** o catálogo de regras só citava o Meta Ads no upload de mídia. Sem regra de capacidade, a Maia respondeu 7 vezes que "Meta Ads nunca fez parte das ferramentas" sem sequer tentar a ferramenta (tarefas 850/852 como `conversa`), e o histórico com essas respostas reforçou a recusa. O conector e a permissão `meta.ler` já funcionavam.
- **Correção:** regra `meta_ads` (catálogo 2026-10-21.1, 47 regras) e migração `20261021120000_meta_ads_rule.sql`. Dono consulta livre; membro com `meta.ler` consulta, sem ela pede aprovação pontual; escrita sempre com OK do dono.
- **Aplicado em produção (21/10/2026):** dry-run listou só a migração nova, `db push` ok, `rules:verify` alinhado (47 regras), `knowledge:sync` sem erro. Os 4 incidentes do Zernio foram fechados como resolvidos.
- **Pendência:** o dono pedir o Meta Ads de novo no WhatsApp para confirmar (o histórico tem 7 recusas antigas no contexto). Não aprovar o padrão `zernio_auth_sem_retry_cego`.

## 2026-10-21 — confirmação final: 4/4 fontes em "ok"

Ciclo completo do coletor gravou `status: "ok"` em `sheets`, `calendar`, `gmail` e `meta` (03:13–03:16 UTC), depois do merge do PR #39. Investigação encerrada. Causas tratadas nas entradas anteriores: worker duplicado com `.env` velho, checkout atrás da `main`, coletor rodando de pasta separada (`maia-gerencial`), escopo do OAuth do Google, bug em `isReadTool()`, orçamento do CLI, `MAIA_CLAUDE_BIN` corrompido e validador do Meta Ads rígido demais.

## 2026-10-21 — causa do erro linux-x64 e Meta Ads tolerante a conta sem gasto

- **Causa:** `MAIA_CLAUDE_BIN` tinha sido salvo com valor corrompido (barras invertidas comidas por escaping de shell), não um problema do executor. Corrigido escrevendo o `.env` direto por script. `sheets`/`calendar`/`gmail` confirmados `status: "ok"` em produção depois disso.
- **`meta` ainda falhava** ("conta fora do formato"): consulta real funcionou, mas o validador exigia `spend_7d`/`currency` sempre presentes e a conta tem ~50 contas de anúncio, várias não consultáveis.
- **Correção:** `SOURCES.meta` aceita `null` nesses campos para conta não consultável; `snapshotApi.ts`/`proactive.ts` ajustados.
- **Evidência:** `tests/panelCollection.test.ts` (novo caso), typecheck, 773/773 testes, build OK.
- **Pendência:** confirmar "ok" em meta no próximo ciclo.

## 2026-10-21 — orçamento e ferramenta do Meta Ads (visto em produção após o PR #36)

- **Causa:** `sheets`/`gmail` já gravaram "ok" no primeiro ciclo real. `calendar` estourou o teto de custo (`error_max_budget_usd`) porque o CLI carrega o contexto de todos os servidores MCP configurados na máquina, não só os da fonte. `meta` tentou `ads_get_ad_entities`, fora da lista liberada, e devolveu erro em vez de inventar dado.
- **Correção:** teto subiu para US$1,50/12 turnos (`panelCollection.ts`, `refreshJob.ts`); `SOURCES.meta` libera `ads_get_ad_entities`.
- **Evidência:** `tests/panelCollection.test.ts` cobrindo a nova ferramenta; typecheck, 772/772 testes e build aprovados.
- **Pendência:** confirmar "ok" em calendar/meta no próximo ciclo.

## 2026-10-21 — implantação: dois ambientes com .env separados + Iniciar Maia.bat duplicado

- **Causa:** worker do WhatsApp (`agent-maia`) e coletor do painel (`maia-gerencial`, worktree separado, tarefa agendada `Maia-Painel-Coletor`) têm `.env` independentes. A correção da chave Zernio só tinha ido para `agent-maia`; `maia-gerencial` continuava com a chave velha (HTTP 401).
- **Correção:** `ZERNIO_API_KEY` copiada de um `.env` para o outro (sem expor o valor); testado HTTP 200 nos dois. PR #36 mergeada na `main`, os dois checkouts atualizados por fast-forward, processos reiniciados (coletor via `Start-ScheduledTask`, worker via `pnpm start`).
- **Achado:** ao reiniciar o worker, uma segunda instância subiu em paralelo via `Iniciar Maia.bat` clicado por fora — mesmo padrão do incidente de worker duplicado já visto antes. Resolvido via árvore de processos (`ParentProcessId`), mantendo uma instância só.
- **Pendência:** confirmar `status: "ok"` em `calendar`/`gmail`/`meta` no próximo ciclo do coletor.

## 2026-10-21 — Calendar/Gmail/Meta Ads pelo Claude + bug de isReadTool corrigido

- **Causa/decisão:** owner escolheu usar os conectores `mcp__claude_ai_*` da conta para Calendar/Gmail/Meta Ads no painel, em vez de corrigir o escopo OAuth do servidor ou implementar coletor direto de Meta.
- **Correção:** `server/panelCollection.ts` chama `runClaudeSimple` com os prompts/validadores de `server/refreshJob.ts` (agora exportado como `SOURCES`) para essas três fontes; sheets continua no Drive direto.
- **Bug achado e corrigido (pré-existente):** `isReadTool()` (`server/approvalPolicy.ts`) só casava o verbo isolado, nunca o nome real da ferramenta do conector (`list_calendars`, `ads_get_ad_accounts`…) — sempre devolvia falso para `mcp__claude_ai_*`, afetando também `codexMaiaMcp.ts`/`maiaOwnerAgent.ts` em produção. Corrigido para tratar o verbo como prefixo; validado que `requiresApproval()` (create/update/delete/share/send) não foi afetado.
- **Evidência:** `tests/panelCollection.test.ts` (4 testes novos) cobrindo as duas rotas (Drive direto e Claude) e os casos de erro. Typecheck limpo, 772/772 testes, build OK.
- **Pendências:** reiniciar o coletor agendado (`Maia-Painel-Coletor`) e o worker com o código novo; confirmar status "ok" no próximo ciclo real.

## 2026-10-20 — conectores Gmail/Calendar/Meta Ads: correção da causa (sessão de investigação)

- **Diagnóstico inicial (errado):** a entrada original desta seção, escrita antes de notar que o checkout local estava 9 commits atrás da `main`, concluiu que reconectar os conectores `mcp__claude_ai_Gmail`/`Google_Calendar`/`Meta_ADS` desta sessão de Claude Code resolveria o problema. Esses conectores não têm nenhuma relação com o coletor de produção.
- **Causa real:** quem escreve `calendar`/`gmail`/`meta` em `snapshots` é `server/panelCollection.ts` (só existe na `main`, não existia neste checkout). Ele usa `getAccessToken()` de `server/integrations/googleDrive.ts` — um OAuth2 **próprio do servidor** (`GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN` no `.env`), sem relação com conectores do Claude.ai. Testado ao vivo: o token troca normalmente, mas `tokeninfo` do Google confirma `scope: "https://www.googleapis.com/auth/drive"` — **nunca teve escopo de Gmail nem de Calendar**. Sheets funciona porque usa Drive. Meta Ads não tem coletor direto implementado (`else` lança "sem coletor direto configurado"); não é problema de credencial.
- **Correção real necessária:** gerar um novo `GOOGLE_OAUTH_REFRESH_TOKEN` com consentimento incluindo escopos de Calendar e Gmail, e atualizar onde esse valor estiver configurado (local e produção); para Meta Ads, cadastrar uma fonte manual em "Fontes Gerenciais" (não existe coletor automático).
- **Zernio (Instagram/LinkedIn):** sistema totalmente separado (`ZERNIO_API_KEY`, `server/integrations/zernio.ts`). Chave testada ao vivo nesta sessão: `HTTP 200`, respondendo normalmente. O erro relatado horas antes pelo agente no WhatsApp era por dois workers (`inboxWorker.ts`) rodando ao mesmo tempo — um iniciado 23h antes com `.env` desatualizado, outro com a chave corrigida; o antigo foi encerrado e confirmado único processo ativo.

## 2026-10-20 — remoção do `--restricted` no executor Claude CLI

- **Causa:** o conector Meta Ads não chegava ao agente porque `--restricted` zerava `mcp_servers` por completo (confirmado rodando `claude -p` ao vivo).
- **Correção:** removida a flag `--restricted` em `buildCliArgs` (`server/ai/providers/claudeCli.ts`). As demais proteções (Bash/Edit/Write/WebFetch bloqueados, leitura de arquivo confinada ao projeto, ferramentas MCP fora do inventário negadas por padrão) continuam por caminhos independentes dessa flag.
- **Verificações:** `pnpm typecheck`, `pnpm test` (721 testes) e `pnpm build` aprovados após ajustar `tests/claudeCli.test.ts` e `tests/claudeSimple.test.ts`.
- **Pendências:** testar com o worker reiniciado uma pergunta real pelo WhatsApp que use o Meta Ads; avaliar isolar `CLAUDE_CONFIG_DIR` pra reduzir o risco residual de conexão a servidores MCP alheios deste computador.

## 20/10/2026 — complementação do plano gerencial

Publicação confirmada: PR #34, main b0bc9fe, CI e Vercel aprovados. Às 23:15 BRT, página/gráficos responderam 200, APIs gerenciais 200 com login e 401 anônimas, período inválido 400 e histórico sob demanda 200. A inspeção visual e as fontes reais seguem como dependências, não como entregas presumidas.

Causa: a primeira entrega organizou o painel, mas manteve gráficos em barras e deixou análises setoriais/comparações sem implementação completa. Correção: rosca, colunas, linhas, empilhados, cronograma, evolução semanal, idade, devoluções, encerramentos/retornos por eventos, filtros comuns e análises operacionais. Comparações externas agora têm fórmulas e validações explícitas; não presumem moeda, cobertura ou atribuição equivalentes.

A leitura própria do painel omite o histórico global e busca o histórico da tarefa por páginas, preservando a primeira revisão quando anterior ao período. API original, comandos da Maia, catálogo de regras e permissões permanecem iguais. Validação: 768 testes de aplicação, 81 de banco, tipos/build e checks de banco/regras; drift 2.064/2.064 sem divergência. APIs novas conferidas com banco real: 200 autenticadas, 401 anônimas, mesmos 21 IDs e ações do contrato original. Sem migração ou reinício de worker. Fontes reais, OAuth Gmail/Agenda e inspeção visual continuam como dependências explícitas; aceite integral do plano ainda condicionado a elas.

## 20/10/2026 - redes sociais de Herickson Maia

Causa: rótulos e descrições legadas atribuíam as redes sociais à Worki. Correção informada pelo owner: Instagram e LinkedIn são de Herickson Maia. Tela, descrições, catálogo e documentação corrigidos; migração altera somente os títulos com proteção contra edição concorrente. Os textos das 46 regras, permissões, aprovações e seleção de contas por ID permanecem iguais. Typecheck, build, 742 testes da aplicação e 81 de banco aprovados. Migração 20261021011039 aplicada, catálogo 2026-10-20.7 alinhado, drift 2.064/2.064 e base normativa sincronizada sem erro. Publicação do painel pelo fluxo GitHub/Vercel; descrições do worker são recarregadas no próximo início. A consulta Zernio com a credencial local retornou HTTP 401; conexão não confirmada nessa leitura.

## 20/10/2026 - painel gerencial

A navegação passa a nove áreas com Gestão e Meu trabalho separados. Panorama e gráficos abrem os registros reais do cálculo; a camada de fontes exige configuração explícita e preserva histórico, revisões e o último lote válido. A coleta usa APIs de leitura e processo próprio, sem chamar a IA. A contagem acumulada dos grupos deixa de ser apresentada como sete dias; cadastro/atividade sobrevivem à falha da lista externa.

Backup anterior preservado em branch/tag no GitHub e ZIP/patch local. Regras, prompts, modelos, políticas, ferramentas, estados e efeitos operacionais preservados. Novas fontes restritas ao proprietário; escopos existentes inalterados. Migrações aditivas, sem apagar dados.

Verificação local: 742 testes da aplicação, 81 de banco, typecheck, build e validação de 66 migrações aprovados. Fontes reais e inspeção visual dependem de configuração/navegador; Publicado em https://agent-maia.vercel.app pelo PR #31, merge 8a0f1c98dd67a4f6f6da2bda0eebc97da5a7a750, deployment dpl_FFN4sBRDr4sBsmPwMNiNkUMnXnUq. Página/assets 200 com nova navegação; seis APIs de dados 200 autenticadas e 401 anônimas; comandos inválidos em colaboração/fontes retornam 400. WhatsApp confirmou open sem erro. A lista externa de grupos atingiu timeout na conferência; 12 grupos permaneceram visíveis pelo fallback de cadastros/atividade, sem confirmar uma lista externa completa. Detalhes em [painel gerencial](painel-gerencial.md) e [backup](backup-painel-anterior.md).

## 2026-10-20 — conferência de GitHub, sites e produção

- Migração `20261020180000` confirmada no histórico remoto do Supabase; as migrações de Sheets (`20261020160445` e `20261020160446`) e de caminhos de site (`20261020170000`) também constam aplicadas.
- Implementação `073610d` e documentação `4d89f15` integradas na `main` pelo merge `7767b3d`. O status Vercel desse merge informa publicação concluída.
- `github_repo_criar` cria privado por padrão; `privado=false` exige OK do owner. Membros continuam sem acesso a `github_*`; não há ferramenta para mudar a visibilidade de um repositório existente.
- `site_subir_github` aceita repositório público ou privado e exige OK para o commit. `site_publicar_vercel` envia o HTML pela API; se o HTML não vier no pedido, lê o arquivo do repositório informado. O fluxo não configura deploy a cada git push. Regras do plano gratuito da Vercel não foram verificadas nesta conferência.
- Verificação local anterior: 720 testes de aplicação e build aprovados; CI do PR #29 também passou. Isso não comprova publicação real de um site pelas ferramentas da Maia.
- Pendências confirmadas: atualizar os workers (processos observados iniciados às 00h25 e 15h08, antes do commit das 16h11), manter uma única instância operacional após verificar trabalhos em andamento e testar o fluxo real de GitHub/Vercel.
- A regra aplicada `site_publicar` ainda contém a expressão antiga “repositório fixo de sites”, embora o restante descreva repositório por pedido. Corrigir futuramente no catálogo, documento gerado e nova migração; preservar a migração aplicada.


## 2026-10-20 — Google Sheets (`sheets_*`)

- **Causa:** o conector do Google Sheets não estava no inventário, e a Maia não tinha ferramenta própria para planilhas.
- **Correção:** `server/integrations/googleSheets.ts` e `server/sheetsTools.ts` (8 ferramentas, nos dois executores), usando o token OAuth do owner. Leitura com `sheets.ler`, escrita com `sheets.editar`, autorização por planilha; apagar coluna ou aba pede OK. Codex passa a checar autorização por recurso.
- **Ajuste (mesmo dia, pedido do owner):** planilhas passam a valer também no grupo interno Operacional; membros seguem as permissões cadastradas. Em grupo de cliente continuam negadas. A regra `google_sheets` foi corrigida na migração ainda não aplicada, sem nova versão.
- **Pendências:** reiniciar o worker (as duas migrações já constam aplicadas em produção), testar numa planilha real; scripts do Apps Script ficam para depois (exigem outro escopo).
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 711/711 e 77/77, `pnpm build` OK, `pnpm db:validate`/`db:guard`/`rules:check` OK, `tests/sheets.test.ts` 21/21.

## 2026-10-20 — GitHub e site: owner escolhe repositório público ou privado

- **Causa:** repositório sempre privado; o owner quer escolher a visibilidade a cada criação.
- **Correção:** `github_repo_criar` com `privado` (padrão privado). Público pede OK. Sites aceitam repositório público ou privado. Regra `2026-10-20.6` (migração `20261020180000`, aplicada em produção em 2026-10-20).
- **Evidência:** `tests/github.test.ts` e `tests/site.test.ts` passando; `rules:check`, `db:validate` e `db:guard` OK.
- **Pendências:** testar com repositório real.

## 2026-10-20 — site: repositório informado em cada pedido (sem `MAIA_SITES_REPO`)

- **Causa:** repositório fixo no `.env` obrigava a editar o servidor a cada repositório novo.
- **Correção:** `repo` vai em cada pedido de site; o repositório pode ser público ou privado (existência conferida no GitHub). Regra `2026-10-20.6` e migração `20261020180000` aplicada em produção.
- **Pendências:** remover `MAIA_SITES_REPO` do `.env`; testar com repositório real.
- **Evidência:** `tests/site.test.ts` 15/15; `rules:check`, `db:validate` e `db:guard` OK.

## 2026-10-20 — site em dois caminhos (`site_subir_github` e `site_publicar_vercel`)

- **Causa:** `site_publicar` fazia commit e deploy na mesma chamada; não havia como subir sem publicar nem publicar um site já salvo.
- **Correção:** duas ferramentas. `site_subir_github` (commit, OK do owner) e `site_publicar_vercel` (deploy direto, sem OK; lê o HTML salvo no repositório se o pedido não trouxer). Regra reescrita (`2026-10-20.5`), migração `20261020170000_site_caminhos_rule.sql`.
- **Pendências:** reiniciar o worker e testar com repositório e Vercel reais; migrações de Sheets e de caminhos já aplicadas.
- **Evidência:** `tests/site.test.ts` 15/15; ver as verificações finais no CHANGELOG.

## 2026-10-20 — criar e publicar site (`site_publicar`)

- **Causa:** owner pediu que a Maia gerasse sites em HTML, mandasse no chat, comitasse no GitHub e publicasse na Vercel, direto pelo WhatsApp.
- **Correção:** `server/integrations/vercel.ts` (novo, só deployments) e `server/siteTools.ts` (novo, 1 ferramenta `site_publicar`, nos dois executores). Commit sempre com OK; deploy na Vercel automático, dentro da mesma ação aprovada; membro precisa da permissão nova `site.publicar`.
- **Pendências:** owner precisa enviar `cofre VERCEL_TOKEN | valor` (ou `.env`), definir `MAIA_SITES_REPO` e conceder `site.publicar` a quem for usar; não testado contra a Vercel real.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 692/692 e 76/76, `pnpm build` OK, `pnpm db:validate`/`pnpm db:guard`/`pnpm rules:check` OK, `tests/site.test.ts` 10/10.

## 2026-10-20 — janela de agrupamento 30 s

- **Causa:** mensagem complementar ("12:00") chegou após a janela de 15 s; o primeiro texto foi despachado sozinho.
- **Correção:** `MAIA_BATCH_WINDOW_S=30` no `.env`; teto de 60 s inalterado.
- **Pendências:** reiniciar o worker; causa inferida do código, sem consulta aos lotes em produção.

## 2026-10-20 — ferramentas do GitHub

- **Causa:** a integração nativa do GitHub no claude.ai vale só para sessões na nuvem; a Maia não tinha ferramenta para o GitHub.
- **Correção:** `server/integrations/github.ts` e `server/githubTools.ts` (9 ferramentas `github_*`, nos dois executores). Leitura livre; repositório (sempre privado) e branch sem OK; commit, PR e comentário com OK; sem apagar, merge, tornar público nem push forçado. Só owner no privado.
- **Pendências:** testar com o GitHub real e reiniciar o worker; o token fica em `GITHUB_TOKEN` (`.env`) ou no cofre.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 679/679 e 76/76, `pnpm build` OK, `tests/github.test.ts` 17/17.

## 2026-10-20 — conectores de operação liberados ao owner

- **Causa:** Trello, Vercel e Miro foram negados pela Maia com "ferramenta sem política explícita no inventário" (família fora de `CONNECTOR_FAMILY`).
- **Correção:** `server/operationalConnectors.ts` (novo) + regra em `server/access.ts`: owner no privado lê livremente as consultas listadas; toda escrita pede OK pontual; membros e grupos ficam bloqueados. Descrições de aprovação em `server/actionDescriptions.ts`.
- **Pendências:** confirmar o prefixo do ClickUp quando o conector aparecer; confirmar no ambiente real se o worker enxerga os conectores.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 76/76, `pnpm build` OK, `tests/operationalConnectors.test.ts` 34/34 com o teste de aprovação.
## 2026-10-19 — atendimento autônomo de contatos desconhecidos

- **Nova capacidade:** `handleServiceMessage` em `maiaOwnerAgent.ts` — qualquer contato "other" não prospect vai para atendimento autônomo com a skill `atendimento:whatsapp`. Preferência de supressão verificada antes de qualquer ação. Sem skill ativa ou com supressão, avisa o dono e encerra.
- **Controle:** "não faça atendimento autônomo para desconhecidos" (ou variações) ativa supressão via preferência do owner; "não notifique" + "atend" silencia as notificações.
- **Arquivos alterados:** `server/maiaOwnerAgent.ts` (+`handleServiceMessage`), `server/inboxWorker.ts` (roteamento "other" não prospect → `handleServiceMessage`).
- **Pendências:** skill `atendimento-whatsapp` precisa estar ativa para o atendimento funcionar.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 76 passando.

## 2026-10-19 — resposta autônoma a leads de prospecção

- **Causa:** `inboxWorker.ts` tratava toda resposta de `sender === "other"` com `notifyOwner` direto, sem passar pelo agente. Leads de prospecção nunca recebiam resposta autônoma.
- **Correção:** worker verifica `maia_prospects` (status `sent`); se houver registro, roteia para a nova função `handleProspectMessage` em `maiaOwnerAgent.ts`. Sem registro, comportamento anterior.
- **Nova função `handleProspectMessage`:** skill `prospeccao:whatsapp` ativa instrui a triagem; SAIR dispara opt-out imediato; agente responde ao lead e avisa o dono com resumo curto. Preferência do owner controla modo detalhado ou silêncio.
- **Arquivos alterados:** `server/inboxWorker.ts`, `server/maiaOwnerAgent.ts` (+`handleProspectMessage`, imports `listActiveSkills`, `recordSkillEvent`, `listOwnerPreferences`, `addOptOut`), `skills/prospeccao-whatsapp/SKILL.md` (regras 7–9).
- **Pendências:** a skill `prospeccao-whatsapp` precisa estar **ativa** (não só proposta) para a triagem funcionar; ativar em Agente Maia → Núcleo e automações ou com `ATIVAR SKILL <uuid>`.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 76 passando.

## 2026-10-18 — skills de atendimento e prospecção com aprovação pelo WhatsApp

- **Nova capacidade:** proposta e ativação de skills (novas e atualizações) pelo WhatsApp com `ATIVAR SKILL <uuid>`, sem precisar do painel.
- **Validação anti-bloqueio:** `validateSkillSafety` rejeita padrões de risco antes de criar a proposta (follow/unfollow, DM fria, prospecção automática, ausência de SAIR/janela 24h por canal).
- **Arquivos alterados:** `server/skills.ts` (+`validateSkillSafety`, `proposeSkillUpdate`, `handleSkillActivationCommand`, campo `channel` no frontmatter), `server/ownerRouter.ts`, `server/maiaOwnerAgent.ts` (interceptação do comando), `server/maiaImageTool.ts`, `server/codexMaiaMcp.ts` (+`skill_propor_atualizacao` em paridade), `server/toolPolicy.ts` (inventário).
- **Arquivos novos:** `skills/atendimento-whatsapp/`, `atendimento-instagram/`, `prospeccao-whatsapp/`, `prospeccao-instagram/`.
- **Pendências:** as 4 skills bundled aparecem como proposta após `syncBundledSkillProposals` rodar no worker; ativar uma a uma em Agente Maia → Núcleo e automações ou com `ATIVAR SKILL <uuid>`.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 654 passando, `pnpm build` limpo.

## 2026-10-17 — fix: ferramentas Drive bloqueadas pelo inventário de ferramentas

- **Causa:** `drive_enviar_arquivo` e `drive_salvar_arquivo` implementadas mas não adicionadas a `MAIA_TOOL_NAMES` em `server/toolPolicy.ts`. O `decideAccess` nega qualquer `mcp__maia__*` fora do inventário antes de avaliar o role, resultando em "ferramenta sem política explícita no inventário".
- **Correção:** duas entradas adicionadas ao `Set` em `toolPolicy.ts`. Sem migração de banco.
- **Evidência:** `pnpm typecheck` limpo, `pnpm test` 76 passando.

## 2026-10-17 — integração Google Drive ↔ WhatsApp

- **Nova capacidade:** `drive_enviar_arquivo` (Drive → WhatsApp) e `drive_salvar_arquivo` (WhatsApp → Drive).
- **Arquivos novos/alterados:** `server/integrations/googleDrive.ts` (novo), `server/evolutionSend.ts` (+`sendFileBuffer`), `server/maiaImageTool.ts` (+2 ferramentas), `server/codexMaiaMcp.ts` (+2 ferramentas em paridade).
- **Configuração:** requer `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN` no `.env`.
- **Evidência:** `pnpm typecheck` limpo.

## 2026-10-17 — snapshot de erro falso para conectores do platform

- **Causa:** `refreshJob` grava `status: "error"` em `snapshots` quando o subprocesso `claude -p --restricted` não encontra as ferramentas `mcp__claude_ai_*` (que só existem na sessão interativa). O painel e o `operationalSummary` liam esse erro e reportavam Gmail/Meta Ads/Sheets como desativados.
- **Correção:** `runSource` não grava mais snapshot de erro; `clearErrorSnapshots` limpa entradas `status: "error"` na inicialização do worker.
- **Evidência:** `pnpm typecheck` limpo.

## 2026-10-17 — fechamento operacional da idempotência no reenvio de artes

- **Causa:** registros `failed`/`pending` sem limpeza automática e painel sem ação de retry controlada.
- **Correção:** `creativeIdempotencyCleanup.ts` com `purgeExpiredIdempotencyRecords` (failed > 48 h, pending > 1 h, uncertain nunca); worker integrado ao ciclo de purga; `retryCreativeSendFromPanel` em `creativeAssetResolver.ts`; ação `retry_creative_send` em `workspaceApi.ts`.
- **Segurança:** retry revalida `EVOLUTION_OWNER_NUMBER` antes de agir; `uncertain` exige `confirmUncertain=true`; `retryKey` fornecida pelo cliente preserva idempotência em double-click; nenhum registro de auditoria é removido.
- **Evidência:** 11 novos testes em `tests/idempotencyCleanup.test.ts`. Total: 643 passando. `pnpm typecheck`, `pnpm rules:check`, `pnpm db:validate` 53 migrações OK.

## 2026-10-17 — idempotência no reenvio de artes criativas

- **Causa:** `resendCreativeArt` sem chave de idempotência permitia dois envios na mesma sessão com o mesmo item.
- **Correção:** parâmetro `idempotencyKey?` em `resendCreativeArt`; consulta `creative_resend_idempotency` antes de enviar; persiste ok/uncertain/failed (não persiste blocked); handlers geram `task-{taskId}-item-{itemId}` automaticamente. Migração `20261017000000` com bloco `DO` para compatibilidade local.
- **Segurança:** resultado `uncertain` armazenado nunca é re-tentado com a mesma chave; blocked (validação pré-envio) não persiste para não congelar chave se problema for corrigido.
- **Evidência:** 17 testes de integração (subiu de 12). `pnpm typecheck`, `pnpm test` (623 passando), `pnpm rules:check` OK.

## 2026-10-17 — autonomia para localizar e reenviar artes criativas

- **Causa:** sem `arte_buscar` e `arte_reenviar`, o executor não conseguia localizar artes por linguagem natural nem reenviar um arquivo sem um caminho explícito.
- **Correção:** `resolveCreativeAsset` + `resendCreativeArt` em `creativeAssetResolver.ts`; ferramentas espelhadas em `maiaImageTool.ts` e `codexMaiaMcp.ts`.
- **Segurança:** double-check de acesso (parâmetros de sessão + banco), rejeição de estado incerto, verificação de arquivo em disco, receipt em `outbound_receipts`, eventos de estado rastreados.
- **Evidência:** 24 testes (12 unitários + 12 de integração) sem chamada paga nem envio real. `pnpm typecheck`, `pnpm test`, `pnpm rules:check` OK.

## 2026-10-17 — roteiro recusado após pedido de criação

- **Causa:** o histórico chegava ao executor, mas o backend recusava a fila quando o roteiro não repetia um verbo de criação. A tentativa de reconhecer “LÂMINA/Visual” não resolvia continuidade e foi substituída.
- **Correção:** interpretação pelo executor com contexto da conversa; autorização da capacidade pela identidade e canal, sem expressão regular sobre a última mensagem. Roteiros, respostas curtas e correções podem completar o pedido anterior; análise de texto não é, por si, pedido de geração.
- **Contexto:** conversa recente do canal tem prioridade sobre memória extensa. Publicação depende do OK aplicado à operação e ao conteúdo exatos; histórico não concede permissão.
- **Evidência:** regressões offline de contexto Claude/Codex, protocolo MCP e capacidade herdada do servidor, sem chamada paga nem efeito externo. A compreensão semântica ao vivo ainda depende da avaliação das respostas reais.

## 2026-10-16 — divergência de limite e leitura sem política

- Problema: o catálogo dizia 12 passos enquanto os executores Claude usavam 30; leituras MCP desconhecidas podiam ser liberadas por omissão.
- Correção: limite único `execution.maxSteps=30`, documentação gerada e negação explícita de leitura sem política.
- Segurança adicional: `sheets.ler` deixou de representar acesso global ao Drive; permissões específicas vencidas, revogadas ou removidas de grupo são recusadas na próxima chamada.
- Compartilhamento direto do conector foi bloqueado até usar o serviço rastreável por `permissionId`; resultado incerto não é repetido.

Resumo para consulta rápida. O histórico oficial continua no `CHANGELOG.md`.

As entradas são históricas e refletem a data indicada; não são regras ativas. Comportamento vigente: `docs/regras-da-maia.md`. Pendências atuais: `TODO.md`.

## 2026-10-16 — Indicadores visuais e funil em colunas (local)

- **Causa:** números sem hierarquia uniforme, indicadores de Comercial/CS em listas expansíveis e funil sem colunas visuais. Filtrar etapa alterava o denominador da taxa de ganho; baseline podia considerar outra equipe.
- **Correção:** cartões compartilhados, grupos por área, população clicável, barras em horas/baseline e avanço por entregáveis. Funil e quadro usam os registros existentes; recorte de etapa não recalcula a taxa sobre um subconjunto indevido. Baseline e acréscimos consideram plano/equipe/período corrente.
- **Verificação:** rules:check, typecheck, 571 testes Vitest + 75 de banco temporário, build e diff-check aprovados; captura dos componentes reais com fixture isolada em 1366 px/390 px. No celular, largura do documento igual ao viewport; rolagem do funil permanece interna.
- **Estado:** código local; sem migration, alteração de regras, integrações novas ou reinício. Implantação visual ainda separada; os dados de teste usados nas capturas não entram na aplicação.

## 2026-10-16 — Áreas integradas à Central (preparadas localmente)

- **Causa:** as abas legadas de Projetos/Comercial exibiam textos estáticos e não acompanhavam os registros da Central; a área técnica ainda tinha outro editor de tarefas.
- **Correção:** visões compartilham carteira, tarefas, detalhe, API e permissões. Comercial/CS têm registros internos auditados, não cópias de tarefas; conversão gera projeto uma única vez. Marketing usa calendário de trabalho; financeiro lê somente observações autorizadas.
- **Segurança:** RLS fechada, RPCs exclusivas do backend com revisão e revalidação, bloqueio individual sobre herança e cache identificado por pessoa. Capacidade sem escopo não concede acesso. Correção de expressão SQL nullable evita autorização acidental na redistribuição.
- **Verificação:** novos testes de interface, permissões e banco temporário, incluindo edição cruzada, revogação, conversão concorrente/idempotente e população acima de mil registros. Evidências em `docs/integracao-painel-maia.md`.
- **Não ativado:** migração remota, deploy, reinício, conectores novos, mensagens reais, publicação e geração de imagens. Alterar esta documentação não ativa regras.

## 2026-10-16 — Conclusão do painel colaborativo

- **Mudança:** painéis operacionais usam backend e registros compartilhados com escopo de pessoa/equipe/cliente/projeto, workflow, revisões, baseline e capacidade; leitura autenticada e polling reconciliador.
- **Segurança:** revisão separada de administração; catálogo financeiro restrito; tarefas WhatsApp validam projeto/cliente/equipe; alterações de plano filtram IDs fora do escopo.
- **Correções:** redistribuição referenciava um parâmetro SQL inexistente; transições genéricas podiam pular revisão; associação à equipe ampliava indevidamente o contexto. Corrigidos e testados. Baseline original agora sobrevive à remoção de compromisso, com motivo/impacto/autoria.
- **Entrega:** editores de carteira/planos/tarefas, calendário, carga semanal e consulta compartilhada da Maia. 552 testes de aplicação e 67 de banco, regras, tipos, migrations e build aprovados. Aplicação remota e merge autorizados; evidências finais em `docs/painel-colaborativo.md`. Novas fontes externas e reinício do worker não foram ativados nesta etapa.
- **Banco conferido:** versões `20261016160000` e `20261016161000` aplicadas por CLI; 1697 objetos sem drift e 40 regras alinhadas. Código enviado no PR #21.
- **Integração/publicação:** PR #21 mesclado em `2fcd839`, CI da main aprovado e Vercel Production Ready. Página 200 e rotas novas 401 sem login. Worker local não reiniciado; nenhum efeito externo usado como teste.

## 2026-10-16 — Núcleo publicado e worker atualizado

- Dois pares de versões de migration foram reconciliados somente após comparação de SQL idêntico e autorização do owner. As quatro migrations do núcleo e de acessos (`20261016120000` a `20261016150000`) foram aplicadas ao Supabase configurado no projeto.
- Histórico remoto, tabelas, RPC e RLS principais foram conferidos. O código foi integrado pelo PR #19 no commit `a5e31e4`, o deploy Production da Vercel passou e um único worker foi reiniciado, voltando a aguardar a fila. Testes reais de WhatsApp e entrega seguem pendentes.

## 2026-10-16 — Gatilho de horário e métricas de cache

- Planos agora podem esperar um horário ISO futuro até sete dias; o worker faz claim idempotente a cada 30 segundos.
- Tokens de cache de leitura/criação são persistidos e mostrados se vierem no resultado do Claude; demais provedores e campos ausentes ficam nulos.
- Migration `20261016140000_maia_cache_usage.sql` validada localmente. Ativação remota continua pendente.

## 2026-10-16 — Integração local do núcleo

- **Falha encontrada:** a unicidade da migration inicial não protegia `client_id` nulo e bloqueava novas sessões depois de arquivar a anterior; reservas vencidas podiam sugerir repetição de efeito externo incerto.
- **Correção:** migration `20261016130000_maia_nucleus_safety.sql`, busca com revalidação de permissão, retenção de história de membros, eventos/leases atômicos e painel/worker conectados sob flags desativadas. A v1 permanece intacta.
- **Resultado:** 530 testes Vitest e 50 testes de banco temporário passaram, além de typecheck, build, regras e guards. Nenhuma migration remota, envio, imagem ou execução paga foi realizada. O rollout e as limitações estão em `docs/evolucao-nucleo-maia.md`.

## 2026-10-16 — Núcleo persistente em preparação

- **Causa:** a continuidade operacional estava concentrada em mensagens recentes de 24 h e em memórias do owner; faltavam contratos compartilhados para sessões isoladas, resumos rastreáveis, skills, leases de etapas, subagentes, rotinas e MCP configurável.
- **Correção:** adicionados `server/sessions.ts`, orçamento/compressão em `server/context.ts`, `server/skills.ts`, `server/planExecution.ts`, `server/subagents.ts`, `server/scheduler.ts`, `server/mcpRegistry.ts` e `server/controlledExecution.ts`, além da migration `20261016120000_maia_nucleus_v1.sql` e três skills Markdown iniciais.
- **Segurança:** tabelas novas têm RLS e acesso público revogado; a execução controlada permanece desabilitada por padrão; skills e MCP usam allowlist; autorização precisa ser revalidada pelo chamador antes da leitura/execução.
- **Pendente de operação:** aplicar a migration no ambiente autorizado, ligar os módulos aos handlers/worker/painel, configurar skills/MCP/rotinas e reiniciar um único worker. Nada disso foi ativado remotamente neste trabalho.

## 2026-10-15 — Aprovação de repetição e recibos de envio

- **Mudança em preparação:** verificação server-side de texto idêntico ao mesmo destino nas últimas 24 h; pede OK explícito antes do reenvio. Se a consulta falhar, o agente não envia.
- **Evidência:** novo registro de ID/estado em `outbound_receipts` e processamento de `MESSAGES_UPDATE`; deduplicação usa HMAC-SHA-256 com a chave de ambiente, não texto claro. Status numéricos vêm da enumeração oficial Baileys, e pendente/desconhecido não vira entrega.
- **Painel:** estados aceito/entregue/lido, data e ID técnico, sem conteúdo ou número completo.
- **Ainda necessário para ativar:** aprovação/aplicação da migration, checks do PR, habilitar o evento no webhook Evolution e atualizar/reiniciar o worker local. Até então, não se deve afirmar que a instância real envia callbacks de status.
- Detalhes: `docs/confiabilidade-envio-whatsapp.md`.

## 2026-10-15 — Mensagem duplicada em grupo do WhatsApp

- **Sintoma:** cada uma de duas solicitações gerou duas mensagens parecidas no grupo.
- **Causa comprovada:** em cada tarefa, a Maia enviou uma mensagem com `grupo_enviar_texto`; depois, o fluxo sempre entregou também o texto final da execução ao mesmo grupo.
- **Correção:** gravar evento `group_message_sent` com o JID e a tarefa, e pular a entrega final (ou aviso de falha) quando o mesmo grupo já recebeu texto nessa tarefa. A verificação falha de forma conservadora, marcando a tarefa incerta em vez de arriscar outra mensagem. Claude e Codex usam o mesmo comportamento.
- **Validação:** `pnpm typecheck`, `pnpm build` e `NODE_OPTIONS=--experimental-strip-types pnpm test` passaram (507 testes Vitest + 36 de banco). Não se enviaram mensagens reais para testar.
- **Ativação:** requer integrar a correção e atualizar/reiniciar o worker local.

## 2026-10-13 — Link de convite enviado ao número errado (dono em vez do Ítalo)

- **Sintoma:** no teste "Projeto Italo Teste 2", o pedido dizia "manda para o Ítalo" e o contato "Ítalo" existia na agenda com o número certo. A Maia mandou o link de convite ao número 2658, que é o segundo número do próprio dono (contato "Herickson maia"). O plano #3 ficou esperando esse número entrar no grupo, o que dispararia as boas-vindas quando o próprio dono entrasse.
- **Causa provável:** o contexto do pedido novo incluiu o pedido antigo "Projeto Italo Personal", que dizia "manda para o Herickson 85998372658". O agente usou esse número em vez do que estava na agenda para "Ítalo". Não houve checagem de que o destinatário é o dono.
- **Correção feita agora:** plano #3 cancelado no banco, com nota explicando o erro. O link não foi reenviado ao Ítalo: enviar a uma pessoa de fora precisa do OK do dono.
- **Correção pendente (ainda não implementada):** (1) ao enviar mensagem a um contato, usar o número da agenda que casa com o nome pedido, e não números de pedidos anteriores; (2) recusar envio para número do próprio dono, salvo confirmação explícita.
- **Também observado:** depois de o dono aprovar a criação do grupo, a Maia mandou um segundo aviso "aguardando aprovação", que confunde. Não foi corrigido.

## 2026-10-13 — Ferramenta `planilha_criar` (xlsx via exceljs)

- Agente não tinha ferramenta de xlsx; improvisava com Python (bloqueado), gerando datas como número serial e fórmulas com `#ERROR!`.
- Adicionado `server/planilha.ts` + ferramenta `mcp__maia__planilha_criar` (Claude e Codex). Dependência `exceljs 4.4.0`.
- Formatação automática: datas ISO → DD/MM/AAAA; fórmulas com `=`; moeda (R$); percentual; cabeçalho estilizado; linhas alternadas; freeze; largura automática.
- Commit `7f3e739`. Reiniciar o worker para ativar.

## Resumo de 12 e 13/10/2026: grupos, planos, áudio, aprovação e comportamento

Detalhes, causas e verificações de cada item estão no `CHANGELOG.md` (entradas de 12 e 13/10/2026).

**Grupos**
- Responder citando uma mensagem (`citar_id` em `grupo_enviar_texto`) e apagar mensagem (`grupo_apagar_mensagem`).
- Mensagem que é resposta a outra pessoa não ativa a Maia (a janela de conversa de 10 min deixou de valer nesse caso).
- `grupo_criar` passou a existir no executor do Claude (antes só no Codex). O dono entra sempre no grupo criado; a aprovação lista quem entra (nome e número), além da Maia.
- Entrada de alguém em grupo cadastrado avisa o dono (evento `GROUP_PARTICIPANTS_UPDATE` da Evolution).

**Planos de várias etapas** (migração `20261013012115_maia_plans`, tabela `maia_plans`)
- O pedido com etapas vira um plano gravado. Retoma sozinho depois do OK da criação do grupo, quando alguém entra no grupo e quando um arquivo é enviado no grupo. Arquivo de grupo só é lido se um plano esperava, e fica 24 h em `data/midia`.
- Recusa, expiração, falha ou plano parado há mais de 7 dias cancelam o plano. Cada plano é reservado antes de retomar (evento repetido não duplica).
- Regras do dono: seguir sempre o plano; se não puder cumprir uma etapa, dizer que não é permitido/possível e o que falta; não prometer o que o sistema não executa; sem roteiro fixo no código.

**Contatos e aprovação**
- `contato_salvar` (só agenda) separado de `membro_cadastrar` (só quando o dono pede para adicionar à equipe). Repasse da resposta a quem a Maia procurou (48 h), inclusive membro; número sem o 55 é reconhecido.
- Pedido do dono é aprovado só pelo dono. Nenhuma permissão de ninguém foi alterada (uma remoção feita por engano foi desfeita).

**Áudio**
- O Whisper do EasyPanel travava; agora a transcrição roda no PC (`scripts/whisper_local.py`, faster-whisper `small`, 127.0.0.1:8000), iniciada pelo launcher junto com o worker. Falha avisa em até ~2 min e o áudio (dono, membro e grupo) fica 24 h e é retomado a cada 10 min.

**Modelo e comportamento**
- O Haiku só atende pedido curto e de uma ação; o resto vai ao Sonnet 4.6.
- Teste de comportamento com o agente real e ferramentas simuladas achou e corrigiu quatro falhas (grupo sem o dono, "ferramenta", aviso de resposta, número sem 55).

**Pendências (também no `TODO.md`)**: teste ao vivo do fluxo completo do Projeto Italo; obrigatoriedade do plano em pedidos com várias etapas; gatilho de arquivo/resposta no privado; formato real do evento de entrada em grupo; modelo `large-v3` no PC (falta espaço no C:); grupo duplicado "Projeto Ítalo" (com acento).

## Áudio: falha rápida e retomada (12/10/2026)

- Causa: o Whisper do EasyPanel não concluía a transcrição; a Maia esperava ~8 min e depois descartava o áudio.
- Correção: espera máxima de ~2 min, aviso imediato, áudio guardado por 24 h e nova tentativa a cada 10 min, mostrando o texto ao dono quando o servidor voltar.
- Vale para dono e membro: o áudio do membro volta como mensagem dele quando o servidor voltar, com as permissões dele; o dono vê o texto e decide.
- Vale também em grupo: avisa no grupo só quem estava falando com a Maia; ao voltar, entra na memória do grupo e só responde se a Maia foi chamada.
- Whisper reiniciado no EasyPanel e testado: responde, mas é lento (5 s de áudio levam ~40 s; servidor com CPU alta). A retomada em segundo plano usa 360 s por tentativa.
- Pendente: decidir entre modelo `base`, mais CPU ou serviço externo de transcrição; teste ao vivo da retomada.

## Contato avulso e repasse da resposta (12/10/2026)

- Causa: salvar um contato para enviar mensagem criava uma Pessoa `equipe` com permissão de conversa, e a resposta dessa pessoa não era repassada ao dono.
- Correção: `contato_salvar` (só agenda) e repasse ao dono para qualquer número procurado nas últimas 48 h, mesmo cadastrado. `membro_cadastrar` só quando o dono pedir para adicionar à equipe.
- Pendente: limpar o cadastro de equipe do João em produção; repassar áudio/mídia de contato avulso.

## Criativo do WhatsApp para Meta Ads (12/10/2026)

- Prompt de imagem agora menciona `anuncio_midia_url_temporaria`, igual ao vídeo. Toda a infraestrutura já existia (`adsMedia.ts`, bucket `ads_media_temp`, limpeza automática).

## Texto citado (reply) passa para o agente (12/10/2026)

- **Causa:** reply em grupo/privado chegava ao agente sem o texto original citado; ele perdia o contexto e interpretava errado. **Correção:** `quotedTextFrom` + `withQuoted` prefixam `[Citando: "..."]` ao texto antes de guardar.

## maxTurns elevado e aviso de parcial (12/10/2026)

- **Causa:** planilhas com muitas células estouravam o limite de 12 passos, sem resposta ao dono. **Correção:** limite elevado para 30 nos dois executores; quando ainda bater, mensagem informa que foi parcial.

## Jev: régua corrigida (12/10/2026)

- **Causa:** a concordância de 51% vinha de uma régua que só conhecia arte/consulta/escrita. **Correção:** categorias das ferramentas mapeadas para as do Jev, métricas por intenção, categoria e confiança recalculadas na visualização (62% com a régua corrigida). Modo sombra mantido.

## Aba de conversa desativada (12/10/2026)

- Removida a aba Conversa do Agente Maia. A seção abre em Regras ativas e links antigos do chat redirecionam para essa tela. O chat deixa de ser carregado pelo painel.

## Fechamento dos formulários do painel (12/10/2026)

- **Causa:** atualizar cadastros após conflito não atualizava os valores/revisões dos formulários.
- **Correção:** clientes selecionados por ID; formulários reiniciados pela revisão. Gravação aceita seguida de falha na leitura é comunicada como cadastro salvo, evitando repetir a escrita.
- **Verificação:** 426 testes de aplicação e 35 de banco aprovados, TypeScript/build aprovados. Navegador indisponível para inspeção visual autenticada; correção ainda não publicada nesta sessão.

## Painel, clientes e grupos de acesso (12/10/2026)

- **Causa:** a navegação repetia grupos e permissões em Operação com dados de demonstração, enquanto os cadastros reais ficavam em outras telas.
- **Mudança:** sete áreas com abas; Acessos no lugar de Pessoas; Agente Maia reúne conversa, regras ativas e continuidade; Sistema e integrações reúne fontes e roteamento. Identidade do login no cabeçalho, links antigos preservados e snapshot compartilhado. Grupos reais podem ser associados a clientes e a equipes com membros/permissões.
- **Separação:** contexto por grupo/cliente, acesso às ferramentas limitado ao próprio cliente e revalidação das permissões durante fila/aprovação/entrega. Grupos novos nascem pausados; aprovações continuam individuais. Cadastros globais são exclusivos do proprietário.
- **Reconciliação:** SQL de `20261011185724` conferido no histórico remoto, somente leitura. A inclusão posterior de `requester` foi retirada; essa coluna fica apenas na migração corretiva `20261012014613`. Preservadas as mudanças da outra sessão.
- **Verificação:** 421 testes de aplicação e 35 de banco, typecheck, build, validação de 34 migrações e catálogo/documento aprovados. A guarda é conferida após o commit. Conferência visual e exercício real de grupo de cliente ainda pendentes.

## Correção: coluna requester ausente em response_deliveries (12/10/2026)

- **Causa:** a coluna foi incluída numa migração já aplicada, então o banco nunca a recebeu e as respostas da Maia falhavam ao gravar.
- **Correção:** migração nova que acrescenta a coluna (`if not exists`). A linha incluída posteriormente em `20261011185724` foi retirada na reconciliação do painel descrita acima.

## Fase 4: prospecção com OK a cada envio (12/10/2026)

- **Mudança:** lotes de contatos com mensagem final, um envio por vez com OK do dono, teto de 30 por dia, descadastro com SAIR e sem repetir contato em 30 dias. Tabelas na migração `20261012021430`.
- **Pendências:** aplicar a migração; descadastro automático por resposta ainda não existe; checagem de WhatsApp e envios não testados ao vivo.
- **Verificação:** 407 testes, `db:validate` com 32 migrações, 63 ferramentas no MCP.

## Regra de contatos: prospecção pedida pelo dono (12/10/2026)

- **Causa:** a regra só proibia prospecção por conta própria, e a Maia recusava o pedido do dono mesmo com as ferramentas prontas.
- **Correção:** regra `contatos_membros` (versão 2026-10-12.2) com o fluxo de prospecção pedida. **Pendência:** aplicar a migração `20261012104713`.

## Cofre de segredos para tokens de integrações (12/10/2026)

- **Mudança:** `cofre NOME | valor` no privado do dono guarda o token criptografado (`maia_secrets`), sem passar pela IA nem pelo histórico; em grupo é recusado. O catálogo lê do cofre quando o `.env` não tem o segredo.
- **Limites:** a mensagem segue no celular e na base da Evolution; o registro da fila existe por segundos na Vercel.
- **Pendências:** aplicar a migração `20261012030526`; criar `INTEGRACAO_VAULT_KEY`; reiniciar o worker.

## Correção: Maia não respondia à menção em grupo (12/10/2026)

- **Causa:** a menção veio com o identificador interno do WhatsApp (`@lid`), e o sistema só comparava com o telefone. **Correção:** `MAIA_LID` no ambiente, conferido no webhook e no worker. **Pendência:** `MAIA_LID` no ambiente da Vercel.

## Áudio do dono sem eco da transcrição (12/10/2026)

- **Mudança:** a Maia deixou de responder `Entendi: "<transcrição>"` ao áudio do dono. A transcrição segue no backend e vira o pedido. **Verificação:** `tests/audioSemEco.test.ts`, 438 testes.

## Atualização 12/10/2026 (estado atual)

- **Menção em grupo:** PR #6 mesclado (`1692a42`); `MAIA_LID` cadastrada na Vercel como variável plain em Production. Falta testar ao vivo citação e áudio.
- **Whisper:** serviço fora do ar (container em loop no boot). Compose corrigido salvo no EasyPanel, ainda não implantado.
- **Aplicado no banco:** `20261012030526_maia_secrets_vault` (cofre), `20261012104713_maia_rules_contatos_prospeccao` (regra de contatos com prospecção) e as demais migrações de hoje. Conferido por leitura.
- **Chave do cofre:** `INTEGRACAO_VAULT_KEY` criada no `.env` da pasta `agent-maia` (sem registro no repositório). Backup é responsabilidade do owner.
- **Worker:** reiniciado depois da chave; há um só worker na pasta original.
- **Ainda falta validar ao vivo:** cofre (`cofre teste | ...`), prospecção pelo WhatsApp, menção fantasma e rotas de escrita.

## Resumo de 10–12/10/2026: o que foi feito

- **Executor Claude pelo Claude Code CLI** (commits `92f0f1b`, `784046e`, `edcc606`): Claude roda por `claude -p`; o Agent SDK continua como alternativa.
- **Catálogo de integrações** (`66a9abd` e anteriores): tabela `maia_integrations`, 34 endpoints da Evolution v2 (25 ativos, 9 pausados), 18 rotas do Instagram pela Zernio (10 de leitura, 8 externas com OK por uso).
- **Correção da listagem de ferramentas:** parâmetros de ferramenta viram texto JSON. Antes, um `z.record` derrubava a lista inteira e a Maia perdia grupos, contatos e avisos.
- **Correção das respostas:** coluna `response_deliveries.requester`, que nunca tinha chegado ao banco.
- **Fase 2:** busca na web só para o dono, sem OK; trava que pede OK para ações que alteram algo depois de uma busca; regra "Limites" nova (versão `2026-10-12.1`).
- **Mencionar todos** no grupo: menção fantasma (todos avisados, texto sem números).
- **Fase 4, prospecção pedida pelo dono:** lotes com mensagem final, um envio por vez com OK, teto de 30 por dia, SAIR obrigatório, sem repetir contato em 30 dias, checagem de WhatsApp.
- **Migrações aplicadas no banco:** `20261012005057`, `20261012012214`, `20261012013924`, `20261012014613`, `20261012020001`, `20261012021430`.
- **PR #5** aberto para `main`, com `db:guard` passando.


## Fase 2: busca na web para o dono e trava depois da busca (12/10/2026)

- **Mudança:** o dono pede pesquisa direta; a regra "Limites" passa a dizer o que fazer sem ferramenta. Depois de uma busca na tarefa, ações que alteram algo pedem OK, até do dono.
- **Pendência:** `db:guard` acusa o `drop constraint` da migração `20261012012214` (aplicada); falta a marcação `destrutivo-aprovado` em commit próprio.
- **Verificação:** 393 testes, `db:validate` com 31 migrações, `rules:check` ok.

## Catálogo: Instagram pela Zernio (12/10/2026)

- **Mudança:** 18 rotas do Instagram da Zernio no catálogo (10 de leitura, 8 externas com OK por uso), parâmetros no caminho e opcionais, chave `ZERNIO_API_KEY` presa a zernio.com. **Pendências:** migração não aplicada; escrita não exercitada ao vivo; Fases 2 e 4 não começaram. **Verificação:** 384 testes, 60 ferramentas no MCP, `db:validate` com 29 migrações.

## Correção: Maia sem as ferramentas mcp__maia__ (12/10/2026)

- **Causa:** `z.record` nas três ferramentas novas do catálogo derrubava a listagem MCP inteira, para o Claude e para o Codex. **Correção:** parâmetros como texto JSON validado no servidor, com teste que lista as ferramentas pelo MCP. **Verificação:** 60 ferramentas listadas, 380 testes. **Pendência:** reiniciar o worker.

## Catálogo: endpoints da Evolution e nível externa (12/10/2026)

- **Mudança:** 34 endpoints da Evolution v2 no catálogo (25 ativos, 9 pausados de maior dano). Integração `externa` pede OK a cada uso pela ferramenta `integracao_chamar_externa`; parâmetros só na consulta da URL.
- **Fora do catálogo:** o que já tem ferramenta própria com limites e as rotas que vazam segredo ou desviam mensagens.
- **Pendências:** migração não aplicada; escrita não exercitada ao vivo; regra "Limites", busca na web, Instagram e prospecção em fases seguintes.
- **Verificação:** typecheck, build, `db:validate` (28 migrações) e 375 testes Vitest.

## Catálogo de integrações por endpoint (12/10/2026)

- **Mudança:** novo catálogo (`maia_integrations`) para a Maia chamar APIs por configuração, sem editar código: listar, propor (sempre pendente), chamar (só ativas) e ativar (aprovação do owner). Primeira integração: reação no WhatsApp pela Evolution.
- **Segurança:** só o nome do segredo fica no catálogo (prefixo `INTEGRACAO_`); token não passa pelo chat; https público, sem redirecionamento, com limite de tempo e tamanho; o segredo é apagado de qualquer retorno.
- **Pendências:** migração ainda não aplicada em produção; sem cofre de segredos; regra "Limites" e busca na web inalteradas.
- **Verificação:** typecheck, build, 340 testes Vitest, 32 de banco e `rules:check`.

## Claude Code CLI como executor principal (11/10/2026)

- **Mudança:** o Claude passa a rodar pelo Claude Code CLI (`claude -p`) em vez do Agent SDK. As ferramentas da Maia e a decisão de permissão/aprovação continuam no worker, acessadas pelo CLI por um MCP HTTP local (127.0.0.1, token por execução). Roteamento, fallback para o Codex, Jev, regras e aprovações não mudaram.
- **Voltar atrás:** `MAIA_CLAUDE_EXECUTOR=sdk` ou `executor: "sdk"` no `config/ai-routing.json`; CLI ausente ou incompatível cai sozinho no SDK antes de agir. Tag `pre-claude-cli-executor`.
- **Codex:** ganhou 9 ferramentas que só o Claude tinha (grupos, conversas, contatos da instância, reenvio de arquivo). `anuncio_midia_url_temporaria` segue só no Claude (depende do Meta Ads dele).
- **Tudo no CLI:** o refresh do painel (`refreshJob`) e a Maia de demonstração também usam o CLI (ponto único `claudeSimple.ts`; SDK só como alternativa). Medido: a consulta de conectores custa ≈ US$ 0,091 no CLI contra ≈ US$ 0,055 no SDK.
- **Limites:** Edit/Write/Bash continuam bloqueados. Sem VPS e sem modo dev por WhatsApp (decisão do owner); código da Maia muda por sessão direta do Claude Code. A Maia no WhatsApp respondeu com o CLI em teste do owner (11/10), mas aprovação por OK ponta a ponta ainda não foi exercitada.
- **Verificação:** typecheck, build, 325 testes Vitest, 32 de banco, `rules:check` e teste real do CLI com ferramenta falsa.

## Trava de geração de arte e preferências permanentes (10/10/2026)

- **Sintoma:** em conversa sobre Stories, a Maia iniciou a geração depois de apenas oferecer criar uma arte; o processo expirou após até 240 s.
- **Correção de arte:** só a mensagem original, com pedido direto e afirmativo do owner, autoriza a geração. Claude e Codex verificam a intenção no servidor; pergunta, consulta, oferta e recusa não autorizam. Negado por padrão.
- **Preferências permanentes:** propostas de estilo/sugestões ou restrições mais estritas ficam pendentes até comando literal `CONFIRMAR PREFERENCIA <id>` do owner; expiram em 10 min e podem ser canceladas. A Maia não pode ampliar permissões ou modificar segurança/aprovações; a ativação usa RPC restrita a `service_role`.
- **Verificação:** typecheck, build, 301 testes Vitest, 32 testes de banco via Node 24, validação das 25 migrações e catálogo aprovado. No PR #4, CI/validate com `db:guard` e o preview Vercel passaram após a reconciliação do version remoto.
- **Implantação:** migração aplicada ao Supabase por exceção explicitamente autorizada pelo owner e reconciliada como versão `20261011012443`; o código está no PR #4, ainda sem merge/deploy de produção.

## Eventos de grupo da Evolution + incidente no webhook de produção (10/10/2026)

- **Mudança:** ativados os eventos de grupo (`GROUPS_UPSERT`, `GROUP_UPDATE` — singular, não `GROUPS_UPDATE` — e `GROUP_PARTICIPANTS_UPDATE`) no webhook da Evolution; o worker agora invalida o cache de grupos na hora que um deles chega, em vez de só confiar no TTL de 15 min.
- **Incidente:** ao aplicar isso, o script usado reconstruía a URL do webhook a partir de `WEBHOOK_PUBLIC_URL`, uma variável do túnel Cloudflare do launcher legado que ficou parada e desatualizada no `.env`. Isso sobrescreveu o webhook de produção, apontando pro túnel morto em vez da Vercel — a Maia ficaria sem receber mensagens novas. Percebido e corrigido na mesma sessão, antes de qualquer impacto prolongado. Causa raiz corrigida: nova variável dedicada `EVOLUTION_WEBHOOK_URL`, documentada em `.env.example`; o script nunca mais lê `WEBHOOK_PUBLIC_URL`.
- **Lição:** qualquer script que reconfigura um serviço de produção (webhook, migração, etc.) deve ler a URL/estado de uma fonte confiável, nunca de uma variável conhecida por mudar entre sessões/processos.

## Ponte Supabase → Meta Ads para vídeo/imagem (10/10/2026)

- **Problema:** vídeo/imagem mandado pelo dono só ficava salvo localmente (`data/midia`); a ferramenta de upload do Meta Ads por URL exige um link https público, não aceita arquivo local fora de um app interativo (que o WhatsApp não tem).
- **Correção:** bucket privado `ads_media_temp` no Supabase (criado em código, não por migração — `storage.*` não existe no Postgres de teste do projeto), com URL assinada de 2h e limpeza automática. Nova ferramenta `anuncio_midia_url_temporaria`, só do dono.
- **Limitação conhecida:** não testado contra um upload real no Meta Ads (exigiria subir conteúdo de fato na conta de anúncio).

## Alinhamento de regras e conhecimento (10/10/2026)

- **Problema:** documentos, regras ativas e diretrizes locais discordavam sobre quem pode agir, aprovação, áudio, retenção e integrações. O RAG incluía plano antigo e histórico sem distinguir vigência.
- **Correção:** catálogo único versionado, Markdown gerado, prompt com seções e reserva completa; cache isolado por banco e números lidos no momento da execução. Histórico sai da busca operacional, mas os arquivos e trechos permanecem preservados.
- **Erro de indexação:** checksum era publicado antes de concluir os vetores e os trechos antigos eram apagados antes da troca. Agora a gravação é atômica, compara a versão anterior e permite reparar fonte incompleta/inativa.
- **Instagram:** versão 2026-10-10.2 alinhada no catálogo, documento e Supabase (39 regras; hash `5f40630d48d31010801c35e10eedcdd4507dcce36d943c5c00b6a56b0326c0ca`). Inclui foto, carrossel, Reels, Story, edição/cancelamento de posts não publicados e privacidade do inbox/automações. Recursos espelhados no executor Codex.

## LinkedIn simétrico entre Claude e Codex (10/10/2026)

- **Problema:** as 4 ferramentas de LinkedIn (contas, organizações, desempenho, publicar) só existiam na ponte do Codex; o executor principal (Claude) não tinha nenhuma.
- **Correção do owner:** Zernio é API direta, não conector MCP exclusivo — não deve haver diferença de capacidade entre os executores para o que passa por ela.
- **Mudança:** as 4 ferramentas foram espelhadas no Claude; novas `linkedin_post_cancelar`/`linkedin_post_editar` nos dois executores, reaproveitando as mesmas funções genéricas (por `postId`) já criadas para o Instagram.
- **Correções:** timestamps futuros não abrem janela do Direct; pedidos de aprovação e resumo persistido mostram a ação e o texto em análise. Manual e painel corrigidos.
- **Verificação:** migrações validadas, regra remota alinhada e documento sincronizado sem erro; typecheck e regras geradas conferidos. A última suíte completa anterior às correções passou com 281 Vitest + 32 de banco e não foi repetida nesta revisão. Build mantém aviso acima de 500 kB. Conversas reais, inspeção autenticada e ações externas continuam pendentes; consulta de áudio depende de reconexão Facebook Login.
- **Pendências de produto:** avaliação semântica em conversa real, fingerprint de aprovação e retenção futura de `messages` continuam em `TODO.md`; não foram declarados implementados.

## Áudio em grupo cadastrado (10/10/2026)

- **Sintoma:** o owner mandou um áudio chamando a Maia dentro de um grupo cadastrado e ela respondeu que nenhum áudio tinha chegado — resposta tecnicamente certa, mas escondia uma lacuna real.
- **Causa:** `toInboxRow` (`server/inbox.ts`) só lia texto no ramo de grupo; `audioMessage` não tinha caminho nenhum ali, então caía no fallback de "atividade do grupo" sem baixar nem transcrever. A função de áudio (`audioFrom`) só era alcançada fora de grupo.
- **Correção:** grupo cadastrado agora também aceita `audioMessage`; a parte de "foi endereçado" que não depende do texto (menção, resposta à Maia, janela de conversa de 10 min) é decidida antes de transcrever, e a chamada pelo nome é checada depois, no texto transcrito (`handleGroupAudio`, `server/ownerRouter.ts`). Mesma memória de grupo de 7 dias que o texto já tinha.
- **Verificação:** `pnpm typecheck` e `pnpm test` aprovados (254 vitest + 27 de banco); teste novo em `tests/inbox.test.ts`.
- **Fora do escopo:** `server/webhookServer.ts` (webhook local antigo, porta 3100) nunca suportou grupo cadastrado, nem para texto; não foi alterado.

## Remoção da moldura das permissões (10/10/2026)

- **Correção do entendimento:** o usuário se referia ao quadro claro em torno de cada permissão. O ajuste anterior de tamanho não resolvia esse detalhe visual.
- **Mudança:** removidos borda e fundo de cada item, inclusive dos selecionados. Checkbox, textos completos, foco de teclado e indicador verde de seleção mantidos; nenhuma alteração na lógica de acesso.
- **Verificação:** build e 7 testes de Pessoas aprovados. Conferência visual no navegador não realizada; aviso de bundle acima de 500 kB permanece.

## Permissões mais compactas (10/10/2026)

- **Problema:** cartões com altura mínima de 91 px e padding amplo ocupavam espaço excessivo; o breakpoint de 1150 px também forçava uma única coluna mesmo com espaço para duas.
- **Correção:** altura mínima de 44 px, padding de 9×10 px, gap de 6 px e grade automática conforme a largura do perfil. Descrições completas, tamanho das fontes e controles preservados.
- **Validação:** build aprovado e 7 testes da tela Pessoas aprovados. Mudança apenas em CSS; sem alterações no banco/permissões. Inspeção visual no navegador não realizada; aviso de bundle acima de 500 kB permanece.

## Pessoas: organização e visual profissional (10/10/2026)

- **Problema visual:** cada pessoa repetia todos os números e permissões na mesma página, tornando a leitura longa e pouco hierárquica.
- **Melhoria:** diretório pesquisável à esquerda e perfil à direita, indicadores de cadastros, filtros Todas/Ativas/Desativadas, números formatados, papéis identificados por avatar, permissões em cartões e botão Nova pessoa. No celular, abre-se um perfil por vez com Voltar para pessoas.
- **Bug funcional:** a inclusão de número usava `/D/g` em vez de `/\D/g`; telefones formatados eram rejeitados. Corrigido. Bloqueios de duplo clique e tratamento de erro evitam envios repetidos durante uma gravação.
- **Falha parcial:** após salvar a pessoa, se o WhatsApp não puder ser vinculado, abre-se o perfil já criado para corrigir o número, sem manter o formulário de cadastro disponível para uma tentativa duplicada.
- **Segurança e revisão:** orientação do Supabase aplicada para preservar chave pública/RLS e edição exclusiva do proprietário; revisão React manteve carregamento paralelo, dados derivados sem efeitos extras, formulários separados e controles rotulados. Sem mudanças no banco, novas dependências ou credenciais expostas.
- **Validação:** TypeScript e build aprovados; 240 testes de aplicação + 27 de banco temporário aprovados. Os 7 testes novos cobrem resumo, busca sem acentos/telefone formatado, status, somente leitura, WhatsApp, permissão, navegação lista/perfil, cadastro parcial e falha na verificação do proprietário.
- **Limitações:** browser indisponível (`No browser is available`); inspeção visual autenticada não realizada. Build/testes exigiram execução fora do sandbox por `spawn EPERM`; build concluído com aviso de bundle acima de 500 kB. Nenhuma gravação remota foi feita nos testes desta tela.

## Adicionar participante, lembrete sem contexto, painel manual, números nas regras (10/10/2026)

- **Diagnóstico de "a Maia tá estranha" (Gessica/Gusta):** não era bug nem Codex (conferido em `agent_runs`: tudo Claude, sem fallback). Eram duas mensagens do owner próximas, processadas em ordem (fila por conversa); a resposta ao "Pra mim" (sobre o rascunho do Gusta) chegou 3s depois do pedido da Gessica, dando a impressão de confusão.
- **Gap real confirmado nesse episódio:** faltava ferramenta para adicionar alguém a um grupo já existente (pedido 3 vezes). Implementada (`grupo_adicionar_participante`).
- **Bug real confirmado:** lembrete (`taskReminders.ts`) não gravava a própria mensagem na conversa; por isso "feito, falei com ele" chegou sem contexto de quem/assunto. Corrigido.
- **Pedido do owner:** painel "Tarefas e eficácia" não deve ter criação manual (tarefa, lembrete, avaliação) — tudo nasce da conversa com a Maia. Formulários de criação removidos do `TarefasPage.tsx`; edição/correção do que já existe continua.
- **Dados sensíveis na tela "Regras da Maia":** duas regras tinham o número do dono e do aprovador escritos em texto puro, visíveis na tela (ela mostra `maia_rules` por completo). Removidos; o comportamento é preservado injetando os números do `.env` no prompt em tempo de execução, nunca gravado no banco.

## Membro conversa com a Maia no privado (10/10/2026)

- **Pedido do owner:** quem tem permissão `conversa.maia` (membro cadastrado) fala com a Maia no privado, não só em grupo; áudio/imagem/vídeo/documento de membro ou contato também são entendidos, com retenção de 7 dias (dono continua 24 h); prospecção continua só com quem já aceitou falar com ela.
- Implementado: `handleMemberMessage` (maiaOwnerAgent.ts), `handleMemberAudio`/`handleMemberMedia` (ownerRouter.ts), tabela `received_media` + ferramenta `arquivo_reenviar` (owner pede o arquivo original de volta), `members` carregado no webhook por `conversa.maia`.
- Duas migrações aditivas aplicadas em produção: `events`/`inbox.sender` aceita `member`; tabela `received_media`. `db:drift` sem divergência depois de aplicar.
- Corrigido no caminho: `responseDelivery.ts` só sabia registrar a resposta do dono (histórico comum) ou de um grupo; destinatário que não é nenhum dos dois (membro/contato) agora grava em `dm:<número>`, mesma convenção do `contato_enviar_mensagem`. Dois testes existentes de `responseDelivery.test.ts` dependiam, sem dizer, de o único destinatário possível ser o dono; passaram a fixar `EVOLUTION_OWNER_NUMBER` para continuar representando esse caso.
- **Não testado ao vivo.** Pendente: cadastrar um membro de teste e mandar uma mensagem, um áudio e uma imagem pelo WhatsApp dele; reiniciar a Maia.

## Aplicação do plano em 10/10/2026: trabalho, lembretes e eficácia

- Problema: `tarefa ...` criava uma execução da IA, sem prazo/responsável/estado real. Correção: `work_tasks` independente, três estados, revisão otimista, histórico por transação e conclusão com evidência informada. Tarefa respondida pela LLM não é trabalho entregue.
- Lembretes: prazo gera aviso ao owner, novos horários ISO com fuso explícito; edição/cancelamento, claim atômico, ID de aceitação, falhas/incertezas no painel. Dependem do worker ativo, inclusive após suspensão/reinício do computador; pendências vencidas são consumidas quando ele volta.
- Falha HTTP 400 anterior: o corpo não era diagnosticado. Agora o erro expõe HTTP e classificação segura, sem salvar conteúdo privado. Resposta persistida, envio dividido, execução e entrega separados. Apenas respostas rejeitadas podem ser reenviadas pontualmente pelo painel; não refaz o pedido nem a ação externa. Timeout/5xx/sem ID/queda não repete automaticamente.
- Relevância/resolução: revisão humana com resultado esperado, justificativa e eventos; novos pedidos/respostas WhatsApp ficam disponíveis por sete dias na outbox. Registros antigos exigem conferência na conversa original. Sem avaliações não há nota; meta de 90% em pelo menos 20 casos ainda não está comprovada.
- Claude e Codex compartilham cinco ferramentas novas de trabalho e o resumo atualizado; permissões mantidas. A interface e a API administrativas têm escopo do owner, não autorização por perfil demonstrativo do navegador.
- Verificações iniciais: TypeScript aprovado; 185 testes de aplicação e 27 de banco temporário aprovados. Incluem RLS/privilégios, constraints, prazo e histórico atômicos, claim sem repetição e ordem das partes de resposta.
- Impedimentos encontrados: ferramenta do navegador não inicializa (`os error 3`); CLI Supabase recusa o BOM existente no `.env`. Verificação visual autenticada não realizada. Migração executada pela CLI a partir de cópia temporária, preservando `.env` e a versão SQL original.
- Alteração preexistente em `server/inbox.ts` pertence ao usuário e permanece fora desta entrega/commit.

### Ativação e verificação final

**Fechamento da aplicação do plano (10/10/2026):** código e migração salvos no repositório; último commit de implementação `e0e7407`, enviado a `main`. Deploy desse commit confirmado como READY em `https://agent-maia.vercel.app`, implantação `dpl_4bEVnLpXYY6ywQK1BN7NZczZpbhr`.

- Resultado final dos testes: **195 testes de aplicação em 32 arquivos e 27 testes de banco temporário aprovados**. TypeScript e importação nativa do worker aprovados; banco real sem divergência, com 565 objetos conferidos.
- Validações reais: Codex via SDK consultou tarefas/lembretes no banco; lembrete técnico aceito pela Evolution com ID de mensagem. Aceitação não comprova leitura nem eficácia semântica do agente.
- **Ativação pendente:** a sessão recusou iniciar o processo em segundo plano e não encontrou worker Maia em execução. Abrir `Iniciar Maia.bat` no computador para habilitar processamento contínuo de mensagens e lembretes. Publicar o painel não inicia o worker local.
- **Qualidade ainda a comprovar:** realizar 20 avaliações humanas de pedidos reais e inspeção visual autenticada. Não declarar a meta de eficácia atingida apenas pelos testes técnicos.

Os itens abaixo registram as verificações intermediárias e a causa/correção dos problemas encontrados.

- Migração aplicada com `supabase db push --linked --yes`, preservando versão/histórico. `db:drift`: 565 objetos esperados e 565 reais, sem divergência.
- Teste real: tarefa técnica #1, lembrete #1, Evolution aceitou o envio com ID `3EB09A20C8D5860DB245C1`. Tarefa encerrada com evidência técnica; não representa tarefa de negócio nem leitura da mensagem. Nenhum envio a terceiros/publicação.
- Ponte nativa Codex: 21 ferramentas, incluindo as cinco de tarefas/lembretes; consulta somente leitura retornou tarefa/lembrete reais sem erro. Importação do worker no Node 24 validada. A primeira execução nativa detectou propriedade de parâmetro TypeScript incompatível com strip-only; corrigida antes de ativar o worker.
- Verificação final de lógica/API/DOM: 190 testes em 30 arquivos e 27 testes de banco temporário; TypeScript, reconstrução do esquema e build aprovados. Bundle de 515,88 kB continua com aviso não bloqueante. DOM não substitui revisão visual autenticada.
- Launcher suporta `--headless` para ativação em segundo plano sem abrir janela do navegador; a abertura normal do `.bat` permanece igual. Worker e deploy serão conferidos após o commit.
- Teste pela LLM (além do cliente MCP direto) encontrou `tarefas_listar` bloqueada pela política interativa do CLI. Ajuste restrito à ponte local: `default_tools_approval_mode = approve`, servidor obrigatório, metadados de consulta read-only. Gates de autorização/risco da Maia não mudam, nem sandbox/rede do modelo. Referência: https://developers.openai.com/codex/mcp/ (Other configuration options).
- Commit inicial `417518e` enviado a main; deploy da Vercel concluído. A ativação de processo em segundo plano foi recusada pela política desta sessão; nenhum worker Maia foi encontrado em execução. Necessário abrir `Iniciar Maia.bat` no computador para ativar o consumo contínuo.
- Revalidação do Codex via SDK pela LLM: chamou `mcp__maia__tarefas_listar` e retornou corretamente “Tarefas reais: 1. Lembretes persistidos: 1.” em 13,35 s. Consulta somente leitura, sem enviar outra mensagem nem avaliar a própria qualidade. Falhas do transporte/política SDK agora geram `tool_failed`, mesmo que o modelo responda.
- Produção: `https://agent-maia.vercel.app` em READY para a aplicação inicial, com `api/workspace` instalada; pedido sem login retornou 401 `login_required`. Teste do proprietário autenticado/validação visual ainda não realizado nesta sessão.
- Após a correção da política SDK: 191 testes de aplicação em 31 arquivos aprovados; TypeScript e `db:validate` aprovados. Os 27 testes de banco também passaram. Não foi alterada a migração após aplicá-la.
- Resumo/Indicadores rotulam os registros de IA como execuções, para não confundir com os três estados do trabalho. Plano atualizado: implementação disponível, ativação contínua local e revisão humana de 20 casos ainda pendentes. Consulta real de eficácia retorna 100 candidatos, zero avaliações e notas nulas, sem inventar resultados.
- Retomada de resposta: consumidor da outbox registra o texto aceito no contexto comum do WhatsApp/grupo antes de encerrar a execução; caminho imediato não duplica eventos de resposta. Assim o próximo modelo tem a resposta no histórico mesmo se houve reinício durante a entrega.
- Testes adicionais da outbox cobrem partes em ordem, contexto após aceitação completa, retomada sem reenviar parte aceita e bloqueio após falha/timeout, sem nova chamada da LLM.

## Atualização de 10/10/2026: relevância, eficácia e qualidade

- Problema confirmado: nota 3/10 limitada por tentativas de publicação bloqueadas/expiradas, sem efeito externo. O cálculo agora exige `external_done` e aprovação anterior da mesma tarefa/operação; uma autorização vale uma ação. Expiração respeitada conta como controle correto.
- Conferência: prova ligada à mesma tarefa/operação e posterior ao efeito, sem contar ID repetido. A precisão histórica permanece 3 ações de 9; as seis provas ausentes não foram inventadas.
- Codex: classificação operacional quando usa ferramenta, registro de efeitos/provas, estado do post conferido na Zernio, mensagens diretas contabilizadas e bloqueios/expirações identificados.
- Nova consulta `operacao_resumo` para ambos os modelos: pedidos, estados, aprovações e conexões reais do banco. Resumo interno do owner; outros precisam de aprovação. Orientações cobram dados reais e distinguem execução, conferência e pendência.
- Painel: amostras, prioridades por evidência, falhas de envio e de conversas simples, ações sem prova, mediana/p95; execução encerrada não é sinônimo de pedido resolvido.
- Reavaliação somente leitura: 8,15/10 sobre os mesmos 106 registros, sem os falsos incidentes. A subida da nota corrige a medição, não a eficácia passada.
- Plano de prioridades e metas em `docs/plano-eficacia-maia.md`. Sem migração de esquema ou alteração do histórico. Pendentes: causa do envio HTTP 400, revisão de incertas, inspeção visual e validação real; tarefas com prazo/lembretes seguem planejadas.
- Verificado: 174 testes de lógica/renderização, 24 de banco temporário, TypeScript/build e consulta real pela ponte do Codex. Carregar a nova versão ao iniciar/reiniciar o worker; a conversa real e a inspeção visual permanecem pendentes.

## Atualização de 10/10/2026: estado do WhatsApp

- A tela mostrava "Não verificado" por não reconhecer explicitamente alguns formatos do estado da Evolution e por usar esse texto quando o estado estava vazio.
- Consulta direta feita durante a análise confirmou HTTP 200 e estado `open` na instância configurada.
- A tela e o resumo global agora tratam os estados de forma insensível a maiúsculas e deixam claro quando a Evolution não retornou leitura, sem chamar isso de WhatsApp desconectado.

## Atualização de 10/10/2026: Indicadores e Conexões

- Problema e causa: as duas páginas exibiam cartões derivados das mesmas fontes (gasto, e-mails e planilhas), sem separar resultado operacional de estado da integração.
- Melhoria: Conexões usa tabelas de serviços e coleta, com diagnóstico, última tentativa e atenção após 60 minutos sem coleta válida. Indicadores mostra resposta, conclusão, falhas, resultados incertos, aprovações, qualidade e investimento por moeda.
- Escopo das métricas: tarefas operacionais da semana atual; conclusão usa apenas encerradas; aprovações mostram a situação atual. Percentual de respostas em até dois minutos inclui espera por aprovação. Investimento corresponde à janela de sete dias da coleta, não necessariamente aos sete dias anteriores ao acesso.
- Validação: TypeScript e build passaram; inspeção visual autenticada ainda pendente. Sem alteração de banco ou da coleta. A ampliação dos KPIs de tráfego permanece na etapa 2.

## Mudanças principais

| Área | O que mudou |
|---|---|
| Banco | Migrado do SQLite local para o Supabase (projeto Agent Maia). `store.ts` agora é assíncrono. |
| Banco | Migrações `maia_schema_v1`, `maia_record_group_activity_fn`, `maia_people_permissions_v1` e revogação de `rls_auto_enable()` para anon e authenticated. |
| Webhook | Rota `api/webhook.ts` na Vercel: confere o token, faz a triagem (`server/inbox.ts`) e grava na fila `inbox`. |
| Worker | `server/inboxWorker.ts` (`pnpm worker`): lê a fila, processa com as mesmas regras do webhook local e marca o resultado. |
| Comandos do dono | `server/ownerRouter.ts`: criar grupo, tarefa, conversa e áudio, usado pelo webhook local e pelo worker. |
| Painel | Login por e-mail e senha (`AuthGate.tsx`), com tela de definir senha para convite e recuperação. |
| Pessoas | Página Pessoas: cadastrar pessoas, vários números por pessoa e permissões. Só o proprietário altera (RLS no banco). |
| Painel na Vercel | `api/snapshot.ts`: monta o painel a partir do Supabase, só para o proprietário logado (`is_owner`). |
| Launcher | Grava logs em `logs/` (webhook, painel, túnel e eventos do launcher). Abre a Vercel ao iniciar. |
| Números | Dono: EVOLUTION_OWNER_NUMBER. Aprovador: EVOLUTION_APPROVER_NUMBER. Trocados no Supabase, no `.env` local e no CLAUDE.md. |
| Grupos | Painel de grupos, atividade sem texto e criação de grupo com aprovação (criação ainda não testada de verdade). |
| Áudio | Download do áudio do dono pela Evolution. Transcrição ainda sem provedor escolhido. |

## Erros e correções

### Login e convite
- **Painel entrava direto pelo link do convite, sem pedir senha.** O Supabase apaga o token da URL antes da tela checar. Correção: o tipo do link (`invite` ou `recovery`) é lido antes do cliente iniciar (`arrivedFromAuthLink`).
- **Link do e-mail abria `localhost:3000`.** O Site URL do Supabase ainda aponta para o computador. Pendente: trocar para a URL da Vercel em Authentication → URL Configuration.
- **Cadastro público ainda aberto.** Pendente: desligar em Authentication.
- **Senha do proprietário:** definida pela API de administração, gravada no `.env` do projeto. A cópia no OneDrive sumiu depois de uma sincronização.

### Vercel: variáveis
- **Nome com caractere inválido ou "Produção" no campo Key.** Causa: texto colado no campo errado. Correção: digitar só o nome, com `VITE_` quando for para o painel.
- **Variável com `VITE_` pedia aviso de exposição.** Os dois valores (URL e chave pública) são feitos para o navegador. Correção: tipo Configuração.
- **Webhook respondia 401.** Causa: `EVOLUTION_WEBHOOK_SECRET` com texto de comentário colado junto. Correção: cadastrar só o valor.
- **Webhook respondia 500 (`storage_failed`) e o painel não montava.** Causa: faltava `SUPABASE_URL` na Vercel (só existia `VITE_SUPABASE_URL`). Correção: cadastrada pela API.
- **Aprovador não era reconhecido.** Causa: `EVOLUTION_APPROVER_NUMBER` não estava cadastrada. Correção: cadastrada pela API.
- **Redeploy necessário** depois de cada alteração de variável. Feito pela API, e o deploy ficou READY.

### Vercel: painel
- **Painel publicado mostrava "Painel local respondeu HTTP 404".** As rotas `/api/snapshot`, `/api/conversa` e `/api/refresh` só existiam no computador. Correção: modo `VITE_MAIA_HOSTED` (depois removido) e a rota `api/snapshot.ts` com checagem de proprietário.
- **Mensagem técnica de erro.** Trocada por texto neutro: "Ainda sem dados para esta tela".
- **Página Conversa com a Maia ainda dá 404 na Vercel.** Pendente: depende do worker e de uma rota de envio pelo painel.

### Git e GitHub
- **Push por SSH negado.** A chave deste PC não está autorizada no GitHub. Correção: push por HTTPS com o token da conta TrafegoWorki1, sem gravar o token no repositório.
- **`.gitignore` com `data/` bloqueava `src/data/`.** Correção: regra trocada para `/data/`.

### Supabase
- **Projeto da Maia não aparecia na conta conectada.** Ele está em outra organização. Acesso feito pelo ID do projeto.
- **Advisor apontou `rls_auto_enable()` executável por anon e authenticated.** Correção: `EXECUTE` revogado.
- **Avisos "RLS sem política"** são intencionais: só a service role acessa.

### Launcher e processos
- **Quedas sem registro.** Causa não confirmada. Correção: logs em `logs/`. Ainda falta observar uma queda real para confirmar a causa.
- **Launcher abria `localhost:3000` sozinho.** Correção: abre a URL da Vercel.

### Código
- **Testes de banco dependiam do SQLite em memória.** 15 casos removidos, porque não há banco de teste. Restaram 41 testes de lógica pura.
- **Conversa com a Maia no painel da Vercel** ainda não funciona (ver pendências).

## Atualização (mesmo dia, depois da primeira versão)

### Mudanças
| Área | O que mudou |
|---|---|
| Números | Dono: EVOLUTION_OWNER_NUMBER (conversa com a Maia). Aprovador: EVOLUTION_APPROVER_NUMBER (SIM/NÃO). Trocados no Supabase, no `.env` local e no CLAUDE.md. |
| Launcher | Ao iniciar, abre `https://agent-maia.vercel.app` em vez de `localhost:3000`. |
| Painel na Vercel | `api/snapshot.ts`: monta o painel a partir do Supabase, só para o proprietário (`is_owner`). O painel envia o login da sessão. |
| Arte | `server/imagegen.ts` e `server/maiaImageTool.ts`: a Maia cria artes com o Codex CLI, em processo separado, só para o dono. Ferramenta `mcp__maia__gerar_imagem`. Envio pelo WhatsApp com `sendOwnerImage`. |
| Jev (TypeSafe) | `server/jev.ts`: triagem em modo sombra das mensagens do dono, nos canais WhatsApp e painel. Não altera respostas. Tabela `jev_triage` (sem texto). Bloco "Triagem Jev (modo sombra)" no Resumo. |
| Dependências | `zod@4.6.5` declarado diretamente (versão já usada pelo Agent SDK). |

### Erros e correções
- **Vercel: `/api/snapshot` e `/api/webhook` falhavam (`config_missing`, `storage_failed`).** Causa: faltavam `SUPABASE_URL` e `EVOLUTION_APPROVER_NUMBER` na Vercel (só existia `VITE_SUPABASE_URL`). Correção: variáveis cadastradas pela API da Vercel e redeploy feito pela API. Deploy ficou READY.
- **Aprovador não reconhecido pelo webhook da Vercel.** Causa: `EVOLUTION_APPROVER_NUMBER` ausente. Correção: cadastrada.
- **Painel mostrava o número do dono antigo.** Causa: a página Pessoas lê o banco, não a variável da Vercel. Correção: números trocados na tabela `person_numbers`.
- **Jev devolvia probabilidades, não sim/não.** Causa: o código esperava booleanos para manipulação. Correção: campos viraram probabilidade (0 a 1), coluna migrada, alerta a partir de 50%.
- **Aviso `DEP0190` do Node ao gerar arte.** O Codex é um `.cmd` no Windows e precisa de shell. Os argumentos são fixos e validados. Aviso aceito, sem correção.
- **Erro 404 com a mensagem "Confirme que a Maia está rodando".** Trocado por texto neutro nas telas sem dados.

### Verificado
- Arte real gerada com o Codex em 84 segundos (conferida visualmente).
- Chamada real à API do Jev (categoria, confiança e probabilidades devolvidas).
- Rota do painel na Vercel: sem login 401, token inválido 403, proprietário 200.
- Webhook da Vercel: token aceito, gravação na fila e remoção do teste.
- 46 testes passando.

### Atualização (base de conhecimento com RAG)

### Mudanças
| Área | O que mudou |
|---|---|
| Banco | Extensão vector, tabelas knowledge_sources e knowledge_chunks, função search_knowledge (busca híbrida). RLS ligado. |
| Função embed | Edge Function no Supabase com o modelo gte-small. Sem provedor externo. |
| Agente | Ferramenta buscar_conhecimento (só leitura), com a fonte de cada trecho. |
| Documentos | CLAUDE.md, docs/erros-e-mudancas.md e plan.md: 39 trechos indexados. |

### Erros e correções
- **Busca por palavra-chave exigia todas as palavras.** Causa: websearch_to_tsquery usa E entre os termos. Correção: termos combinados com OU.
- **Parágrafo longo passava do tamanho do trecho.** Causa: o divisor não cortava parágrafos maiores que o limite. Correção: corte nos espaços, com teste.
- **Comandos com aspas quebraram a edição por script.** Causa: escape de aspas e de quebras de linha. Correção: edição direta do arquivo.

### Verificado
- Função embed respondeu com 384 valores.
- Indexação dos três documentos e buscas em português (4 de 4 com o documento certo entre os dois primeiros).
- 54 testes passando. Advisor de segurança: só avisos informativos e a proteção contra senhas vazadas desligada.

### Pendências
1. Reiniciar a Maia no PC para carregar a ferramenta de busca.
2. Proteção contra senhas vazadas: não disponível no plano atual (HTTP 402). Risco aceito pelo owner, com senha forte no painel. Reavaliar se o plano mudar.
3. Decidir se o modelo gte-small basta ou se vale um modelo multilíngue externo.
4. Indexar mais documentos quando você aprovar.

## Atualização (atualização automática da base)

### Mudanças
| Área | O que mudou |
|---|---|
| Base de conhecimento | Sincronização automática ao iniciar e a cada hora, só nos documentos que mudaram. |

### Verificado
- Duas sincronizações seguidas: a primeira atualizou dois documentos, a segunda não mudou nada. 57 testes.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (aprovações persistidas)

### Mudanças
| Área | O que mudou |
|---|---|
| Aprovações | Persistidas no banco, com número, prazo e processo. SIM ou NÃO com número. |
| Grupos | Criação de grupo passa pelo mesmo caminho de aprovação. |

### Erros e correções
- **Aprovação se perdia quando a Maia reiniciava.** Causa: o pedido ficava na memória do processo. Correção: pedido gravado no banco, com prazo.
- **SIM podia cair em outro pedido.** Causa: uma única aprovação aberta por vez, sem número. Correção: número obrigatório quando há mais de um pedido aberto.
- **Resposta chegando por outro processo não era aplicada.** Causa: o pedido só era resolvido no processo que o criou. Correção: a espera lê o banco.
- **Ação poderia ser executada depois de um reinício.** Correção: o pedido guarda o processo que o espera; se ele não existe mais, nada é executado.

### Verificado
- 57 testes. Teste com o banco de produção, com limpeza.

### Pendências
1. Reiniciar a Maia no PC para carregar a mudança.

## Atualização (agrupamento de mensagens)

### Mudanças
| Área | O que mudou |
|---|---|
| Lotes | Mensagens seguidas do dono viram um pedido: pronto após 15 s de silêncio ou no máximo 60 s. Tabelas `message_batches` e `batch_items`, com funções atômicas no banco. |
| Despacho | `server/batching.ts`: laço compartilhado pelo webhook local e pelo worker. Reserva atômica de cada lote. |
| Worker | Não executa mais a Maia sem espera. O item da inbox só vira concluído depois de gravado no lote. |

### Erros e correções
- **Worker marcava o item como concluído antes de a Maia terminar.** Causa: `void routeOwnerText` sem espera. Correção: o texto entra no lote e o despacho é separado da leitura da fila.
- **Esperar a execução travaria o SIM do aprovador.** Causa: a Maia pode aguardar aprovação, e a fila ficaria parada. Correção: despacho em laço próprio, fora da leitura da fila.
- **Lote não despachava com janela zero.** Causa: o relógio do PC e o do banco diferiam por alguns décimos de segundo. Correção: o vencimento é decidido pela função `due_owner_batches`, com o relógio do banco.
- **Despacho marcava o lote como concluído sem checar erro.** Causa: a atualização do fim não tinha verificação. Correção: o erro agora é lançado e registrado.

### Verificado
- 51 testes (regras de vencimento e montagem do texto).
- Teste com o banco de produção: três mensagens viraram um lote com o texto na ordem certa, a repetição foi ignorada, e os dados de teste foram apagados.

### Pendências
1. Reiniciar a Maia no PC para usar o agrupamento.
2. Persistir as aprovações no banco (hoje ficam na memória do processo).
3. Incluir o áudio do dono no lote, depois da transcrição.
4. RAG: escolher o provedor de embeddings e os documentos iniciais. Depende de decisão sua.

## Atualização (regras no prompt da Maia)

### Mudanças
- O prompt de sistema inclui as regras em vigor (ver docs/regras-da-maia.md).

### Verificado
- Typecheck e testes passando.

### Pendências
1. Reiniciar a Maia no PC para carregar o novo prompt.

## Atualização (estilo de resposta da Maia)

### Mudanças
- Regra no prompt: resposta breve, sem listar capacidades sem pedido, sem citar conectores indisponíveis, com próximo passo.

### Pendências
1. Reiniciar a Maia no PC para carregar o prompt.

## Atualização (grupo operacional e envio a grupos)

### Decisões
- Envio a grupos: só com aprovação prévia (`SIM <número>`), por ação, a grupo validado pelo JID.
- Grupo Operacional Worki Digital: a ser criado pelo comando `criar grupo Operacional Worki Digital | EVOLUTION_OWNER_NUMBER`. O pedido autorizado dentro do grupo é só o EVOLUTION_OWNER_NUMBER, que já tem permissão. Outros participantes são ignorados e o texto deles não é guardado.
- Decidido: qualquer participante do grupo pode pedir consultas (Gmail, Meta Ads, Sheets, Agenda). Ações que alteram algo exigem SIM ou NÃO do owner (EVOLUTION_OWNER_NUMBER), no privado.
- Regra: toda resposta da Maia no grupo começa com o nome de quem pediu; pedidos de aprovação também mostram esse nome.

### Achados
- A instância `wt_yrxexuou6jwp` apareceu como desconectada numa consulta e conectada em outras. A queda foi intermitente. Um registro anterior dizia que estava desconectada; foi corrigido.

### Não implementado ainda
- Leitura e resposta dentro do grupo; envio de mensagem ao grupo; escalonamento automático.

### Pendências
1. Criar o grupo com o comando e aprovar o pedido.
2. Decidir o escopo de conectores dentro do grupo.
3. Implementar leitura e resposta no grupo, com a regra acima.

## Atualização (pedido de criar grupo em linguagem natural)

### Erros e correções
- A Maia dizia que não conseguia criar grupo e tentava usar o conector disparom. Causa: pedido fora do formato caía na conversa geral. Correção: o prompt manda entender o contexto, perguntar o que falta e explicar o comando de criação, sem usar conectores de WhatsApp.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (regras no banco e no painel)

### Mudanças
- Regras da Maia na tabela maia_rules, lidas pelo prompt e exibidas na página Regras da Maia.
- O prompt antigo fixo no código foi removido.

### Verificado
- 12 regras no banco, 12 ativas; o prompt vem do banco.

### Pendências
1. Reiniciar a Maia no PC.
2. Edição das regras pelo painel (próxima etapa).

## Atualização (objetivo e capacidades da Maia nas regras)

### Mudanças
- A regra 1 (Objetivo e capacidades) foi atualizada no banco: objetivo da operação, o que a Maia faz hoje e o que ainda não faz.
- Prospecção no WhatsApp e no Instagram constam como não disponíveis: não há integração de Instagram e a regra do projeto não permite contato comercial automático.

### Pendências
1. Reiniciar a Maia no PC para carregar a regra.

## Atualização (aviso ao Herickson)

### Mudanças
- Ferramenta avisar_dono e regra 7 atualizada: pedido que a Maia não faz vai ao privado do Herickson, com quem pediu.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (revisão das regras da Maia)

### Mudanças
- Regra 3 (Dados) e documento de regras corrigidos: falha de consulta fica registrada em Ocorrências; a Maia avisa o Herickson só quando pedem algo que ela não faz (ferramenta avisar_dono).
- Erro de português corrigido na regra de escrita e publicação.

### Verificado
- Ocorrências: falhas e tarefas incertas já aparecem no painel (snapshot de incidentes).

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (regras que faltavam no painel)

### Erros e correções
- Regras importantes do documento não estavam no banco, então não apareciam na página Regras. Causa: a tabela tinha só 12 regras-resumo. Correção: 10 regras incluídas, com o texto do documento. Total: 22 ativas.

### Pendências
1. Reiniciar a Maia no PC.
2. Confirmar que VITE_MAIA_HOSTED não está na Vercel.

## Atualização (contexto e respostas da Maia, pedido de grupo)

### Erros observados
- Na conversa de criar grupo, a Maia não entendeu "me coloca no grupo" (incluir o dono), pediu de novo o número do dono e respondeu com menu longo.
- A Maia disse que o dono aprovaria a criação. A regra é do aprovador (EVOLUTION_APPROVER_NUMBER).

### Correções
- Regra nova: número do dono (EVOLUTION_OWNER_NUMBER) usado sem perguntar de novo quando pedirem para incluir o dono.
- Regra nova: respostas com no máximo três linhas, sem menus, uma pergunta só.
- Regra de criar grupo: aprovação do aprovador, sem dizer que o dono aprova.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (dono também aprova)

### Achado
- O banco mostrava que o dono (EVOLUTION_OWNER_NUMBER) tem a permissão escrita.aprovar, mas o código só aceitava aprovação do número do aprovador (EVOLUTION_APPROVER_NUMBER). Um SIM do dono nunca aprovava nada.

### Correção
- Pedidos de aprovação vão para o dono e para o aprovador. Um SIM ou NÃO com número, de qualquer um dos dois, aprova ou recusa.
- Antes de virar comando, a mensagem do dono é checada como resposta de aprovação (webhook e worker).
- Regra de criar grupo atualizada no banco.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (aprovadores vêm do painel)

### Mudança
- Quem recebe e responde aos pedidos de aprovação é quem tem a permissão escrita.aprovar na página Pessoas (ativo e com número), e não números fixos do .env. O .env é só reserva se o banco não responder.
- Se o dono pede uma ação, ele mesmo revisa e aprova; a Maia executa.

### Verificado
- Lista de aprovadores lida do banco: dono e aprovador. Número desconhecido não aprova. 57 testes.

### Limite conhecido
- No caminho da Vercel (fila), a triagem ainda reconhece só o aprovador do .env como remetente de aprovação; o dono é reconhecido pelo caminho de mensagens do dono.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (webhook na Vercel e launcher com worker)

### Mudanças
- Webhook da Evolution apontando para a Vercel (/api/webhook), com o token.
- Worker assume os avisos automáticos (resumo diário, alertas de conexão e aprovação parada).
- Novo launcher scripts/start-worker.ts; Iniciar Maia.bat agora chama esse launcher.
- Sem túnel e sem registro automático do webhook.

### Erro observado
- Mensagem das 00:13 se perdeu: o webhook ainda apontava para o túnel do PC, cujo endereço tinha mudado. Causa: o launcher antigo registrava o túnel a cada início. Com a fila na Vercel, mensagem não se perde mais quando o PC está desligado.

### Verificado
- Teste ponta a ponta pela Vercel: fila, lote, resposta da Maia no WhatsApp.
- Registro na Evolution conferido (aponta para a Vercel, com token).

### Pendências
1. Fechar a janela antiga da Maia e abrir o Iniciar Maia.bat.
2. Mandar uma mensagem real do seu WhatsApp e confirmar a resposta.

## Atualização (pedido de grupo prometido e não criado)

### O que aconteceu
- Pedido "criar grupo Operacional Worki Digital e me coloca no grupo" recebeu uma confirmação de aprovação (SIM ou NÃO), mas nenhuma aprovação foi criada no banco. Nenhum grupo foi criado.
- "Colocar a Gessica" pediu o grupo de novo, sem dizer que a Maia não adiciona pessoas a grupos existentes.

### Causa
- Frase fora do formato criar grupo Nome | números não era reconhecida pelo roteador e ia para o agente.
- O agente não tem ferramenta para criar grupo. Ele escreveu uma confirmação que parecia ação, mas não existia o pedido de aprovação.
- Regex de intenção perdia a fronteira depois de "você" (letra acentuada), e uma barra invertida se perdeu numa edição; ambos corrigidos e testados.

### Correção
- Pedido natural de criar grupo é tratado no roteador (parseGroupIntent), sem o agente. Com "me coloca" ou "com você", o dono entra como participante e o pedido vira aprovação real (requestCreateGroup).
- Sem participantes, a Maia pede os números com um exemplo.
- "Colocar" pessoa em grupo existente: resposta fixa explicando que não é possível ainda.

### Verificado
- Testes de intenção (5 casos) e suíte completa: 62 passando.

### Pendências
1. Reiniciar a Maia (Iniciar Maia.bat).
2. Gessica (5585986139044) não está cadastrada em Pessoas; para adicionar a grupos, falta o recurso de incluir participante em grupo existente.

## Atualização (memória da conversa)

### O que aconteceu
- A Maia respondeu "não tenho o seu pedido anterior nesta conversa" logo depois de um pedido seu.

### Causa
- O agente roda cada pedido sozinho, sem histórico. As mensagens estavam no banco, mas não eram enviadas com o pedido.

### Correção
- Cada pedido do dono leva as mensagens recentes do dono e da Maia (últimos 30 minutos, até 8 linhas). Mensagens de terceiros nunca entram.
- A mensagem atual não se repete no contexto.

### Verificado
- 3 testes de contexto (ordem, sem repetição, janela e terceiros). Suíte: 65 passando.

### Pendências
1. Reiniciar a Maia (Iniciar Maia.bat).

## Atualização (Maia multi-IA)

### Mudanças
| Área | O que mudou |
|---|---|
| Roteador | server/ai/: configuração, classificador por regras, roteador, saúde dos provedores, fallback, métricas. |
| Fallback | Claude para Codex quando o Claude entra em cooldown por limite ou indisponibilidade; reconhece inclusive limite semanal. |
| Jev | Intenção, complexidade e risco, em modo sombra. |
| Arte | Rota direta ao Codex, com cota diária atômica (10 por dia). |
| Painel | Página Modelos e Roteamento. |

### Erros evitados por projeto
- Erro de autenticação ou permissão não dispara fallback (trocar de modelo não resolve e poderia contornar regra).
- Fallback não repete tarefa com efeito externo iniciado (evita mensagem ou alteração em dobro).
- Falha de geração devolve a cota; resultado incerto mantém a cota e não repete.

### Verificado de verdade
- Codex em texto, fallback com o Claude em limite forçado, arte direta com envio ao WhatsApp, métricas no banco. 97 testes.

### Atualização de 2026-10-09: Codex SDK e ponte de ferramentas
- O fallback foi ampliado para qualquer mensagem elegível depois que o Claude entra em cooldown; `weekly limit` e cumprimentos repetidos (`oii`) também são reconhecidos.
- O Codex agora roda pelo SDK oficial e tem uma ponte MCP local (`server/codexMaiaMcp.ts`) para as funções internas e para o banco: conhecimento, contatos, grupos/enquetes, artes, Instagram, imagem, agendamento e cadastro.
- A ponte reaplica permissões e aprovações. Os segredos permanecem no servidor; conectores exclusivos do Claude continuam indisponíveis ao Codex.
- Teste real: resposta do SDK e consulta `buscar_conhecimento` ao Supabase concluídos. O typecheck completo foi bloqueado por falta de memória/espaço neste PC.

### Pendências
1. Reiniciar a Maia no PC.
2. Decidir renderizador e identidade visual para o carrossel.
3. Decidir se o Jev passa a rotear (jev.activeRouting), depois de revisar a concordância.

## Atualização (Instagram pela Zernio)

### Mudanças
| Área | O que mudou |
|---|---|
| Integração | server/integrations/zernio.ts: contas, desempenho, artes recentes, envio de imagem e publicação. |
| Ferramentas | instagram_desempenho e artes_recentes (leitura); instagram_publicar (com aprovação por número). |
| Regras | Regra 1 atualizada e regra instagram nova, no banco. |

### Erro encontrado e corrigido
- Propriedade declarada no construtor da classe de erro (ZernioError). O Node em modo de remoção de tipos não executa essa sintaxe, então o worker não iniciaria, e os testes não pegaram porque usam outro compilador. Corrigido, e os módulos agora carregam em Node puro.

### Verificado de verdade
- Conta ativa, posts reais com métricas, upload de imagem com endereço público (200, PNG). 108 testes.

### Limitações
- A publicação não foi testada ao vivo. Mensagens diretas, comentários e prospecção não foram implementados.

### Pendências
1. Reiniciar a Maia no PC.
2. Decidir se a Maia pode ler a caixa de entrada do Instagram (conversas de terceiros).

## Atualização (proatividade)

### O que faltava
- Não havia instrução de proatividade para a Maia.
- O indicador Proatividade existia (15% da nota), mas sem dados: nenhum aviso gravava os eventos handoff e handoff_confirmed.

### Correção
- Regra proatividade no banco.
- Todo aviso automático agora é registrado e medido (enviado e entrega confirmada). Falha de entrega entra em Ocorrências.

### Verificado de verdade
- Antes: sem nota. Com 1 aviso entregue e 1 falho: 5 de 10. Depois da limpeza: sem nota de novo. 108 testes.

### Achado
- Precisão e conferência está em 0: há ações externas concluídas e nenhuma conferência registrada (task_verified). Falta decidir o que conta como conferência.

### Pendências
1. Reiniciar a Maia no PC.
2. Decidir o que conta como conferência para o indicador Precisão e conferência.

## Pendências (estado atual)

### Feito e confirmado
- Reinício da Maia, números da Vercel, Supabase (Site URL e cadastro público), Meta Ads reconectado, chave da Evolution trocada, token da Vercel revogado.
- Agrupamento, triagem do Jev, criação de grupo e busca na base testados.

### Ainda em aberto
1. Testar a arte pelo WhatsApp (envio de imagem, ainda não testado).
2. Reiniciar a Maia no PC para carregar a aprovação persistida e a sincronização automática da base.
3. Trocar o webhook da Evolution para a Vercel: depende do worker estar estável e do resumo diário e avisos saírem do webhook local.
4. Conversa com a Maia pela Vercel (rota de envio com checagem de proprietário).
5. Decidir se o texto do dono segue sendo enviado à TypeSafe para a triagem (hoje sim, em modo sombra).
6. Decidir se o modelo atual da base de conhecimento basta ou se vale um modelo multilíngue externo.
7. Áudio do dono no agrupamento e transcrição: sem provedor escolhido.
8. Proteção contra senhas vazadas do Supabase: não disponível no plano atual (risco aceito).
9. Quedas do launcher: observar a próxima e confirmar a causa pelos logs em `logs/`.

## Precisão e conferência (09/10/2026)
- **Problema:** indicador zerado. Havia `external_done` (feito) mas nada gravava `task_verified` (conferido), e nenhuma regra mandava conferir.
- **Correção:** regra `precisao_conferencia` no banco; conferência real em grupo (lista da instância), Instagram (status lido na Zernio) e arte (id da mensagem do WhatsApp). Detalhes no CHANGELOG.
- **Pendente:** reiniciar a Maia (`Iniciar Maia.bat`) para carregar o código novo.

## Grupos, aprovação e objetivo (09/10/2026)
- **Aprovação reduzida:** só publicar/postar, enviar mensagem, subir anúncio, apagar e convites de agenda (`server/approvalPolicy.ts`). Aprova-se com **OK** (SIM também vale).
- **Grupos:** texto com menção, enquete, leitura de enquete e agendamento (`server/groupTools.ts`, tabela `scheduled_actions`). Não testado ao vivo.
- **Erro: Maia não respondia no grupo.** Causa: o grupo nunca foi ligado ao agente (só contava atividade, sem texto). Correção: nos grupos de `maia_groups`, quando chamada pelo nome, ela responde no grupo com o nome de quem pediu. Grupos que ela cria entram sozinhos; grupo novo: "Maia, cadastra este grupo" dito pelo owner. Risco: identificação do participante (LID) ainda não validada ao vivo.
- **Erro: launcher ocupava a porta 3000** (conflito com o Bryan). Correção: o launcher sobe só o worker.
- **Objetivo da Maia** reescrito (banco e manual da página Operação).
- **WappTrack MCP:** o servidor recusou dois tokens (401). Integração não feita; aguardando token válido.
- **Pendente:** reiniciar a Maia; testar grupo, enquete e cadastro de grupo novo.

- **Erro: Maia não respondeu "Cria uma planilha…" no grupo (14:13).** Causa: o texto só entrava na fila com a palavra "Maia". Correção: vale também citar/mencionar a Maia e continuar a conversa da mesma pessoa em até 10 min; ela lembra as últimas falas do grupo.

- **Erro: Maia disse que não lê grupos e que não tinha acesso a planilhas.** Causas: regra velha `grupos_privacidade` no banco; privado sem contexto dos grupos; ela não procurou a ferramenta (ToolSearch) e nenhuma regra dizia que o Drive cria planilhas. Correção: regras `grupos_privacidade` e `conectores_ferramentas` + contexto dos grupos no privado.

## Permissões por pessoa e conversas (09/10/2026)
- Aprovação só para ação pública/de risco; o owner tem autonomia no resto. Permissões por membro checadas no código (`server/access.ts`).
- Memória dos grupos cadastrados (7 dias, com autoria), agenda de contatos automática, mensagem direta a contato com resposta repassada ao owner, cadastro de membro por comando.
- **Pendente:** reiniciar a Maia; testar mensagem direta, resposta de contato e reconhecimento do owner no grupo; avisar o grupo da retenção de 7 dias.

- **Erro: cadastro de membro (Max Hellen) falhou com people_role_check.** Causa: papel "membro" nao existe no CHECK (so proprietario, aprovador, equipe). Correcao: papel "equipe"; Max Hellen cadastrada no banco.

- **Erro: 500 em fetchAllGroups.** Causa: `rate-overlimit` do WhatsApp (consultas demais). Correção: grupos cadastrados resolvidos pelo banco, cache de 15 min, pausa de 10 min após o limite, conferência da criação pelo id da resposta.

## Migrações versionadas (09/10/2026)
- **Problema:** 16 de 18 migrações aplicadas no Supabase não tinham arquivo no GitHub. **Correção:** baseline exata recuperada do histórico do Supabase, validação do zero em banco temporário, guarda de PR, detecção de drift (somente leitura) e CI. Regra: toda mudança de banco = migração no mesmo PR, aplicada em produção com aprovação do owner antes do merge. Ver `docs/database-migrations.md` e `docs/database-audit-2026-10-09.md`.

## Transcrição de áudio (09/10/2026)
- Áudios do dono são transcritos pelo Whisper do owner (EasyPanel). Latência medida de 27 a 64 s; o servidor reinicia após chamadas pesadas. Código em `server/transcribe.ts`. Pendente: teste com áudio real e mídia (imagem, vídeo, documento).

## Mídia do WhatsApp (09/10/2026)
- Imagem, vídeo e documento do dono agora são entendidos pela Maia (`server/media.ts`). Exige a migração `20261009224229_maia_inbox_kind_media` (amplia `inbox.kind`), ainda não aplicada em produção. Leitura de arquivos pelo agente passou a ser limitada por papel (antes Read/Grep eram livres).

- Corrigido: o drift comparava o texto das funções com fim de linha CRLF (checkout no Windows) e acusava divergência falsa. Agora o hash ignora CR e há `.gitattributes` forçando LF nas migrações. Regra do banco `midia` (31) criada.
# Modos de acesso de membros

Complemento: a entrega privada persistida não guardava o solicitante, então uma resposta produzida antes da revogação ainda podia ser enviada após reinício. Agora guarda o vínculo e revalida papel, número e permissões imediatamente antes de cada parte. Respostas já aceitas pela Evolution não podem ser desfeitas.

O fluxo anterior carregava permissões uma vez por conversa privada e não distinguia concessão herdada de bloqueio individual. O fluxo novo relê o cadastro a cada chamada e após OK, registra modos por pessoa/capacidade e não usa memória do owner como fonte de autorização. O OK é específico para a operação e não vira concessão permanente. Compartilhamento externo do Drive permanece fora deste controle.
# Lembretes no mesmo horário

A tarefa com prazo já criava aviso automático, mas outro aviso manual podia ser agendado no mesmo instante. A migration de proteção impede a colisão sob bloqueio e a ferramenta retorna o aviso existente; horários diferentes continuam disponíveis. Typecheck, validação do banco, 692 testes de aplicação, 77 de banco e build passaram. O guard não encontrou origin/main. A simulação remota retornou 401 para o token; aplicação em produção e atualização do worker permanecem pendentes.

