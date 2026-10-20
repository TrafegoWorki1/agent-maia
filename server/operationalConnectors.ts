// Conectores de operação liberados pelo owner em 2026-10-20: Trello, Vercel, Miro, ClickUp e Claude Docs.
// Só o owner, no privado, usa. Leitura livre; qualquer outra operação (criar, editar, apagar, publicar, implantar,
// compartilhar) pede OK pontual. Operação que não está na lista de leitura conta como escrita.
// Credenciais, variáveis de ambiente, tokens e chaves nunca entram como leitura livre, mesmo sendo "get"/"list".

export const OPERATIONAL_CONNECTOR_FAMILY = /^mcp__claude_ai_(Trello|Vercel|Miro|ClickUp|Claude_Docs)__(.+)$/;

const SENSITIVE_OPERATION = /(env|token|secret|key|bypass|sdk|kms|credential|drain|webhook|attack)/i;

const READ_OPERATIONS: Record<string, RegExp> = {
  Trello: /^trello(Read|Search)/,
  Vercel: /^(list|get|search|count|aggregate|read|web_fetch|artifact_query)_/,
  Miro: /^(board_(get_space|preview_read|search_boards|show)|canvas_(read_as_svg|search|get_canvas_composer_skill|load_format_skill)|comment_list_comments|content_item_list_roles|image_(get_data|get_url)|prototype_read|space_(list|list_boards|list_children)|table_(list_rows|get_latest_update_history)|user_who_am_i)$/,
  ClickUp: /^(get|list|search|read)_/,
  Claude_Docs: /^(read|query|guide)$/,
};

export function isOperationalConnector(toolName: string): boolean {
  return OPERATIONAL_CONNECTOR_FAMILY.test(toolName);
}

export function isOperationalConnectorRead(toolName: string): boolean {
  const match = OPERATIONAL_CONNECTOR_FAMILY.exec(toolName);
  if (!match) return false;
  const [, family, operation] = match;
  if (SENSITIVE_OPERATION.test(operation)) return false;
  return READ_OPERATIONS[family].test(operation);
}
