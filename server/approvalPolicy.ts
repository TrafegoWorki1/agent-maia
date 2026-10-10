// Política de aprovação (decisão do owner, 2026-10-09): aprovação só para o que é público ou de risco:
// publicar/postar (Instagram), anúncios, compartilhar arquivo e DM de Instagram. Mensagem a contato, grupo
// cadastrado, planilha, tarefa etc. o owner pede e a Maia faz. Quem decide caso a caso (membro sem permissão,
// grupo não cadastrado) é `server/access.ts`.
const NEEDS_APPROVAL: RegExp[] = [
  // Instagram pela Zernio
  /^mcp__maia__instagram_publicar$/,
  /^mcp__maia__linkedin_publicar$/,
  // Instagram (Zernio): responder Direct e criar/ativar/pausar/excluir automação de comentário→DM.
  // Mesmo pausar pede OK: afeta uma automação que já está rodando para quem comentar.
  /^mcp__maia__instagram_direct_responder$/,
  /^mcp__maia__instagram_automacao_(criar|ativar|excluir)$/,
  /^mcp__maia__instagram_post_(cancelar|editar)$/,
  // InstaMany: mensagem direta e ativação de fluxo no Instagram
  /^mcp__claude_ai_instamany__(send_message|set_flow_status)$/,
  // Anúncios: criar, ativar, impulsionar, alterar e apagar (alterar pode ativar ou mudar orçamento)
  /^mcp__claude_ai_Meta_ADS__ads_(create_campaign|create_ad_set|create_ad|activate_entity|boost_ig_post|update_entity)$/,
  /^mcp__claude_ai_Meta_ADS__.*delete/,
  // Compartilhar arquivo com outras pessoas
  /^mcp__claude_ai_Google_Drive__share_file$/,
];

export function requiresApproval(toolName: string): boolean {
  return NEEDS_APPROVAL.some((pattern) => pattern.test(toolName));
}

const READ_TOOL = /^(?:mcp__claude_ai_[A-Za-z_]+__(get|list|search|read|download|suggest|ads_get|ads_insights|ads_library|ads_experiment_(list|get|check)|ads_account_get)|mcp__maia__(instagram_desempenho|artes_recentes|linkedin_contas|linkedin_organizacoes|linkedin_desempenho|instagram_stories|instagram_stories_metricas|instagram_musica_buscar|instagram_musica_detalhar|instagram_seguidor_status|instagram_conversas_listar|instagram_conversa_mensagens|instagram_automacoes_listar|instagram_automacao_detalhar|instagram_automacao_logs))$/;

export function isReadTool(toolName: string): boolean {
  return READ_TOOL.test(toolName);
}
