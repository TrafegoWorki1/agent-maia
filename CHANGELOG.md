# Changelog

Registro do que foi feito no projeto, dos bugs resolvidos e das mudanças de código.
Atualize este arquivo a cada alteração no código (ver regra em `CLAUDE.md`).

Formato: a entrada mais recente fica no topo. Cada item diz o que mudou e, quando for
bug, qual era o sintoma e a causa.

---

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
- **Dono:** 5585992494552 (conversa com a Maia). **Aprovador:** 5585998372658 (SIM/NÃO das ações de escrita).
- Trocados: tabela `person_numbers` no Supabase (página Pessoas), `.env` local e CLAUDE.md.
- **Pendente:** na Vercel, ajustar `EVOLUTION_OWNER_NUMBER` = 5585992494552 e `EVOLUTION_APPROVER_NUMBER` = 5585998372658, e fazer Redeploy.

### Alterado (configuração de autenticação do Supabase)
- Site URL trocado para https://agent-maia.vercel.app (links de convite e recuperação agora abrem o painel da Vercel).
- Endereços permitidos: a Vercel e o localhost:3000 (para testes locais).
- Cadastro público desligado. O proprietário continua entrando, e convites feitos pelo administrador continuam funcionando.
- Feito pela API de gestão do Supabase, com o token guardado no .env. Login do proprietário confirmado depois da mudança.

### Decidido (envio a grupos com aprovação)
- Regra no CLAUDE.md: envio a grupos só com `SIM <número>` do aprovador, por ação, a grupo validado pelo JID. Nada foi implementado ainda.
- Pendente: JID do grupo Operacional Worki Digital; decisão sobre o escalonamento automático.
- Achado: a instância `wt_yrxexuou6jwp` apareceu com estado `close` numa consulta e `open` em outras, com o perfil "Herickson Maia". Ou seja, a queda foi intermitente, não permanente. Confirmado `open` no fim da sessão.
- Grupo operacional: o pedido autorizado dentro do grupo é o 5585992494552. Criar o grupo passa pela aprovação. Pendente: escopo de conectores dentro do grupo.

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
  dígito (`558592494552`), e o `.env` tem com ele (`5585992494552`). Correção: `samePhone`
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
- Testar ponta a ponta: mensagem pelo número da conversa (5585998372658) e aprovação pelo
  aprovador (5585992494552).
- Atalho na área de trabalho: o Windows bloqueou a gravação em `Desktop`. Criar manualmente a
  partir de `Iniciar Maia.bat`.
- Script `dev` usa `--host 0.0.0.0`, o que expõe o app na rede local. O launcher usa só
  `127.0.0.1`. Decidir se o `dev` também deve mudar.
- A URL do túnel Cloudflare muda a cada execução: o launcher re-registra o webhook, mas um túnel
  iniciado fora dele exige novo `--apply`.
