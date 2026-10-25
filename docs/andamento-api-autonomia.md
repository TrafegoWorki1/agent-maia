# Andamento — autonomia para APIs novas

Data: 24/10/2026

## Implementado

- A regra da Maia orienta a consultar o catálogo e pesquisar a documentação disponível quando o proprietário pedir uma API nova no privado.
- Operações são propostas como pendentes. O token não passa pela IA: o proprietário guarda com `cofre NOME | valor` no privado.
- A ativação exige OK do proprietário. Chamadas classificadas como externas continuam exigindo aprovação por uso.
- A ferramenta do Claude foi alinhada ao fluxo do cofre.
- Migração criada: `20261024003511_maia_api_autonomia_rule.sql`.

## Verificações

- `pnpm rules:check`: aprovado.
- `pnpm typecheck`: aprovado.
- A simulação `supabase db push --dry-run --linked` chegou ao Supabase, mas foi recusada com `Invalid access token`. Nenhuma migração foi aplicada.

## Publicação

- Branch enviada ao GitHub: `feat/api-autonomia`.
- Commit de implementação: `b6528a6`.
- PR não aberto: a API do GitHub recusou a conta conectada porque não é colaboradora do repositório.
- A migração deve ser aplicada antes de integrar o código. Para concluir, reautorizar o Supabase e conectar uma conta colaboradora do GitHub; então abrir o PR, aplicar a migração pelo fluxo protegido e concluir a publicação.

## Limite conhecido

A Maia pesquisa com WebSearch quando disponível. Se a documentação encontrada não confirmar endpoint ou autenticação, ela deve pedir o link ou os trechos necessários. O token deve ser enviado somente no privado da Maia pelo comando do cofre.
