-- Tabelas para Quality Audit, Self-Correction e Aprendizado com erros.
-- Antes: sem tabelas de incidentes ou padrões de falha.
-- Depois: maia_incidents (registro de erros/incertezas) e maia_error_patterns (padrões aprovados).

-- -----------------------------------------------------------------------
-- maia_incidents
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maia_incidents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  tipo          text        NOT NULL CHECK (tipo IN ('execution_error', 'missing_proof', 'uncertain_result')),
  ferramenta    text,
  descricao     text        NOT NULL,
  contexto      jsonb       NOT NULL DEFAULT '{}',
  status        text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  correcao_proposta text,
  resolved_at   timestamptz,
  resolved_by   text
);

ALTER TABLE maia_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_incidents" ON maia_incidents
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_maia_incidents_status     ON maia_incidents (status);
CREATE INDEX idx_maia_incidents_created_at ON maia_incidents (created_at DESC);
CREATE INDEX idx_maia_incidents_tipo       ON maia_incidents (tipo);

-- -----------------------------------------------------------------------
-- maia_error_patterns
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maia_error_patterns (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  codigo            text        NOT NULL UNIQUE,
  descricao         text        NOT NULL,
  regra_prevencao   text        NOT NULL,
  aprovado_em       timestamptz,
  ativa             boolean     NOT NULL DEFAULT false,
  incident_id       uuid        REFERENCES maia_incidents (id) ON DELETE SET NULL
);

ALTER TABLE maia_error_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_all_error_patterns" ON maia_error_patterns
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_maia_error_patterns_ativa  ON maia_error_patterns (ativa);
CREATE INDEX idx_maia_error_patterns_codigo ON maia_error_patterns (codigo);
