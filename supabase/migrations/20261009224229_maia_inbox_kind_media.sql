-- maia_inbox_kind_media
-- O que muda e por quê: a fila `inbox` passa a aceitar o tipo 'media' (imagem, vídeo e documento enviados pelo dono no WhatsApp).
-- Só AMPLIA os valores aceitos em inbox.kind; nenhuma linha existente é afetada e não há perda de dados.
-- Código que depende desta migração: server/inbox.ts (kind 'media'), server/inboxWorker.ts, server/ownerRouter.ts (handleOwnerMedia).
-- Rollback (nova migração, nunca edição desta): recolocar check (kind in ('text','audio','event')) depois de apagar ou converter as linhas 'media'.
-- destrutivo-aprovado: owner pediu leitura de mídia em 09/10/2026; só amplia os valores aceitos, sem perda de dados; aplicada em produção em 09/10/2026 com o OK do owner

alter table public.inbox drop constraint inbox_kind_check;
alter table public.inbox add constraint inbox_kind_check check (kind in ('text','audio','event','media'));
