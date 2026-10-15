-- outbound_message_receipts
-- O que muda e por quê: registra apenas ID técnico, destino e estado aceito/entregue/lido,
-- sem guardar conteúdo de mensagens; permite reportar somente evidência recebida da Evolution.
-- Código que depende desta migração: server/outboundReceipts.ts, api/webhook.ts, server/inbox.ts e server/inboxWorker.ts.
-- Rollback (nova migração que desfaz, nunca edição desta): voltar o código consumidor e preservar recibos para auditoria.

create table public.outbound_receipts (
  message_id text primary key check (length(btrim(message_id)) between 1 and 300),
  recipient text,
  content_hash text check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('accepted','delivered','read','played','failed')),
  created_at timestamptz not null default now(),
  status_updated_at timestamptz not null default now()
);
comment on column public.outbound_receipts.content_hash is 'HMAC-SHA-256 do texto em NFC com EVOLUTION_API_KEY; nunca armazena texto claro.';
create index outbound_receipts_recipient_updated on public.outbound_receipts(recipient,status_updated_at desc);
create index outbound_receipts_dedupe on public.outbound_receipts(recipient,content_hash,created_at desc) where content_hash is not null;
alter table public.outbound_receipts enable row level security;
revoke all on public.outbound_receipts from public,anon,authenticated;
grant all on public.outbound_receipts to service_role;

create function public.record_outbound_receipt(p_message_id text,p_recipient text,p_status text,p_content_hash text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_status text := lower(btrim(p_status));
begin
  if p_message_id is null or length(btrim(p_message_id)) = 0 or length(p_message_id) > 300 then
    raise exception 'ID da mensagem inválido';
  end if;
  if v_status not in ('accepted','delivered','read','played','failed') then
    raise exception 'Estado de recibo inválido';
  end if;
  if p_content_hash is not null and p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Hash de conteúdo inválido';
  end if;
  insert into outbound_receipts(message_id,recipient,content_hash,status)
  values(btrim(p_message_id),nullif(btrim(p_recipient),''),p_content_hash,v_status)
  on conflict(message_id) do update set
    recipient = coalesce(nullif(btrim(excluded.recipient),''),outbound_receipts.recipient),
    content_hash = coalesce(excluded.content_hash,outbound_receipts.content_hash),
    status = case
      when (case outbound_receipts.status when 'failed' then 0 when 'accepted' then 1 when 'delivered' then 2 when 'read' then 3 when 'played' then 4 else -1 end)
         <= (case excluded.status when 'failed' then 0 when 'accepted' then 1 when 'delivered' then 2 when 'read' then 3 when 'played' then 4 else -1 end)
        then excluded.status
      else outbound_receipts.status
    end,
    status_updated_at = case
      when (case outbound_receipts.status when 'failed' then 0 when 'accepted' then 1 when 'delivered' then 2 when 'read' then 3 when 'played' then 4 else -1 end)
         < (case excluded.status when 'failed' then 0 when 'accepted' then 1 when 'delivered' then 2 when 'read' then 3 when 'played' then 4 else -1 end)
        then now()
      else outbound_receipts.status_updated_at
    end;
end;
$$;
revoke all on function public.record_outbound_receipt(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_outbound_receipt(text,text,text,text) to service_role;

create function public.purge_outbound_receipts()
returns integer language sql security invoker set search_path = public as $$
  with removed as (delete from public.outbound_receipts where created_at < now() - interval '30 days' returning 1)
  select count(*)::integer from removed;
$$;
revoke all on function public.purge_outbound_receipts() from public,anon,authenticated;
grant execute on function public.purge_outbound_receipts() to service_role;
