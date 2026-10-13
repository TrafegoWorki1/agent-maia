-- received_media_storage_url
-- O que muda e por quê: adiciona coluna storage_url (nullable) em received_media para guardar
-- a URL do arquivo no bucket Supabase Storage (midia-recebida). O path local continua salvo para
-- compatibilidade com arquivo_reenviar; storage_url é a cópia durável que sobrevive a reinicializações
-- do worker. Nula quando o upload falha (o arquivo continua só no disco local nesses casos).

alter table public.received_media
  add column if not exists storage_url text;
