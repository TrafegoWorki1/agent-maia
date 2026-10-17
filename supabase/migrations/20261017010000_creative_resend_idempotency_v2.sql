-- v2: índice para limpeza por vencimento; documenta estado transiente 'pending'.
-- 'pending' = envio em andamento (lock de concorrência); limpável após 1 h.
-- 'failed'  = falhou; idempotência expira em 48 h.
-- 'uncertain' e null (ok) = auditoria permanente.
--
-- Query de limpeza (executar via job externo):
--   DELETE FROM creative_resend_idempotency
--     WHERE result_ok = false AND state != 'uncertain'
--     AND created_at < now() - interval '48 hours';
-- Limpeza de locks órfãos (pending > 1h):
--   DELETE FROM creative_resend_idempotency
--     WHERE state = 'pending'
--     AND created_at < now() - interval '1 hour';

CREATE INDEX IF NOT EXISTS creative_resend_idempotency_cleanup_idx
  ON creative_resend_idempotency (created_at, result_ok);

COMMENT ON COLUMN creative_resend_idempotency.state IS
  'null = enviado ok; pending = em andamento (transiente, limpar >1h); uncertain = incerto (auditoria); failed = falhou (limpar >48h)';
