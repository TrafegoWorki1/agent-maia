import { canonicalPhone, samePhone } from "./evolutionWebhook.ts";
import { requiresApproval } from "./approvalPolicy.ts";
import type { Db } from "./store.ts";

// Quem pediu e o que pode. O sistema decide por código (não pela conversa): dono faz tudo que é interno e privado;
// membro faz o que a permissão dele cobre; o resto vira pedido de OK ao dono. Ação pública ou de risco sempre pede OK.

export type Role = "owner" | "member" | "guest";

export interface Requester {
  role: Role;
  name: string;
  number: string;
  permissions: ReadonlySet<string>;
}

export function ownerRequester(name = "Herickson"): Requester {
  return { role: "owner", name, number: process.env.EVOLUTION_OWNER_NUMBER ?? "", permissions: new Set() };
}

// Identifica o número em Pessoas. O dono é reconhecido pelo número do .env ou pelo papel "proprietario".
// Número que não bate com ninguém (ou vazio) é visitante: sem poderes.
export async function resolveRequester(db: Db, number: string, pushName: string): Promise<Requester> {
  const digits = number.replace(/\D/g, "");
  const name = pushName.trim();
  if (digits && samePhone(digits, process.env.EVOLUTION_OWNER_NUMBER)) return ownerRequester(name || "Herickson");
  if (!digits) return { role: "guest", name, number: "", permissions: new Set() };
  const { data: numbers } = await db.from("person_numbers").select("number, person_id");
  const hit = (numbers ?? []).find((n) => canonicalPhone(String(n.number)) === canonicalPhone(digits));
  if (!hit) return { role: "guest", name, number: digits, permissions: new Set() };
  const { data: person } = await db.from("people").select("name, role, active").eq("id", hit.person_id).maybeSingle();
  if (!person || !person.active) return { role: "guest", name, number: digits, permissions: new Set() };
  if (person.role === "proprietario") return ownerRequester(String(person.name));
  const { data: perms } = await db.from("person_permissions").select("permission_code").eq("person_id", hit.person_id);
  return { role: "member", name: String(person.name), number: digits, permissions: new Set((perms ?? []).map((p) => String(p.permission_code))) };
}

export interface AccessContext {
  groupRegistered?: boolean; // para ferramentas de grupo: o grupo está em maia_groups?
  dmInTask?: number; // mensagens diretas já enviadas nesta tarefa
}

export interface AccessDecision {
  decision: "allow" | "approve";
  reason: string;
}

export const MAX_DM_PER_TASK = 3;

const GROUP_SEND = /^mcp__maia__(grupo_enviar_texto|grupo_enviar_enquete|grupo_agendar|grupo_gerenciar_participantes|grupo_enviar_convite)$/;
const DIRECT_SEND = /^mcp__maia__contato_enviar_mensagem$/;
const EMAIL_SEND = /^mcp__claude_ai_Gmail__(send_message|reply|forward)$/;
const OWNER_ONLY = /^mcp__maia__(grupo_cadastrar|membro_cadastrar|contato_cadastrar|operacao_resumo|tarefas_listar|tarefa_criar|tarefa_atualizar|lembrete_criar|lembrete_editar|arquivo_reenviar|grupo_convite_link)$/;

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
  if (requiresApproval(toolName)) return { decision: "approve", reason: "ação pública ou de risco" };
  const isGroupSend = GROUP_SEND.test(toolName);
  if (isGroupSend && !ctx.groupRegistered) return { decision: "approve", reason: "grupo não cadastrado" };
  if (DIRECT_SEND.test(toolName) && (ctx.dmInTask ?? 0) >= MAX_DM_PER_TASK) return { decision: "approve", reason: `mais de ${MAX_DM_PER_TASK} contatos no mesmo pedido` };
  if (who.role === "owner") return { decision: "allow", reason: "owner" };

  if (OWNER_ONLY.test(toolName)) return { decision: "approve", reason: "só o owner cadastra" };
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
}

function inside(path: string, root: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(path) === norm(root) || norm(path).startsWith(`${norm(root)}/`);
}

export function decideBuiltin(toolName: string, input: Record<string, unknown>, who: Requester, roots: BuiltinRoots, resolvePath: (p: string) => string): { decision: "allow" | "deny"; reason: string } {
  if (SAFE_BUILTIN.has(toolName)) return { decision: "allow", reason: "ferramenta interna segura" };
  if (FILE_BUILTIN.has(toolName)) {
    const raw = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
    const target = raw ? resolvePath(raw) : roots.projectRoot;
    if (SECRET_PATH.test(target)) return { decision: "deny", reason: "arquivo de segredos ou configuração" };
    if (who.role === "owner") return inside(target, roots.projectRoot) ? { decision: "allow", reason: "dono lê o projeto" } : { decision: "deny", reason: "fora do projeto" };
    if (toolName === "Read" && (inside(target, roots.mediaDir) || (roots.memberMediaDir && inside(target, roots.memberMediaDir)))) return { decision: "allow", reason: "mídia enviada" };
    return { decision: "deny", reason: "só o dono lê arquivos do projeto" };
  }
  return who.role === "owner" ? { decision: "allow", reason: "ferramenta interna do dono" } : { decision: "deny", reason: "ferramenta interna só para o dono" };
}
