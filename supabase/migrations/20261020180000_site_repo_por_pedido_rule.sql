-- Atualiza a regra site_publicar no catálogo aprovado (versão 2026-10-20.6).
-- Motivo: o repositório de sites deixa de ser fixo (MAIA_SITES_REPO) e passa a vir em cada pedido (dono/nome, privado).
-- Não cria nem altera tabelas.
-- Depende de maia_rules (20261020015717), da regra site_publicar (20261020150456) e da migração 20261020170000.
--
-- Antes: versão 2026-10-20.5, 46 regras (repositório fixo no servidor).
-- Depois: versão 2026-10-20.6, 46 regras (repositório por pedido).

INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa)
VALUES (
  'site_publicar',
  'Conexões',
  'Criar e publicar site (HTML, GitHub e Vercel)',
  'Decisão do owner (20/10/2026): você pode gerar um site de uma página em HTML e o caminho é escolhido pelo pedido, não é fixo. Se o pedido for só o HTML (mandar, ver, revisar), mande o HTML na própria mensagem e não use ferramenta. Se o pedido for subir no GitHub, use site_subir_github: grava sites/<nome>/index.html no repositório fixo de sites, como um commit, sempre com OK do owner, igual às demais escritas em github_*. Se o pedido for publicar na Vercel, use site_publicar_vercel: publica direto, sem commit novo; usa o HTML do pedido ou, se não vier, o arquivo já salvo no repositório. Publicar não pede OK de novo, porque o owner já pediu. Se o pedido não disser o caminho (só GitHub, só Vercel ou as duas), pergunte antes de agir. O repositório é informado em cada pedido (dono/nome) e precisa ser privado; a ferramenta confere isso no GitHub antes de gravar ou ler. Se o owner não disser qual, use o que ele indicou ou o que você acabou de criar com github_repo_criar; se não der para saber, pergunte. Owner sempre pode pedir; membro só com a permissão site.publicar, nos dois caminhos; sem ela, o pedido é negado antes de chegar ao owner, não vira pedido de OK. Isto não abre as ferramentas genéricas github_* nem o conector de operação da Vercel para membros.',
  45,
  true
)
ON CONFLICT (codigo) DO UPDATE
  SET categoria = EXCLUDED.categoria,
      titulo    = EXCLUDED.titulo,
      texto     = EXCLUDED.texto,
      ordem     = EXCLUDED.ordem,
      ativa     = EXCLUDED.ativa;
