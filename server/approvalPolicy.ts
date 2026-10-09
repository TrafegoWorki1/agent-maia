// Política de aprovação (decisão do owner, 2026-10-09): só pedem SIM/NÃO as ações que saem para fora ou gastam:
// publicar/postar, enviar mensagem (e-mail, privado, grupo), subir ou ativar anúncios, apagar e convidar.
// As demais ações (rascunhos, etiquetas, tarefas etc.) rodam sem aprovação. Leituras sempre rodam direto.
const NEEDS_APPROVAL: RegExp[] = [
  // Instagram pela Zernio
  /^mcp__maia__instagram_publicar$/,
  // Enviar mensagem: e-mail e DM do Instagram (InstaMany)
  /^mcp__claude_ai_Gmail__(send_message|reply|forward)$/,
  /^mcp__claude_ai_instamany__(send_message|set_flow_status)$/,
  // Anúncios: criar, ativar, impulsionar e alterar (alterar pode ativar ou mudar orçamento)
  /^mcp__claude_ai_Meta_ADS__ads_(create_campaign|create_ad_set|create_ad|activate_entity|boost_ig_post|update_entity)$/,
  // Grupos do WhatsApp: texto, enquete e agendamento (ler enquete é livre)
  /^mcp__maia__(grupo_enviar_texto|grupo_enviar_enquete|grupo_agendar)$/,
  // Apagar: qualquer ferramenta de conector com delete ou trash no nome (e-mail, evento, arquivo, anúncio, público, documento)
  /^mcp__claude_ai_.+__.*(delete|trash)/,
  // Convites: criar, alterar e responder evento da agenda avisam os convidados
  /^mcp__claude_ai_Google_Calendar__(create_event|update_event|respond_to_event)$/,
  // Compartilhar arquivo com outras pessoas
  /^mcp__claude_ai_Google_Drive__share_file$/,
];

export function requiresApproval(toolName: string): boolean {
  return NEEDS_APPROVAL.some((pattern) => pattern.test(toolName));
}
