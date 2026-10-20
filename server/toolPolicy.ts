// Inventário executável. Adicionar ferramenta local exige incluí-la aqui; caso contrário o servidor nega.
// Conectores Claude são dinâmicos, mas somente estas famílias passam para a política de operação.
export const MAIA_TOOL_NAMES = new Set([
  "anuncio_midia_url_temporaria", "arquivo_reenviar", "arte_buscar", "arte_reenviar", "arte_referencia_apagar", "arte_referencia_salvar", "arte_referencias_listar", "artes_recentes", "avisar_dono", "buscar_conhecimento",
  "contato_buscar", "contato_enviar_mensagem", "contato_instancia_buscar", "contato_salvar", "conversas_listar",
  "gerar_imagem", "grupo_agendar", "grupo_alterar_foto", "grupo_apagar_mensagem", "grupo_cadastrar", "grupo_cliente_classificar",
  "grupo_convite_link", "grupo_criar", "grupo_enviar_convite", "grupo_enviar_enquete", "grupo_enviar_texto",
  "grupo_gerenciar_participantes", "grupo_info", "grupo_ler_enquetes", "grupo_participantes", "grupos_clientes_listar",
  "instagram_automacao_ativar", "instagram_automacao_criar", "instagram_automacao_detalhar", "instagram_automacao_excluir",
  "instagram_automacao_logs", "instagram_automacoes_listar", "instagram_conversa_mensagens", "instagram_conversas_listar",
  "instagram_desempenho", "instagram_direct_responder", "instagram_musica_buscar", "instagram_musica_detalhar",
  "instagram_post_cancelar", "instagram_post_editar", "instagram_publicar", "instagram_seguidor_status", "instagram_stories",
  "instagram_stories_metricas", "integracao_ativar", "integracao_chamar", "integracao_chamar_externa", "integracao_listar",
  "integracao_propor", "listar_capacidades", "linkedin_contas", "linkedin_desempenho", "linkedin_organizacoes", "linkedin_post_cancelar",
  "linkedin_post_editar", "linkedin_publicar", "membro_acesso_consultar", "membro_acesso_definir", "membro_acesso_localizar",
  "membro_cadastrar", "memoria_buscar", "memoria_registrar", "mensagem_status", "operacao_resumo", "planilha_criar",
  "plano_atualizar", "plano_criar", "planos_ativos", "preferencia_propor", "prospeccao_descadastrar",
  "prospeccao_enviar_proximo", "prospeccao_preparar", "skill_propor", "skill_propor_atualizacao", "trabalho_arte_enfileirar", "area_registro_salvar",
  "oportunidade_converter", "tarefas_listar", "trabalho_contexto", "tarefa_criar", "tarefa_atualizar", "lembrete_criar",
  "lembrete_editar", "drive_enviar_arquivo", "drive_salvar_arquivo",
  "registrar_incidente", "propor_padrao_prevencao",
]);

const CONNECTOR_FAMILY = /^mcp__claude_ai_(Gmail|Meta_ADS|Google_Drive|Google_Calendar|instamany)__/;

export function isKnownMcpTool(toolName: string): boolean {
  const local = /^mcp__maia__(.+)$/.exec(toolName);
  if (local) return MAIA_TOOL_NAMES.has(local[1]);
  return CONNECTOR_FAMILY.test(toolName);
}
