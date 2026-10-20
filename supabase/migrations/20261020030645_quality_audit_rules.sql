-- Adiciona três regras de qualidade ao catálogo aprovado (versão 2026-10-20.1).
-- Antes: versão 2026-10-19.1, 41 regras.
-- Depois: versão 2026-10-20.1, 44 regras (quality_audit 42, auto_incidente 43, prevencao_padrao 44).

INSERT INTO maia_rules (codigo, categoria, titulo, texto, ordem, ativa) VALUES
(
  'quality_audit',
  'Conferência',
  'Verificar prova antes de confirmar resultado',
  'Antes de informar ao owner que uma ação foi concluída, verifique se o resultado contém prova real de execução: ID de mensagem para envios WhatsApp, URL ou mediaId para publicações Instagram/LinkedIn, fileId para operações no Drive. Se o resultado não trouxer essa prova, comunique o resultado como incerto (não como confirmado) e registre o incidente com registrar_incidente usando tipo missing_proof. Nunca declare execução concluída baseando-se apenas em ausência de erro.',
  42,
  true
),
(
  'auto_incidente',
  'Conferência',
  'Registrar incidente ao identificar erro ou incerteza',
  'Quando uma ferramenta retornar erro, quando o resultado for incerto ou quando você perceber que cometeu uma afirmação incorreta, use registrar_incidente antes de responder ao owner. Informe o tipo (execution_error, missing_proof ou uncertain_result), a ferramenta envolvida e uma descrição do que aconteceu. Se souber como evitar no futuro, inclua a correção proposta. Isso não substitui informar o owner; faça as duas coisas.',
  43,
  true
),
(
  'prevencao_padrao',
  'Limites',
  'Seguir padrões de prevenção aprovados',
  'Antes de executar ações que já geraram incidente registrado, consulte o bloco Padrões de falha conhecidos no seu contexto. Se existir um padrão com regra de prevenção para o tipo de ação que vai executar, siga essa regra antes de prosseguir. Se não existir padrão mas o incidente for recorrente, use propor_padrao_prevencao para sugerir uma regra ao owner. Padrões só entram em vigor após aprovação explícita do owner.',
  44,
  true
)
ON CONFLICT (codigo) DO UPDATE
  SET categoria = EXCLUDED.categoria,
      titulo    = EXCLUDED.titulo,
      texto     = EXCLUDED.texto,
      ordem     = EXCLUDED.ordem,
      ativa     = EXCLUDED.ativa;
