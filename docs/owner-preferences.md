# Preferências permanentes do owner

Este recurso permite ao owner registrar preferências sem editar SQL, o catálogo oficial de regras ou os controles de autorização. Ele se divide em proposta e ativação deliberada.

## Fluxo

1. O owner pede explicitamente que uma preferência passe a valer daqui para frente, por exemplo: “Daqui em diante, responda de forma breve” ou “Nunca crie arte sem um pedido direto meu”. Uma pergunta comum ou uma sugestão da Maia não autoriza a criação da proposta.
2. A Maia escolhe um escopo e propõe o texto. O servidor valida o escopo e grava uma proposta pendente, que **ainda não muda o comportamento**.
3. A Maia mostra o texto exato e o comando correspondente. O owner confirma por WhatsApp ou pelo painel autenticado com `CONFIRMAR PREFERENCIA <id>`. A confirmação só funciona para uma proposta pendente, válida por 10 minutos.
4. Para desistir, o owner pode usar `CANCELAR PREFERENCIA <id>`. Uma proposta expirada, cancelada ou já ativada não pode ser reutilizada.
5. A ativação ocorre atomicamente por uma RPC do servidor. Ela substitui a preferência ativa anterior do mesmo escopo e preserva o histórico.

## Escopos aceitos

- `resposta`: tom, concisão, idioma e formato da resposta.
- `sugestoes`: quando oferecer próximos passos.
- `restricao`: somente um limite explícito mais estrito, como “Nunca crie arte sem um pedido direto meu”. Não pode ampliar capacidades.

As preferências são lidas a cada execução e entram no prompt como instruções subordinadas à política aprovada. Elas não autorizam ações, não mudam permissões, aprovações, segurança ou ferramentas e não substituem `config/maia-rules.json` / `maia_rules`. Tentativas de alterar essas áreas são rejeitadas e devem seguir o processo de regras versionadas.

## Proteções técnicas

- A proposta persistente só pode ser iniciada pelo owner e quando a mensagem original pedir explicitamente que algo passe a valer no futuro.
- A IA não recebe SQL nem acesso de escrita genérico ao banco. A ferramenta do servidor só cria uma proposta limitada; a ativação exige o comando literal do owner.
- As tabelas têm RLS ativado e não concedem acesso a `anon` ou `authenticated`. A RPC de ativação é executável somente por `service_role`.
- A migração é aditiva e versionada: `supabase/migrations/20261011005800_maia_owner_preferences_v1.sql`.
- Regras do catálogo oficial, segurança, permissões, aprovações e retenção continuam no processo normal de revisão, migração e ativação.

## Situação de implantação

Código, testes e migração estão no repositório local. O Supabase de produção não foi alterado. Antes de usar o fluxo na operação, aplique a migração pelo workflow aprovado de migrações de produção, valide o schema e só então publique o código dependente, conforme `docs/database-migrations.md`.
