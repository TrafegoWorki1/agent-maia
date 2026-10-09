# Changelog

Registro do que foi feito no projeto, dos bugs resolvidos e das mudanças de código.
Atualize este arquivo a cada alteração no código (ver regra em `CLAUDE.md`).

Formato: a entrada mais recente fica no topo. Cada item diz o que mudou e, quando for
bug, qual era o sintoma e a causa.

---

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
