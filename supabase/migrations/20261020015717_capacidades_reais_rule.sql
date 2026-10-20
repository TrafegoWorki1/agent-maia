-- Adiciona regra capacidades_reais ao catálogo aprovado (versão 2026-10-19.1).
-- A regra instrui o agente a verificar o bloco de integrações externas antes
-- de afirmar acesso; não cria nem altera tabelas.
--
-- Antes: versão 2026-10-16.2, 40 regras.
-- Depois: versão 2026-10-19.1, 41 regras (capacidades_reais, ordem 41).
--
-- Aplicar ao banco:
--   INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa)
--   VALUES (
--     'capacidades_reais',
--     'Limites',
--     'Verificar capacidade antes de prometer',
--     'Antes de afirmar que pode executar uma ação que depende de Instagram, LinkedIn ou de uma integração do catálogo, verifique o bloco ''Integrações externas — estado atual'' do seu contexto. Se a integração aparecer como inativa, pausada ou com segredo ausente, informe que essa capacidade não está disponível agora e oriente o owner a verificar a configuração. Use listar_capacidades quando precisar de confirmação adicional. Não improvise um caminho alternativo nem afirme disponibilidade que o bloco contradiz.',
--     41,
--     true
--   )
--   ON CONFLICT (codigo) DO UPDATE
--     SET categoria = EXCLUDED.categoria,
--         titulo    = EXCLUDED.titulo,
--         texto     = EXCLUDED.texto,
--         ordem     = EXCLUDED.ordem,
--         ativa     = EXCLUDED.ativa;

INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa)
VALUES (
  'capacidades_reais',
  'Limites',
  'Verificar capacidade antes de prometer',
  'Antes de afirmar que pode executar uma ação que depende de Instagram, LinkedIn ou de uma integração do catálogo, verifique o bloco ''Integrações externas — estado atual'' do seu contexto. Se a integração aparecer como inativa, pausada ou com segredo ausente, informe que essa capacidade não está disponível agora e oriente o owner a verificar a configuração. Use listar_capacidades quando precisar de confirmação adicional. Não improvise um caminho alternativo nem afirme disponibilidade que o bloco contradiz.',
  41,
  true
)
ON CONFLICT (codigo) DO UPDATE
  SET categoria = EXCLUDED.categoria,
      titulo    = EXCLUDED.titulo,
      texto     = EXCLUDED.texto,
      ordem     = EXCLUDED.ordem,
      ativa     = EXCLUDED.ativa;
