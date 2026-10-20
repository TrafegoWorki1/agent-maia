-- Atualiza a regra site_publicar no catálogo aprovado (versão 2026-10-20.5).
-- Motivo: a ferramenta única site_publicar virou dois caminhos escolhidos pelo pedido do owner:
--   site_subir_github (commit, com OK) e site_publicar_vercel (deploy, sem OK). Não cria nem altera tabelas.
-- Depende de maia_rules (20261020015717) e da regra site_publicar (20261020150456), já aplicadas.
-- Depende também de google_sheets (20261020160445), que deve ser aplicada antes: ela leva a versão de .3 para .4.
--
-- Antes: versão 2026-10-20.4, 46 regras (site_publicar com a ferramenta única).
-- Depois: versão 2026-10-20.5, 46 regras (site_publicar com site_subir_github e site_publicar_vercel).

INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa)
VALUES (
  'site_publicar',
  'Conexões',
  'Criar e publicar site (HTML, GitHub e Vercel)',
  'Decisão do owner (20/10/2026): você pode gerar um site de uma página em HTML e o caminho é escolhido pelo pedido, não é fixo. Se o pedido for só o HTML (mandar, ver, revisar), mande o HTML na própria mensagem e não use ferramenta. Se o pedido for subir no GitHub, use site_subir_github: grava sites/<nome>/index.html no repositório fixo de sites, como um commit, sempre com OK do owner, igual às demais escritas em github_*. Se o pedido for publicar na Vercel, use site_publicar_vercel: publica direto, sem commit novo; usa o HTML do pedido ou, se não vier, o arquivo já salvo no repositório. Publicar não pede OK de novo, porque o owner já pediu. Se o pedido não disser o caminho (só GitHub, só Vercel ou as duas), pergunte antes de agir. Não existe escolha livre de repositório: o destino é o configurado no servidor. Owner sempre pode pedir; membro só com a permissão site.publicar, nos dois caminhos; sem ela, o pedido é negado antes de chegar ao owner, não vira pedido de OK. Isto não abre as ferramentas genéricas github_* nem o conector de operação da Vercel para membros.',
  45,
  true
)
ON CONFLICT (codigo) DO UPDATE
  SET categoria = EXCLUDED.categoria,
      titulo    = EXCLUDED.titulo,
      texto     = EXCLUDED.texto,
      ordem     = EXCLUDED.ordem,
      ativa     = EXCLUDED.ativa;
