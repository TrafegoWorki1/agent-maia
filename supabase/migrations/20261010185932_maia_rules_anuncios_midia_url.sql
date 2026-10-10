-- maia_rules_anuncios_midia_url
-- O que muda e por quê: adiciona a regra "anuncios_midia_url" (ordem 40) ao catálogo ativo em
-- produção, para a Maia saber usar anuncio_midia_url_temporaria antes de subir mídia no Meta Ads.
-- Código que depende desta migração: server/maiaImageTool.ts (anuncio_midia_url_temporaria),
-- server/integrations/adsMedia.ts, server/access.ts.
-- Rollback: nova migração que desativa (ativa=false) ou remove a regra "anuncios_midia_url".

do $$
declare
  v_target jsonb := $anuncios_rule$
    {"codigo":"anuncios_midia_url","categoria":"Anúncios","titulo":"Vídeo ou imagem do WhatsApp para Meta Ads","texto":"A ferramenta de upload do Meta Ads por URL exige um endereço https público e direto; não aceita caminho de arquivo local nem link do WhatsApp. Para uma imagem ou vídeo que o dono mandou, use primeiro anuncio_midia_url_temporaria (só o dono; gera um link assinado do Supabase, válido por 2 horas) e só depois chame a ferramenta de upload do Meta Ads com upload_source URL e esse link. O arquivo é apagado do Supabase pela limpeza periódica; não reaproveite o link depois de expirado. Isso prepara só o material; subir o criativo e qualquer ação de anúncio seguem as regras de aprovação já aplicadas pelas ferramentas de anúncio.","ordem":40,"ativa":true}
  $anuncios_rule$::jsonb;
  v_current jsonb;
begin
  select jsonb_build_object('codigo',codigo,'categoria',categoria,'titulo',titulo,'texto',texto,'ordem',ordem,'ativa',ativa)
    into v_current from public.maia_rules where codigo = v_target->>'codigo';
  if found and v_current <> v_target then
    raise exception 'regra % já existe com outro conteúdo; alinhe antes de aplicar', v_target->>'codigo';
  end if;
  insert into public.maia_rules(codigo,categoria,titulo,texto,ordem,ativa)
    values(v_target->>'codigo',v_target->>'categoria',v_target->>'titulo',v_target->>'texto',
           (v_target->>'ordem')::integer,(v_target->>'ativa')::boolean)
    on conflict(codigo) do update set categoria=excluded.categoria,titulo=excluded.titulo,
      texto=excluded.texto,ordem=excluded.ordem,ativa=excluded.ativa,atualizada_em=now();
end;
$$;
