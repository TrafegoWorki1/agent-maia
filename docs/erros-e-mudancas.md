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

## Pendências

1. Trocar o Site URL no Supabase para `https://agent-maia.vercel.app` e desligar o cadastro público.
2. Trocar o webhook da Evolution para a Vercel. Antes: worker rodando no PC (`pnpm worker`) e resumo diário e avisos movidos para o worker.
3. Conversa com a Maia pela Vercel (rota de envio com checagem de proprietário, e leitura da resposta pelo Supabase).
4. Reconectar o conector do Meta Ads no claude.ai (erro CONNECTION_CLOSED).
5. Trocar a chave da Evolution, que foi exposta no chat.
6. Testar a criação de grupo com um grupo de teste.
7. Escolher o provedor de transcrição de áudio (ou seguir sem).
8. Revogar o token da Vercel guardado no arquivo da Área de Trabalho, se não for mais usado.
