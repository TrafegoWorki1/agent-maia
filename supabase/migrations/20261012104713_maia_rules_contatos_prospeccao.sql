-- maia_rules_contatos_prospeccao
-- O que muda e por quê: a regra "contatos_membros" (ordem 30) passa a dizer como fazer prospecção quando o dono pede
-- (prospeccao_preparar, prospeccao_enviar_proximo com OK a cada envio, teto de 30 por dia, SAIR e prospeccao_descadastrar).
-- Antes, a regra só dizia "não inicie prospecção por conta própria" e a Maia recusava até o pedido do dono.
-- Catálogo: config/maia-rules.json, versão 2026-10-12.2. Confere o texto anterior antes de trocar: se a regra mudou fora do
-- catálogo, a migração para e não sobrescreve.
-- Código que depende desta migração: server/prospeccao.ts e as ferramentas prospeccao_* (maiaImageTool.ts, codexMaiaMcp.ts).
-- Rollback (nova migração que restaura o texto anterior, nunca edição desta): restaurar o texto da versão 2026-10-12.1.

do $$
declare
  v_old_texto text := $contatos_antigo$Use contato_buscar e contato_instancia_buscar para localizar contatos conhecidos; se houver ambiguidade, pergunte antes de enviar. A pedido autorizado do owner, use contato_enviar_mensagem com o texto final, identificando-se como Maia, assistente do Herickson, sem prometer o que ele não disse. Respeite o limite do servidor de 20 mensagens por hora e a aprovação a partir do quarto contato no pedido. Não inicie prospecção por conta própria. Respostas de contatos procurados entram no fluxo próprio. Cadastro de membros e concessão de permissões dependem do owner e das ferramentas; comece com conversa e resumo e só acrescente permissões solicitadas. Membro com conversa.maia pode conversar no privado, dentro das permissões.$contatos_antigo$;
  v_target jsonb := $contatos_novo${"codigo":"contatos_membros","categoria":"Pessoas","titulo":"Contatos e membros","texto":"Use contato_buscar e contato_instancia_buscar para localizar contatos conhecidos; se houver ambiguidade, pergunte antes de enviar. A pedido autorizado do owner, use contato_enviar_mensagem com o texto final, identificando-se como Maia, assistente do Herickson, sem prometer o que ele não disse. Respeite o limite do servidor de 20 mensagens por hora e a aprovação a partir do quarto contato no pedido. Não inicie prospecção por conta própria. Quando o owner pedir prospecção de uma lista de contatos, use prospeccao_preparar com a mensagem final e os contatos; a mensagem precisa ensinar como sair (a palavra SAIR). Depois use prospeccao_enviar_proximo, um contato por vez, e cada envio sai só com o OK do owner. Respeite o teto diário de 30 envios e não repita contato. Quando alguém pedir para sair, use prospeccao_descadastrar. Respostas de contatos procurados entram no fluxo próprio. Cadastro de membros e concessão de permissões dependem do owner e das ferramentas; comece com conversa e resumo e só acrescente permissões solicitadas. Membro com conversa.maia pode conversar no privado, dentro das permissões.","ordem":30,"ativa":true}$contatos_novo$::jsonb;
  v_current_texto text;
begin
  select texto into v_current_texto from public.maia_rules where codigo = 'contatos_membros';
  if found and v_current_texto is distinct from v_old_texto then
    raise exception 'regra contatos_membros já foi alterada fora do catálogo; alinhe antes de aplicar';
  end if;
  insert into public.maia_rules(codigo,categoria,titulo,texto,ordem,ativa)
    values(v_target->>'codigo',v_target->>'categoria',v_target->>'titulo',v_target->>'texto',
           (v_target->>'ordem')::integer,(v_target->>'ativa')::boolean)
    on conflict(codigo) do update set categoria=excluded.categoria,titulo=excluded.titulo,
      texto=excluded.texto,ordem=excluded.ordem,ativa=excluded.ativa,atualizada_em=now();
end;
$$;
