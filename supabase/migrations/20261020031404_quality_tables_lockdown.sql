-- Fecha o acesso de anon/authenticated a maia_incidents e maia_error_patterns.
-- Antes: políticas USING (true) sem REVOKE; qualquer chave pública podia ler e alterar.
-- Depois: só o service role (worker) acessa; RLS segue habilitado sem políticas.

-- destrutivo-aprovado: owner autorizou em 2026-10-20 ("Então faça"); remove políticas USING (true) que expunham as tabelas a anon/authenticated.
DROP POLICY IF EXISTS "owner_all_incidents" ON maia_incidents;
DROP POLICY IF EXISTS "owner_all_error_patterns" ON maia_error_patterns;

REVOKE ALL ON maia_incidents, maia_error_patterns FROM anon, authenticated;
