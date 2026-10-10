-- maia_instagram_media_policy_alignment
-- O que muda e por quê: alinhar as regras ativas aos novos formatos e operações Instagram já implementados.
-- Código que depende desta migração: server/maiaImageTool.ts, server/codexMaiaMcp.ts, config/maia-rules.json.
-- Rollback: restaurar os dois textos da versão 2026-10-10.1, somente se os valores atuais ainda forem os desta migração.

do $$
declare
  baseline_matched integer;
  target_matched integer;
begin
  select count(*) into baseline_matched
  from public.maia_rules r
  join (values
    ('instagram', 'Use instagram_desempenho para consultar métricas. Para publicar ou agendar uma imagem, confirme a conta, o conteúdo final e uma arte de data/arte escolhida com artes_recentes. Use instagram_publicar; a publicação depende da aprovação pelo fluxo numerado e da conferência do status na Zernio. Consultas, Direct e automações seguem as regras específicas abaixo, somente quando as ferramentas estiverem disponíveis no executor. Não siga pessoas, faça prospecção autônoma ou envie mensagens frias. Curtir ou seguir a conta não autoriza iniciar uma conversa.'),
    ('instagram_consultas', 'Use instagram_stories e instagram_stories_metricas para Stories ativos e suas métricas; instagram_musica_buscar e instagram_musica_detalhar para catálogo de áudio; instagram_seguidor_status para informação sobre seguidores; instagram_conversas_listar e instagram_conversa_mensagens para Direct. São consultas, sujeitas à disponibilidade, conta e permissões do executor. Busca de música pode exigir conexão por Facebook Login: relate o erro retornado, sem reconectar contas ou contratar planos por conta própria. Ter catálogo de música não significa que publicar Reels já esteja implementado.')
  ) as baseline(codigo, texto) on r.codigo = baseline.codigo and r.texto = baseline.texto;

  select count(*) into target_matched
  from public.maia_rules r
  join (values
    ('instagram', 'Use instagram_desempenho para consultar métricas. Para publicar ou agendar foto, carrossel, Reels ou Story, confirme o tipo, a conta, o conteúdo final e os arquivos de data/arte escolhidos com artes_recentes. Use instagram_publicar; a publicação depende de aprovação e conferência do status na Zernio. Use instagram_post_editar e instagram_post_cancelar somente para posts ainda não publicados; ambas as ações exigem aprovação e a Zernio recusa alterações que não suporta. Consultas, Direct e automações seguem as regras específicas abaixo, somente quando as ferramentas estiverem disponíveis no executor. Não siga pessoas, faça prospecção autônoma ou envie mensagens frias. Curtida ou seguida não autoriza iniciar uma conversa.'),
    ('instagram_consultas', 'Use instagram_stories e instagram_stories_metricas para Stories ativos e suas métricas; instagram_musica_buscar e instagram_musica_detalhar para catálogo de áudio; instagram_seguidor_status para informação sobre seguidores; instagram_conversas_listar e instagram_conversa_mensagens para Direct. São consultas, sujeitas à disponibilidade, conta e permissões do executor. A caixa de entrada e a gestão de automações são privadas do owner. Busca de música pode exigir conexão por Facebook Login: relate o erro retornado, sem reconectar contas ou contratar planos por conta própria.')
  ) as target(codigo, texto) on r.codigo = target.codigo and r.texto = target.texto;

  if target_matched = 2 then
    return;
  end if;
  if baseline_matched <> 2 then
    raise exception 'Alinhamento Instagram abortado: esperado baseline ou destino completo; baseline %, destino %', baseline_matched, target_matched;
  end if;

  update public.maia_rules as r
  set texto = target.texto_novo
  from (values
    ('instagram', 'Use instagram_desempenho para consultar métricas. Para publicar ou agendar foto, carrossel, Reels ou Story, confirme o tipo, a conta, o conteúdo final e os arquivos de data/arte escolhidos com artes_recentes. Use instagram_publicar; a publicação depende de aprovação e conferência do status na Zernio. Use instagram_post_editar e instagram_post_cancelar somente para posts ainda não publicados; ambas as ações exigem aprovação e a Zernio recusa alterações que não suporta. Consultas, Direct e automações seguem as regras específicas abaixo, somente quando as ferramentas estiverem disponíveis no executor. Não siga pessoas, faça prospecção autônoma ou envie mensagens frias. Curtida ou seguida não autoriza iniciar uma conversa.'),
    ('instagram_consultas', 'Use instagram_stories e instagram_stories_metricas para Stories ativos e suas métricas; instagram_musica_buscar e instagram_musica_detalhar para catálogo de áudio; instagram_seguidor_status para informação sobre seguidores; instagram_conversas_listar e instagram_conversa_mensagens para Direct. São consultas, sujeitas à disponibilidade, conta e permissões do executor. A caixa de entrada e a gestão de automações são privadas do owner. Busca de música pode exigir conexão por Facebook Login: relate o erro retornado, sem reconectar contas ou contratar planos por conta própria.')
  ) as target(codigo, texto_novo) where r.codigo = target.codigo;
end
$$;
