-- maia_secrets_vault
-- O que muda e por quê: cofre de segredos das integrações (pedido do owner, 12/10/2026). O dono manda no PRIVADO da Maia
-- `cofre NOME | valor`; o worker intercepta antes da IA e do histórico e guarda o valor CRIPTOGRAFADO (AES-256-GCM) aqui.
-- A chave de criptografia existe só no .env do servidor (INTEGRACAO_VAULT_KEY); sem ela, nada é lido nem gravado. Só nomes
-- INTEGRACAO_* entram; as chaves da Evolution e da Zernio continuam só no .env. O valor nunca aparece em log, resposta ou tela.
-- Código que depende desta migração: server/vault.ts, server/integrationCatalog.ts, server/inboxWorker.ts.
-- Rollback (nova migração que desfaz, nunca edição desta): desativar o cofre no código e, depois, remover a tabela.
-- Só adiciona uma tabela: compatível com o código antigo. RLS ligada e acesso só pelo servidor (service_role).

create table public.maia_secrets (
  name text primary key check (name ~ '^INTEGRACAO_[A-Z0-9_]{2,50}$'),
  value_enc text not null check (char_length(value_enc) between 20 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.maia_secrets enable row level security;
revoke all on public.maia_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.maia_secrets to service_role;
