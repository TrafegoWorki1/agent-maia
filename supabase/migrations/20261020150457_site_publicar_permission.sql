-- Nova permissão para a ferramenta site_publicar (decisão do owner, 20/10/2026).
-- Depende de permission_catalog (20261008222231_maia_people_permissions_v1.sql).
-- Não concede a ninguém: o owner concede pessoa a pessoa pelo fluxo já existente
-- (set_maia_member_access_mode / painel de permissões).
-- Rollback: nova migração que apaga a linha, depois de confirmar que ninguém a usa.

INSERT INTO public.permission_catalog (code, label, description)
VALUES (
  'site.publicar',
  'Publicar site (HTML) via GitHub/Vercel',
  'Permite pedir a criação e publicação de um site de uma página; o commit no GitHub ainda pede OK do owner a cada vez, e o deploy na Vercel acontece na mesma ação.'
)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      description = EXCLUDED.description;
