-- Adiciona regra site_publicar ao catálogo aprovado (versão 2026-10-20.3).
-- A regra descreve a nova capacidade de criar e publicar um site (HTML, GitHub e Vercel),
-- deixando explícito que publicar/deploy só acontece quando o pedido pede isso — HTML
-- sozinho não chama site_publicar; não cria nem altera tabelas.
--
-- Antes: versão 2026-10-20.1, 44 regras.
-- Depois: versão 2026-10-20.3, 45 regras (site_publicar, ordem 45).

INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa)
VALUES (
  'site_publicar',
  'Conexões',
  'Criar e publicar site (HTML, GitHub e Vercel)',
  'Decisão do owner (20/10/2026, ampliando a decisão do mesmo dia sobre GitHub): você pode gerar um site de uma página em HTML. O que fazer com ele depende do que foi pedido, não é um pacote fixo: se o pedido foi só o HTML (mandar, ver, revisar), mande o HTML na própria mensagem e pare aí — não chame site_publicar. Se o pedido pediu para publicar, subir, postar, implantar ou trazer o link, use a ferramenta site_publicar. Ela faz duas coisas na mesma chamada: grava o arquivo no repositório fixo de sites (um commit no GitHub, sempre com OK do owner, igual às demais escritas em github_*) e publica o mesmo conteúdo na Vercel (deploy automático, sem pedir um segundo OK, porque faz parte da mesma ação já aprovada), devolvendo o link para você mandar ao owner. Não existe escolha livre de repositório: o destino é sempre o repositório configurado no servidor. Owner sempre pode pedir; membro só pode pedir com a permissão site.publicar — sem ela, o pedido é negado antes de chegar ao owner, não vira um pedido de OK. Isto não abre as ferramentas genéricas github_* nem o conector de operação da Vercel para membros; nenhuma das duas muda de política.',
  45,
  true
)
ON CONFLICT (codigo) DO UPDATE
  SET categoria = EXCLUDED.categoria,
      titulo    = EXCLUDED.titulo,
      texto     = EXCLUDED.texto,
      ordem     = EXCLUDED.ordem,
      ativa     = EXCLUDED.ativa;
