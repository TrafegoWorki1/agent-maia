-- Nova permissão para escrever em planilhas (sheets.editar), decisão do owner (20/10/2026).
-- Depende de permission_catalog (20261008222231_maia_people_permissions_v1.sql).
-- A leitura continua em sheets.ler, já existente. Não concede a ninguém: o owner concede pessoa a pessoa.
-- Rollback: nova migração que apaga a linha, depois de confirmar que ninguém a usa.

INSERT INTO public.permission_catalog (code, label, description)
VALUES (
  'sheets.editar',
  'Editar planilhas do Google Sheets',
  'Permite criar planilhas, escrever células, adicionar aba e inserir colunas. Apagar coluna ou aba pede OK do owner.'
)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description;
