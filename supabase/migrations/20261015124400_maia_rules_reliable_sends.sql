-- maia_rules_reliable_sends
-- O que muda e por quê: aceite, entrega e leitura ficam claramente diferenciados; reenvio exato ao mesmo destino em 24 h exige OK explícito.
-- Catálogo: config/maia-rules.json, versão 2026-10-15.1. A migration para se o texto remoto divergir da versão anterior.
-- Rollback (nova migration): restaurar o texto da versão 2026-10-13.1.
do $$
declare
  v_old_texto text := $old$Antes de confirmar uma ação, use a evidência retornada pela ferramenta e, quando disponível, a leitura do estado na fonte. Grupo criado deve aparecer na lista; posts de Instagram e LinkedIn dependem do status lido na Zernio. Diferencie sucesso, falha, pedido aceito e resultado incerto, inclusive por participante nas ações em grupo. Não atribua leitura ou resposta ao destinatário sem evidência. Se não for possível conferir o resultado, informe a pendência concreta. Não invente números ou datas.$old$;
  v_target jsonb := $target${"codigo":"precisao_conferencia","categoria":"Conduta","titulo":"Precisão e conferência","texto":"Antes de confirmar uma ação, use a evidência retornada pela ferramenta e, quando disponível, a leitura do estado na fonte. Grupo criado deve aparecer na lista; posts de Instagram e LinkedIn dependem do status lido na Zernio. Diferencie sucesso, falha, pedido aceito e resultado incerto, inclusive por participante nas ações em grupo. Um aceite da Evolution confirma somente que o serviço aceitou o envio; não afirme entrega, leitura ou resposta sem recibo correspondente. Se não for possível conferir o resultado, informe a pendência concreta. Não repita um envio quando o resultado estiver incerto. Antes de repetir texto idêntico ao mesmo contato ou grupo dentro de 24 horas, o backend deve pedir OK explícito do owner; não tente contornar esse bloqueio mudando pontuação ou usando outra ferramenta. Para pedidos apenas parecidos, confira o histórico e esclareça a intenção se houver risco de duplicação. Não invente números ou datas.","ordem":27,"ativa":true}$target$::jsonb;
  v_current_texto text;
begin
  select texto into v_current_texto from public.maia_rules where codigo = 'precisao_conferencia';
  if found and v_current_texto is distinct from v_old_texto then
    raise exception 'regra precisao_conferencia já foi alterada fora do catálogo; alinhe antes de aplicar';
  end if;
  insert into public.maia_rules(codigo,categoria,titulo,texto,ordem,ativa)
    values(v_target->>'codigo',v_target->>'categoria',v_target->>'titulo',v_target->>'texto',
           (v_target->>'ordem')::integer,(v_target->>'ativa')::boolean)
    on conflict(codigo) do update set categoria=excluded.categoria,titulo=excluded.titulo,
      texto=excluded.texto,ordem=excluded.ordem,ativa=excluded.ativa,atualizada_em=now();
end;
$$;
