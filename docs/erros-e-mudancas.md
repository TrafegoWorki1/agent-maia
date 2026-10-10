# Erros e mudanças: resumo da sessão de 08/10/2026

Resumo para consulta rápida. O histórico oficial continua no `CHANGELOG.md`.

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
| Números | Dono: 5585992494552. Aprovador: 5585998372658. Trocados no Supabase, no `.env` local e no CLAUDE.md. |
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
| Números | Dono: 5585992494552 (conversa com a Maia). Aprovador: 5585998372658 (SIM/NÃO). Trocados no Supabase, no `.env` local e no CLAUDE.md. |
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
- Grupo Operacional Worki Digital: a ser criado pelo comando `criar grupo Operacional Worki Digital | 5585992494552`. O pedido autorizado dentro do grupo é só o 5585992494552, que já tem permissão. Outros participantes são ignorados e o texto deles não é guardado.
- Decidido: qualquer participante do grupo pode pedir consultas (Gmail, Meta Ads, Sheets, Agenda). Ações que alteram algo exigem SIM ou NÃO do owner (5585992494552), no privado.
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
- A Maia disse que o dono aprovaria a criação. A regra é do aprovador (5585998372658).

### Correções
- Regra nova: número do dono (5585992494552) usado sem perguntar de novo quando pedirem para incluir o dono.
- Regra nova: respostas com no máximo três linhas, sem menus, uma pergunta só.
- Regra de criar grupo: aprovação do aprovador, sem dizer que o dono aprova.

### Pendências
1. Reiniciar a Maia no PC.

## Atualização (dono também aprova)

### Achado
- O banco mostrava que o dono (5585992494552) tem a permissão escrita.aprovar, mas o código só aceitava aprovação do número do aprovador (5585998372658). Um SIM do dono nunca aprovava nada.

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
