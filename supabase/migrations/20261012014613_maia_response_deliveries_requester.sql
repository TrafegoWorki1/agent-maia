-- maia_response_deliveries_requester
-- O que muda e por quê: acrescenta response_deliveries.requester (jsonb, opcional), que o código de entrega de respostas
-- (server/responseDelivery.ts) grava para lembrar quem pediu e o escopo do grupo. A linha equivalente foi escrita na
-- migração 20261011185724_maia_client_groups_access.sql DEPOIS de ela já estar aplicada em produção, então a coluna nunca
-- chegou ao banco e a gravação da resposta falhava ("Could not find the 'requester' column of 'response_deliveries'").
-- Migração aplicada é imutável: esta migração nova corrige o banco; a linha editada na migração antiga deve voltar ao que foi aplicado.
-- É idempotente (if not exists): se a coluna já existir, não faz nada. Só adiciona uma coluna nula: compatível com o código antigo.
-- Código que depende desta migração: server/responseDelivery.ts.
-- Rollback (nova migração que desfaz, nunca edição desta): o código volta a não usar a coluna e, depois, ela pode ser removida.

alter table public.response_deliveries add column if not exists requester jsonb;
