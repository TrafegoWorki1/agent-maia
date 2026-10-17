-- Registra tentativas de reenvio de arte, garantindo que a mesma chave de
-- idempotência não dispare dois envios. Vinculado ao sistema creative_jobs.
-- Acesso: service_role only (mesma política das tabelas creative_jobs).

CREATE TABLE IF NOT EXISTS creative_resend_idempotency (
  key           text        PRIMARY KEY,
  item_id       integer     NOT NULL,
  owner_number  text        NOT NULL,
  result_ok     boolean     NOT NULL,
  message_id    text,
  state         text,        -- 'uncertain' | 'failed' quando result_ok = false
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE creative_resend_idempotency ENABLE ROW LEVEL SECURITY;

-- A policy usa auth.role() que só existe no Supabase. O bloco DO captura
-- undefined_function para não quebrar o banco local de testes.
DO $body$
BEGIN
  CREATE POLICY "service_role_only" ON creative_resend_idempotency
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION
  WHEN undefined_function THEN NULL; -- ambiente local sem auth schema
  WHEN duplicate_object  THEN NULL; -- idempotente em reaplicações
END
$body$;

-- Limpeza automática após 48 h (entradas velhas não bloqueiam novos pedidos)
COMMENT ON TABLE creative_resend_idempotency IS
  'Idempotência de reenvio de artes criativas. Entradas expiram logicamente após 48 h; limpeza via job externo.';
