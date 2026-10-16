import { canonicalPhone, samePhone } from "./evolutionWebhook.ts";
import { requiresApproval } from "./approvalPolicy.ts";
import type { Db } from "./store.ts";
import { groupToolDenial, type GroupScope } from "./groupScope.ts";

// Quem pediu e o que pode. O sistema decide por código (não pela conversa): dono faz tudo que é interno e privado;
// membro faz o que a permissão dele cobre; o resto vira pedido de OK ao dono. Ação pública ou de risco sempre pede OK.

export type Role = "owner" | "member" | "guest";

export interface Requester {
  role: Role;
  name: string;
  number: string;
  permissions: ReadonlySet<string>;
  approvalPermissions?: ReadonlySet<string>;
  blockedPermissions?: ReadonlySet<string>;
  accessGroups?: string[];
  clientIds?: string[];
  groupScope?: GroupScope;
}

export function ownerRequester(name = "Herickson"): Requester {
  return { role: "owner", name, number: process.env.EVOLUTION_OWNER_NUMBER ?? "", permissions: new Set() };
}

// Identifica o número em Pessoas. O dono é reconhecido pelo número do .env ou pelo papel "proprietario".
// Número que não bate com ninguém (ou vazio) é visitante: sem poderes.
export async function resolveRequester(db: Db, number: string, pushName: string, clientId: string | null = null): Promise<Requester> {
  const digits = number.replace(/\D/g, "");
  const name = pushName.trim();
  if (digits && samePhone(digits, process.env.EVOLUTION_OWNER_NUMBER)) return { ...ownerRequester(name || "Herickson"), number: digits };
  if (!digits) return { role: "guest", name, number: "", permissions: new Set() };
  const { data: numbers, error: numbersError } = await db.from("person_numbers").select("number, person_id");
  if (numbersError) throw new Error("Não foi possível confirmar a identidade do solicitante.");
  const hit = (numbers ?? []).find((n) => canonicalPhone(String(n.number)) === canonicalPhone(digits));
  if (!hit) return { role: "guest", name, number: digits, permissions: new Set() };
  const { data: person, error: personError } = await db.from("people").select("name, role, active").eq("id", hit.person_id).maybeSingle();
  if (personError) throw new Error("Não foi possível confirmar o cadastro do solicitante.");
  if (!person || !person.active) return { role: "guest", name, number: digits, permissions: new Set() };
  if (person.role === "proprietario") return { ...ownerRequester(String(person.name)), number: digits };
  const { data: perms, error: permsError } = await db.from("person_permissions").select("permission_code").eq("person_id", hit.person_id);
  if (permsError) throw new Error("Não foi possível confirmar as permissões individuais.");
  const memberships = await db.from("maia_access_group_members").select("access_group_id").eq("person_id", hit.person_id);
  if (memberships.error) throw new Error("Não foi possível confirmar as permissões dos grupos de acesso.");
  const ids = (memberships.data ?? []).map((m) => String(m.access_group_id));
  const groups = ids.length ? await db.from("maia_access_groups").select("id,client_id").in("id", ids).eq("active", true) : { data: [], error: null };
  if (groups.error) throw new Error("Não foi possível confirmar os grupos de acesso.");
  const eligible = (groups.data ?? []).filter((g) => !g.client_id || g.client_id === clientId).map((g) => String(g.id));
  const grants = eligible.length ? await db.from("maia_access_group_permissions").select("permission_code").in("access_group_id", eligible) : { data: [], error: null };
  if (grants.error) throw new Error("Não foi possível confirmar as permissões herdadas.");
  const overrides = await db.from("maia_member_access_modes").select("permission_code,mode").eq("person_id", hit.person_id);
  if (overrides.error) throw new Error("Não foi possível confirmar os modos individuais de acesso.");
  const blocked = new Set((overrides.data ?? []).filter((p) => p.mode === "bloqueado").map((p) => String(p.permission_code)));
  const approval = new Set((overrides.data ?? []).filter((p) => p.mode === "aprovacao").map((p) => String(p.permission_code)));
  const effective = new Set([...(perms ?? []).map((p) => String(p.permission_code)), ...(grants.data ?? []).map((p) => String(p.permission_code))]);
  for (const code of [...blocked, ...approval]) effective.delete(code);
  for (const p of overrides.data ?? []) if (p.mode === "permitido") effective.add(String(p.permission_code));
  return { role: "member", name: String(person.name), number: digits,
    accessGroups: (groups.data ?? []).map((g) => String(g.id)), clientIds: (groups.data ?? []).filter((g) => g.client_id).map((g) => String(g.client_id)),
    permissions: effective, approvalPermissions: approval, blockedPermissions: blocked };
}

export interface AccessContext {
  // A tarefa já usou busca na web: conteúdo de terceiros entrou na conversa. Ações que alteram algo pedem OK, até do dono.
  toolInput?: Record<string, unknown>;
  webTainted?: boolean;
  groupRegistered?: boolean; // para ferramentas de grupo: o grupo está em maia_groups?
  dmInTask?: number; // mensagens diretas já enviadas nesta tarefa
  targetGroupJid?: string;
  duplicateSend?: boolean;
}

export interface AccessDecision {
  decision: "allow" | "approve" | "deny";
  reason: string;
}

export const MAX_DM_PER_TASK = 3;

export function neededPermission(toolName: string, readOnly: boolean, input:Record<string,unknown>={}): string | null {
  if (toolName === "mcp__maia__integracao_chamar") return "integracao.usar";
  if (toolName === "mcp__maia__tarefas_listar" || toolName === "mcp__maia__trabalho_contexto") return "trabalho.ver";
  if (toolName === "mcp__maia__tarefa_criar") return "tarefas.criar";
  if (toolName === "mcp__maia__area_registro_salvar") return input.id?"trabalho.atualizar":"tarefas.criar";
  if (toolName === "mcp__maia__oportunidade_converter") return "trabalho.planejar";
  if (toolName === "mcp__maia__tarefa_atualizar") return input.resultado_revisao?"trabalho.revisar":input.aprovar?"trabalho.aprovar":input.responsavel_pessoa_id||input.equipe_id?"trabalho.redistribuir":input.prioridade!==undefined?"trabalho.planejar":"trabalho.atualizar";
  if (readOnly) {
    if (toolName.startsWith("mcp__claude_ai_Gmail__")) return "gmail.ler";
    if (toolName.startsWith("mcp__claude_ai_Meta_ADS__")) return "meta.ler";
    if (toolName.startsWith("mcp__claude_ai_Google_Drive__")) return "sheets.ler";
    if (toolName.startsWith("mcp__claude_ai_Google_Calendar__")) return "agenda.ler";
    return null;
  }
  if (/^mcp__maia__(grupo_enviar_texto|grupo_enviar_enquete|grupo_agendar|grupo_gerenciar_participantes|grupo_enviar_convite|grupo_alterar_foto|contato_enviar_mensagem)$/.test(toolName) || /^mcp__claude_ai_Gmail__(send_message|reply|forward)$/.test(toolName)) return "mensagem.enviar";
  return "escrita.pedir";
}

const GROUP_SEND = /^mcp__maia__(grupo_enviar_texto|grupo_enviar_enquete|grupo_agendar|grupo_gerenciar_participantes|grupo_enviar_convite|grupo_alterar_foto)$/;
const DIRECT_SEND = /^mcp__maia__contato_enviar_mensagem$/;
const EMAIL_SEND = /^mcp__claude_ai_Gmail__(send_message|reply|forward)$/;
const OWNER_ONLY = /^mcp__maia__(grupo_cadastrar|membro_cadastrar|contato_cadastrar|contato_salvar|plano_criar|plano_atualizar|planos_ativos|operacao_resumo|lembrete_criar|lembrete_editar|arquivo_reenviar|grupo_convite_link|instagram_conversas_listar|instagram_conversa_mensagens|instagram_automacoes_listar|instagram_automacao_detalhar|instagram_automacao_logs|anuncio_midia_url_temporaria|integracao_propor|prospeccao_preparar|prospeccao_enviar_proximo|prospeccao_descadastrar)$/;

// Quem pode conversar com a Maia no privado: o dono sempre; membro só com a permissão conversa.maia.
export function canConverse(who: Requester): boolean {
  return who.role === "owner" || who.permissions.has("conversa.maia");
}

// Permissão de leitura por conector (Drive entra como planilhas). Sem mapa, a leitura é livre.
function readPermission(toolName: string): string | null {
  if (toolName.startsWith("mcp__claude_ai_Gmail__")) return "gmail.ler";
  if (toolName.startsWith("mcp__claude_ai_Meta_ADS__")) return "meta.ler";
  if (toolName.startsWith("mcp__claude_ai_Google_Drive__")) return "sheets.ler";
  if (toolName.startsWith("mcp__claude_ai_Google_Calendar__")) return "agenda.ler";
  return null;
}

export function decideAccess(toolName: string, who: Requester, ctx: AccessContext, readOnly: boolean): AccessDecision {
  if (/^mcp__maia__membro_acesso_(localizar|consultar|definir)$/.test(toolName)) return who.role === "owner" && !who.groupScope ? { decision: "allow", reason: "administração privada do proprietário" } : { decision: "deny", reason: "administração exclusiva do proprietário no privado" };
  if (toolName === "mcp__maia__skill_propor" && (who.role !== "owner" || !!who.groupScope)) return { decision: "deny", reason: "proposta de skill só no privado do owner" };
  const scopeDenial = groupToolDenial(toolName, who, ctx.targetGroupJid);
  if (scopeDenial) return { decision: "deny", reason: scopeDenial };
  // Estes novos fluxos não consomem OK pontual: exigem capacidade vigente na transação.
  if(/^mcp__maia__(area_registro_salvar|oportunidade_converter)$/.test(toolName)&&who.role!=="owner"){
    const capability=neededPermission(toolName,false,ctx.toolInput)!;
    if(!who.permissions.has(capability)||who.blockedPermissions?.has(capability)||who.approvalPermissions?.has(capability))return {decision:"deny",reason:`O fluxo exige competência vigente ${capability}; OK pontual não altera acesso.`};
  }
  if (toolName === "mcp__maia__mensagem_status" && (who.role !== "owner" || who.groupScope)) return { decision: "deny", reason: "status de mensagens privadas só pode ser consultado pelo owner no privado" };
  if (/^mcp__maia__(grupos_clientes_listar|grupo_cliente_classificar)$/.test(toolName) && (who.role !== "owner" || who.groupScope)) return { decision: "deny", reason: "cadastro de clientes e acessos exclusivo do owner no privado" };
  if (who.role === "member") {
    const needed = neededPermission(toolName, readOnly,ctx.toolInput);
    if (needed && who.blockedPermissions?.has(needed)) return { decision: "deny", reason: `acesso individual bloqueado: ${needed}` };
    if (needed && who.approvalPermissions?.has(needed)) return { decision: "approve", reason: `aprovação pontual exigida para ${needed}` };
  }
  if (requiresApproval(toolName)) return { decision: "approve", reason: "ação pública ou de risco" };
  if (ctx.duplicateSend) return { decision: "approve", reason: "mensagem idêntica enviada ao mesmo destino nas últimas 24 horas; reenvio exige OK explícito do owner" };
  if (ctx.webTainted && !readOnly) return { decision: "approve", reason: "a tarefa usou busca na web; a ação pede OK mesmo para o dono" };
  const isGroupSend = GROUP_SEND.test(toolName);
  if (isGroupSend && !ctx.groupRegistered) return { decision: "approve", reason: "grupo não cadastrado" };
  if (DIRECT_SEND.test(toolName) && (ctx.dmInTask ?? 0) >= MAX_DM_PER_TASK) return { decision: "approve", reason: `mais de ${MAX_DM_PER_TASK} contatos no mesmo pedido` };
  if (who.role === "owner") return { decision: "allow", reason: "owner" };


  if (OWNER_ONLY.test(toolName)) return { decision: "approve", reason: "só o owner cadastra" };
  const capability = neededPermission(toolName,readOnly,ctx.toolInput);
  if (capability) return who.permissions.has(capability) ? { decision:"allow",reason:`tem ${capability}` } : { decision:"approve",reason:`sem a permissão ${capability}` };
  if (/^mcp__maia__integracao_chamar$/.test(toolName)) return who.permissions.has("integracao.usar") ? { decision: "allow", reason: "tem integracao.usar" } : { decision: "approve", reason: "sem a permissão integracao.usar" };
  if (readOnly) {
    const needed = readPermission(toolName);
    if (!needed || who.permissions.has(needed)) return { decision: "allow", reason: "consulta permitida" };
    return { decision: "approve", reason: `sem a permissão ${needed}` };
  }
  if (isGroupSend || DIRECT_SEND.test(toolName) || EMAIL_SEND.test(toolName)) {
    return who.permissions.has("mensagem.enviar") ? { decision: "allow", reason: "tem mensagem.enviar" } : { decision: "approve", reason: "sem a permissão mensagem.enviar" };
  }
  return who.permissions.has("escrita.pedir") ? { decision: "allow", reason: "tem escrita.pedir" } : { decision: "approve", reason: "sem a permissão escrita.pedir" };
}

// Ferramentas internas do agente (as que não vêm de conectores nem de mcp__maia__). Leitura de arquivo do computador é
// limitada: visitante e membro só leem a pasta de mídia temporária; o dono lê o projeto, menos segredos.
const SAFE_BUILTIN = new Set(["ToolSearch", "TodoWrite"]);
const FILE_BUILTIN = new Set(["Read", "Grep", "Glob"]);
const SECRET_PATH = /(^|[\\/])(\.env[^\\/]*|\.git|node_modules|\.claude[^\\/]*|\.ssh|\.aws|\.config)([\\/]|$)/i;

export interface BuiltinRoots {
  projectRoot: string;
  mediaDir: string;
  memberMediaDir?: string;
  // Repositórios extras de leitura (ex.: na VPS), definidos no servidor. Só o dono os lê.
  extraRoots?: string[];
}

function inside(path: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(path) === norm(root) || norm(path).startsWith(`${norm(root)}/`);
}

export function decideBuiltin(toolName: string, input: Record<string, unknown>, who: Requester, roots: BuiltinRoots, resolvePath: (p: string) => string): { decision: "allow" | "deny"; reason: string } {
  if (SAFE_BUILTIN.has(toolName)) return { decision: "allow", reason: "ferramenta interna segura" };
  if (who.groupScope?.clientId) return { decision: "deny", reason: "arquivos gerais da operação não são disponibilizados em grupo de cliente" };
  if (FILE_BUILTIN.has(toolName)) {
    const raw = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
    const target = raw ? resolvePath(raw) : roots.projectRoot;
    if (SECRET_PATH.test(target)) return { decision: "deny", reason: "arquivo de segredos ou configuração" };
    if (who.role === "owner") return [roots.projectRoot, ...(roots.extraRoots ?? [])].some((root) => inside(target, root)) ? { decision: "allow", reason: "dono lê o projeto" } : { decision: "deny", reason: "fora do projeto" };
    if (toolName === "Read" && (inside(target, roots.mediaDir) || (roots.memberMediaDir && inside(target, roots.memberMediaDir)))) return { decision: "allow", reason: "mídia enviada" };
    return { decision: "deny", reason: "só o dono lê arquivos do projeto" };
  }
  return who.role === "owner" ? { decision: "allow", reason: "ferramenta interna do dono" } : { decision: "deny", reason: "ferramenta interna só para o dono" };
}
