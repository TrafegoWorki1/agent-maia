-- maia_rules_collaborative_panel
-- O que muda e por quê:
-- Código que depende desta migração:
-- Rollback (nova migração que desfaz, nunca edição desta):
-- Se houver comando destrutivo, inclua a linha: -- destrutivo-aprovado: <quem aprovou e por quê>

-- maia_rules_collaborative_panel
-- Ativa no banco as regras do painel colaborativo e do fluxo de trabalho versionado.
-- Catálogo: config/maia-rules.json, versão 2026-10-16.1.
-- Rollback: migration compensatória restaurando os dois textos da versão 2026-10-15.1.
do $$
declare
 v_panel_old text := $old$O painel só mostra dados ao proprietário logado. A edição das regras não é feita pelo painel. O chat do painel mantém o bloqueio de escrita aplicado pelo seu fluxo; quando uma ação não for permitida nesse canal, oriente o owner a pedi-la pelo WhatsApp.$old$;
 v_panel_new text := $new$O painel identifica a pessoa pelo login vinculado ao cadastro real e mostra somente tarefas, equipes, clientes, projetos, revisões, aprovações, indicadores e financeiro abrangidos por suas permissões e seus escopos operacionais. Membro, coordenador, responsável por cliente, revisor, aprovador e financeiro não são administradores por causa da função. A edição das regras não é feita pelo painel. Revogação ou troca de escopo exige nova leitura do servidor; dados em cache não autorizam ação.$new$;
 v_tasks_old text := $old$Use tarefa_criar, tarefas_listar e tarefa_atualizar conforme a autorização do servidor. Estados: pendente, em_andamento e concluida. Concluir exige evidência do trabalho entregue, não apenas uma resposta da IA. Consulte a revisão antes de editar. Não invente responsável ou prazo.$old$;
 v_tasks_new text := $new$Use tarefa_criar, tarefas_listar e tarefa_atualizar conforme a identidade, permissão e escopo revalidados pelo servidor. O fluxo colaborativo admite pendente, em execução, revisão, aguardando aprovação, bloqueado, concluído e cancelado, sem apagar o histórico. Concluir exige evidência do trabalho entregue, não apenas uma resposta da IA. Aprovação de qualidade não autoriza publicação. Consulte a revisão antes de editar; concorrência exige recarregar. Identifique pessoa, equipe, cliente e projeto pelos cadastros reais, nunca por semelhança de nome. Separe fatos, hipóteses e recomendações ao explicar desvios.$new$;
 v_current text;
begin
 select texto into v_current from public.maia_rules where codigo='painel_acesso';
 if found and v_current is distinct from v_panel_old then raise exception 'regra painel_acesso divergiu; alinhe antes de aplicar'; end if;
 update public.maia_rules set texto=v_panel_new,atualizada_em=now() where codigo='painel_acesso';
 if not found then raise exception 'regra painel_acesso ausente'; end if;
 select texto into v_current from public.maia_rules where codigo='tarefas';
 if found and v_current is distinct from v_tasks_old then raise exception 'regra tarefas divergiu; alinhe antes de aplicar'; end if;
 update public.maia_rules set texto=v_tasks_new,atualizada_em=now() where codigo='tarefas';
 if not found then raise exception 'regra tarefas ausente'; end if;
end;
$$;
