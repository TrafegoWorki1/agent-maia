-- Estado efemero do OAuth iniciado no painel da Maia.
-- Tokens permanentes ficam criptografados em maia_secrets; esta tabela guarda apenas o
-- verificador PKCE criptografado e os dados necessarios para validar o callback.

create table public.maia_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  provider text not null check (provider = 'meta_ads'),
  verifier_enc text not null check (char_length(verifier_enc) between 20 and 4000),
  redirect_uri text not null check (char_length(redirect_uri) between 10 and 1000),
  client_id text,
  owner_person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes')
);

create index maia_oauth_states_expires_at_idx on public.maia_oauth_states(expires_at);

alter table public.maia_oauth_states enable row level security;
revoke all on public.maia_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.maia_oauth_states to service_role;
