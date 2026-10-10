// Descreve, em português comum, uma ação que está pedindo OK — sem nome de ferramenta, sem MCP, sem JSON.
// Decisão do owner (10/10/2026): "não precisa saber disso, é irrelevante" sobre ver o código da ferramenta.
// Usado no pedido de aprovação (server/maiaOwnerAgent.ts e server/codexMaiaMcp.ts).

function str(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined;
}

function count(input: Record<string, unknown>, key: string): number | undefined {
  return Array.isArray(input[key]) ? input[key].length : undefined;
}

const PARTICIPANT_VERB: Record<string, string> = { adicionar: "adicionar", remover: "remover", promover: "promover a admin", rebaixar: "rebaixar" };

const SPECIFIC: Record<string, (input: Record<string, unknown>) => string> = {
  "mcp__maia__grupo_gerenciar_participantes": (i) => {
    const acao = str(i, "acao") ?? "atualizar";
    const n = count(i, "participantes");
    const grupo = str(i, "grupo");
    return `${PARTICIPANT_VERB[acao] ?? acao}${n ? ` ${n} pessoa(s)` : ""}${grupo ? ` no grupo "${grupo}"` : ""}`;
  },
  "mcp__maia__grupo_enviar_texto": (i) => `enviar uma mensagem no grupo "${str(i, "grupo") ?? "?"}"`,
  "mcp__maia__grupo_enviar_enquete": (i) => `criar uma enquete no grupo "${str(i, "grupo") ?? "?"}"`,
  "mcp__maia__grupo_agendar": (i) => `agendar um envio no grupo "${str(i, "grupo") ?? "?"}"`,
  "mcp__maia__grupo_enviar_convite": (i) => `enviar o convite do grupo "${str(i, "grupo") ?? "?"}"`,
  "mcp__maia__grupo_cadastrar": (i) => `passar a atender o grupo "${str(i, "grupo") ?? "?"}"`,
  "mcp__maia__contato_enviar_mensagem": (i) => `mandar uma mensagem para "${str(i, "contato") ?? "um contato"}"`,
  "mcp__maia__contato_cadastrar": () => "cadastrar um novo contato",
  "mcp__maia__membro_cadastrar": (i) => `cadastrar "${str(i, "nome") ?? "uma pessoa"}" como membro`,
  "mcp__maia__arquivo_reenviar": () => "reenviar um arquivo recebido",
  "mcp__maia__instagram_publicar": () => "publicar no Instagram",
  "mcp__maia__linkedin_publicar": () => "publicar no LinkedIn",
  "mcp__claude_ai_instamany__send_message": () => "mandar uma mensagem direta no Instagram",
  "mcp__claude_ai_instamany__set_flow_status": () => "ativar ou desativar um fluxo do Instagram",
  "mcp__claude_ai_Google_Drive__share_file": () => "compartilhar um arquivo do Drive",
};

const PATTERNS: [RegExp, string][] = [
  [/^mcp__claude_ai_Gmail__(send_message|reply|forward)$/, "enviar um e-mail"],
  [/^mcp__claude_ai_Google_Calendar__(create_event|update_event|respond_to_event)$/, "alterar um evento da agenda (gera convite)"],
  [/^mcp__claude_ai_Meta_ADS__/, "alterar algo nos anúncios (Meta Ads)"],
  [/delete|trash/i, "apagar algo"],
];

// Nome de ferramenta nunca mostrado ao owner: isto é só o último recurso, numa ação sem descrição conhecida.
function genericLabel(toolName: string): string {
  return toolName.replace(/^mcp__(maia|claude_ai_[A-Za-z_]+)__/, "").replace(/_/g, " ");
}

export function describeAction(toolName: string, input: Record<string, unknown>): string {
  const specific = SPECIFIC[toolName];
  if (specific) {
    try {
      return specific(input);
    } catch {
      // segue para o genérico
    }
  }
  const pattern = PATTERNS.find(([re]) => re.test(toolName));
  if (pattern) return pattern[1];
  return genericLabel(toolName);
}
