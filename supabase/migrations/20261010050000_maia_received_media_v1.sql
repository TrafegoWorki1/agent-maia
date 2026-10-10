-- Decisão do owner (2026-10-09/10): a Maia entende áudio/imagem/vídeo/documento de membros e contatos autorizados
-- (não só do dono), com retenção de 7 dias para o arquivo em disco. Esta tabela guarda só os METADADOS do arquivo
-- (quem mandou, tipo, nome, legenda e o caminho local) para o owner poder pedir "me manda esse arquivo" depois.
-- Código: server/receivedMedia.ts, server/ownerRouter.ts (handleMemberMedia), ferramenta mcp__maia__arquivo_reenviar.
-- Mudança aditiva. Rollback: drop table public.received_media (sem impacto em outras tabelas).
create table public.received_media (
  id bigint generated always as identity primary key,
  conv text not null,
  from_number text not null default '',
  from_name text not null default '',
  media_type text not null check (media_type in ('image', 'video', 'document')),
  file_name text not null default '',
  caption text not null default '',
  path text not null,
  mimetype text not null default '',
  received_at timestamptz not null default now()
);
create index received_media_conv_idx on public.received_media (conv, received_at desc);
alter table public.received_media enable row level security;
