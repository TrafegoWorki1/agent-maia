import { sendOwnerText } from "./evolutionSend.ts";
import { addTaskEvent, createOwnerTask, recordMessage, resolveApproval, startApproval, type Db } from "./store.ts";

// Grupos do WhatsApp pela Evolution. Leitura com cache de 5 minutos (como no Bryan). Criar grupo é
// ação de escrita: pede SIM ou NÃO ao aprovador antes de executar. Só o dono envia os comandos.

const CACHE_MS = 5 * 60 * 1000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export interface LiveGroup {
  jid: string;
  subject: string;
  size: number | null;
}

let cache: { at: number; groups: LiveGroup[] } | null = null;

function evoConfig(): { url: string; instance: string; apikey: string } | null {
  const url = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY;
  return url && instance && apikey ? { url, instance, apikey } : null;
}

export async function fetchLiveGroups(now = Date.now()): Promise<{ groups: LiveGroup[]; error: string | null }> {
  if (cache && now - cache.at < CACHE_MS) return { groups: cache.groups, error: null };
  const config = evoConfig();
  if (!config) return { groups: [], error: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${config.url}/group/fetchAllGroups/${config.instance}?getParticipants=false`, {
      headers: { apikey: config.apikey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { groups: cache?.groups ?? [], error: `Evolution respondeu HTTP ${response.status}` };
    const raw = (await response.json()) as { id?: string; subject?: string; size?: number }[];
    const groups = raw
      .filter((g) => typeof g.id === "string")
      .map((g) => ({ jid: g.id!, subject: g.subject ?? "(sem nome)", size: typeof g.size === "number" ? g.size : null }));
    cache = { at: now, groups };
    return { groups, error: null };
  } catch (error) {
    // Falha: mantém o último dado bom e informa o erro, sem inventar nada.
    return { groups: cache?.groups ?? [], error: error instanceof Error ? error.message : "falha ao consultar grupos" };
  }
}

// Comandos do dono (texto puro, sem IA):
//   criar grupo Nome do grupo | 5585999999999, 5585888888888
//   tarefa Título da tarefa [grupo Nome do grupo]
export function parseCreateGroup(text: string): { name: string; participants: string[] } | null {
  const match = /^criar grupo\s+(.+?)\s*\|\s*(.+)$/is.exec(text.trim());
  if (!match) return null;
  const participants = match[2]
    .split(/[,;\s]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 12 && n.length <= 13);
  if (!participants.length) return null;
  return { name: match[1].trim().slice(0, 100), participants };
}

export function parseOwnerTask(text: string): { title: string; groupName: string | null } | null {
  const match = /^tarefa\s+(.+?)(?:\s+grupo\s+(.+))?$/is.exec(text.trim());
  if (!match) return null;
  return { title: match[1].trim(), groupName: match[2]?.trim() || null };
}

// Pedido de criação aguardando o aprovador. Só um por vez.
interface PendingGroupAction {
  name: string;
  participants: string[];
  approvalId: number;
  taskId: number;
}
let pendingGroup: PendingGroupAction | null = null;

export function hasPendingGroupAction(): boolean {
  return pendingGroup !== null;
}

async function executeCreateGroup(name: string, participants: string[]): Promise<{ ok: boolean; detail: string }> {
  const config = evoConfig();
  if (!config) return { ok: false, detail: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${config.url}/group/create/${config.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apikey },
      body: JSON.stringify({ subject: name, participants }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return { ok: false, detail: `Evolution respondeu HTTP ${response.status}` };
    cache = null;
    return { ok: true, detail: "grupo criado" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "falha ao criar o grupo" };
  }
}

export interface GroupDeps {
  db: Db;
  notifyOwner: (text: string) => Promise<void>;
}

// Recebe o pedido do dono: registra, envia o pedido ao aprovador e espera SIM/NÃO.
export async function requestCreateGroup(deps: GroupDeps, name: string, participants: string[]): Promise<string> {
  if (pendingGroup) return "Já existe um pedido de grupo aguardando aprovação. Responda antes de pedir outro.";
  const approver = process.env.EVOLUTION_APPROVER_NUMBER;
  if (!approver) return "Número aprovador não configurado no .env.";
  const taskId = await createOwnerTask(deps.db, { title: `Criar grupo ${name}`, groupName: name });
  const approvalId = await startApproval(deps.db, "whatsapp.create_group");
  await addTaskEvent(deps.db, taskId, "approval_requested", "whatsapp.create_group", null);
  pendingGroup = { name, participants, approvalId, taskId };

  const request = `Pedido para criar o grupo "${name}" com ${participants.length} participante(s).\nResponda SIM para criar ou NÃO para recusar. Sem resposta em 10 minutos, é recusado.`;
  await recordMessage(deps.db, { channel: "whatsapp", author: "maia", text: request });
  await sendOwnerText(approver, request);

  setTimeout(() => {
    if (pendingGroup?.approvalId !== approvalId) return;
    pendingGroup = null;
    void resolveApproval(deps.db, approvalId, "expired");
    void addTaskEvent(deps.db, taskId, "approval_expired", "whatsapp.create_group", null);
    void deps.notifyOwner(`O pedido para criar o grupo "${name}" expirou sem resposta do aprovador.`);
  }, APPROVAL_TIMEOUT_MS).unref();
  return `Pedido de criação do grupo "${name}" enviado ao aprovador.`;
}

// Resposta do aprovador para o pedido de grupo. Retorna true se consumiu a mensagem.
export async function resolveGroupActionFromText(text: string, deps: GroupDeps): Promise<boolean> {
  if (!pendingGroup) return false;
  const answer = text.trim().toLowerCase();
  if (answer !== "sim" && answer !== "não" && answer !== "nao") return false;
  const current = pendingGroup;
  pendingGroup = null;
  const approved = answer === "sim";
  await resolveApproval(deps.db, current.approvalId, approved ? "approved" : "denied");
  await addTaskEvent(deps.db, current.taskId, approved ? "approval_approved" : "approval_denied", "whatsapp.create_group", null);
  if (!approved) {
    await deps.notifyOwner(`Criação do grupo "${current.name}" recusada pelo aprovador. Nenhum grupo foi criado.`);
    return true;
  }
  const result = await executeCreateGroup(current.name, current.participants);
  await addTaskEvent(deps.db, current.taskId, result.ok ? "external_done" : "task_failed", "whatsapp.create_group", result.detail);
  await deps.notifyOwner(result.ok ? `Grupo "${current.name}" criado.` : `Não consegui criar o grupo "${current.name}": ${result.detail}`);
  return true;
}


