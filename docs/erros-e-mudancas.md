# Erros e mudanças: resumo da sessão de 08/10/2026

Resumo para consulta rápida. O histórico oficial continua no `CHANGELOG.md`.

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
