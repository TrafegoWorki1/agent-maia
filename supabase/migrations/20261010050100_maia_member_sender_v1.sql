-- Decisão do owner (2026-10-09/10): membro cadastrado (permissão conversa.maia) fala com a Maia no privado.
-- Amplia os valores aceitos em events.sender e inbox.sender para incluir 'member'. Só amplia; nenhuma linha
-- existente muda e nenhum dado é perdido. Código: server/inbox.ts, server/inboxWorker.ts, api/webhook.ts.
-- Rollback: nova migração que remove 'member' do CHECK, depois de não haver mais linhas com esse valor.
alter table public.events drop constraint events_sender_check;
alter table public.events add constraint events_sender_check check (sender in ('owner', 'approver', 'other', 'none', 'group', 'member'));

alter table public.inbox drop constraint inbox_sender_check;
alter table public.inbox add constraint inbox_sender_check check (sender in ('owner', 'approver', 'other', 'group', 'none', 'member'));
