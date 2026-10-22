// Política de aprovação (decisão do owner, 2026-10-09): aprovação só para o que é público ou de risco:
// publicar/postar (Instagram), anúncios, compartilhar arquivo e DM de Instagram. Mensagem a contato, grupo
// cadastrado, planilha, tarefa etc. o owner pede e a Maia faz. Quem decide caso a caso (membro sem permissão,
// grupo não cadastrado) é `server/access.ts`.
const NEEDS_APPROVAL: RegExp[] = [
  // Instagram pela Zernio
  /^mcp__maia__instagram_publicar$/,
  /^mcp__maia__linkedin_publicar$/,
  // Ativar uma integração do catálogo amplia o que a Maia pode chamar: sempre pede OK do owner.
  /^mcp__maia__integracao_ativar$/,
  // Prospecção: cada envio para um contato é uma ação separada, com OK do dono.
  /^mcp__maia__prospeccao_enviar_proximo$/,
  // Integração externa do catálogo (envia, apaga, altera grupo ou perfil): OK do owner a cada uso.
  /^mcp__maia__integracao_chamar_externa$/,
  // Instagram (Zernio): responder Direct e criar/ativar/pausar/excluir automação de comentário→DM.
  // Mesmo pausar pede OK: afeta uma automação que já está rodando para quem comentar.
  /^mcp__maia__instagram_direct_responder$/,
  /^mcp__maia__instagram_automacao_(criar|ativar|excluir)$/,
  /^mcp__maia__instagram_post_(cancelar|editar)$/,
  /^mcp__maia__linkedin_post_(cancelar|editar)$/,
  // GitHub: commit, pull request e comentário alteram algo externo. Criar repositório privado e branch não pedem OK; público pede OK (access.ts).
  /^mcp__maia__github_(arquivo_salvar|pr_criar|comentar)$/,
  // Site (HTML): gravar no GitHub pede OK a cada vez. A publicação na Vercel (site_publicar_vercel) não pede: o owner já pediu.
  /^mcp__maia__site_subir_github$/,
  // Planilhas: apagar coluna ou aba remove dados; pede OK do owner a cada vez.
  /^mcp__maia__sheets_(apagar_coluna|apagar_aba)$/,
  // InstaMany: mensagem direta e ativação de fluxo no Instagram
  /^mcp__claude_ai_instamany__(send_message|set_flow_status)$/,
  // Anúncios: criar, ativar, impulsionar, alterar e apagar (alterar pode ativar ou mudar orçamento)
  /^mcp__claude_ai_Meta_ADS__ads_(create_campaign|create_ad_set|create_ad|activate_entity|boost_ig_post|update_entity)$/,
  /^mcp__claude_ai_Meta_ADS__.*delete/,
  // Compartilhar arquivo com outras pessoas
  /^mcp__claude_ai_Google_Drive__share_file$/,
  // Agenda nativa (Google Calendar via REST direto, disponível também sob o Codex): criar evento gera convite externo.
  /^mcp__maia__agenda_criar_evento$/,
  /^mcp__maia__email_(enviar|responder)$/,
];

export function requiresApproval(toolName: string): boolean {
  return NEEDS_APPROVAL.some((pattern) => pattern.test(toolName));
}

// O ramo mcp__claude_ai_* casava só o verbo sozinho (ex.: "list"), nunca o nome real da ferramenta
// (ex.: "list_calendars", "ads_get_ad_accounts"): nenhum teste cobria esse ramo e todo uso real de
// isReadTool() com um conector da conta sempre voltava falso (achado ao testar o coletor do painel,
// 21/10/2026). O verbo agora é um prefixo (get_, list_, search_, ads_get_ etc.), opcionalmente seguido
// de mais palavras com "_"; requiresApproval() continua barrando create/update/delete/share/send/etc.
// independente disso, então ampliar o prefixo não libera nenhuma ação de escrita.
const READ_TOOL = /^(?:mcp__claude_ai_[A-Za-z_]+__(?:get|list|search|read|download|suggest|ads_get|ads_insights|ads_library|ads_experiment_(?:list|get|check)|ads_account_get)(?:_[A-Za-z0-9]+)*|mcp__maia__(mensagem_status|sheets_(info|ler)|github_(repos_listar|prs_listar|issues_listar|ci_status)|instagram_desempenho|artes_recentes|arte_buscar|linkedin_contas|linkedin_organizacoes|linkedin_desempenho|integracao_listar|instagram_stories|instagram_stories_metricas|instagram_musica_buscar|instagram_musica_detalhar|instagram_seguidor_status|instagram_conversas_listar|instagram_conversa_mensagens|instagram_automacoes_listar|instagram_automacao_detalhar|instagram_automacao_logs|agenda_calendarios|agenda_disponibilidade|email_nao_lidos|email_buscar|meta_ads_contas|meta_ads_campanhas|meta_ads_insights))$/;

export function isReadTool(toolName: string): boolean {
  return READ_TOOL.test(toolName);
}
