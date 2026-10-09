import { sendOwnerText } from "./evolutionSend.ts";
import { addTaskEvent, createOwnerTask, recordMessage, type Db } from "./store.ts";
import { APPROVAL_TTL_MS, approverNumbers, createApproval, decideFromText, openApprovals } from "./approvals.ts";

// Grupos do WhatsApp pela Evolution. Leitura com cache de 5 minutos (como no Bryan). Criar grupo é
// ação de escrita: pede SIM ou NÃO ao aprovador antes de executar. Só o dono envia os comandos.

const CACHE_MS = 15 * 60 * 1000;
// O WhatsApp limita a consulta de grupos (rate-overlimit). Ao receber o limite, para de consultar por um tempo e usa a última lista.
const COOLDOWN_MS = 10 * 60 * 1000;
let blockedUntil = 0;

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
  if (now < blockedUntil) return { groups: cache?.groups ?? [], error: "o WhatsApp limitou a consulta de grupos (rate-overlimit); tento de novo em alguns minutos" };
  const config = evoConfig();
  if (!config) return { groups: [], error: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${config.url}/group/fetchAllGroups/${config.instance}?getParticipants=false`, {
      headers: { apikey: config.apikey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const limited = /rate-overlimit/i.test(body) || response.status === 429;
      if (limited) blockedUntil = now + COOLDOWN_MS;
      return { groups: cache?.groups ?? [], error: limited ? "o WhatsApp limitou a consulta de grupos (rate-overlimit); tento de novo em alguns minutos" : `Evolution respondeu HTTP ${response.status}` };
    }
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

// Pedido natural de criar grupo: "criar grupo Nome e me coloca no grupo" (ou "com você").
// Sem o dono na frase, faltam participantes: o roteador pede os números em vez de deixar o agente improvisar.
export function parseGroupIntent(text: string, ownerNumber?: string): { name: string; participants: string[] } | null {
  const trimmed = text.trim();
  const explicit = parseCreateGroup(trimmed);
  if (explicit) return explicit;
  const match = /^criar\s+grupo\s+(.+)$/is.exec(trimmed);
  if (!match) return null;
  const rest = match[1].trim();
  const wantsOwner = /(?:^|\s)(me\s+coloca|me\s+adiciona|comigo|com\s+(?:eu|voc[eê]))(?=\s|$)/i.test(rest);
  const name = rest
    .replace(/\s+e\s+(me\s+(coloca|adiciona)|coloca\s+eu|adiciona\s+eu)\b.*$/i, "")
    .replace(/\s+(com\s+(eu|voc[eê])|comigo)\s*$/i, "")
    .trim()
    .slice(0, 100);
  if (!name) return null;
  return { name, participants: wantsOwner && ownerNumber ? [ownerNumber] : [] };
}

export function parseOwnerTask(text: string): { title: string; groupName: string | null } | null {
  const match = /^tarefa\s+(.+?)(?:\s+grupo\s+(.+))?$/is.exec(text.trim());
  if (!match) return null;
  return { title: match[1].trim(), groupName: match[2]?.trim() || null };
}

async function executeCreateGroup(name: string, participants: string[]): Promise<{ ok: boolean; detail: string; jid?: string; subject?: string }> {
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
    // A resposta da criação traz o identificador do grupo: é a primeira evidência de que ele existe.
    const body = (await response.json().catch(() => null)) as { id?: unknown; subject?: unknown } | null;
    const jid = typeof body?.id === "string" && body.id.endsWith("@g.us") ? body.id : undefined;
    return { ok: true, detail: "grupo criado", jid, subject: typeof body?.subject === "string" ? body.subject : undefined };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "falha ao criar o grupo" };
  }
}

// A conferência de grupo criado: o nome aparece na lista da instância (comparação sem acento e sem maiúsculas).
export function resetGroupCache(): void {
  cache = null;
}

// Só para teste.
export function resetGroupCooldown(): void {
  blockedUntil = 0;
}

export function groupExists(groups: { subject: string }[], name: string): boolean {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return groups.some((g) => norm(g.subject) === norm(name));
}

// Grupos em que a Maia atende (criados por ela ou cadastrados). O webhook consulta esta tabela.
export async function registerGroup(db: Db, jid: string, name: string, source: "criado" | "cadastrado"): Promise<void> {
  const { error } = await db.from("maia_groups").upsert({ jid, name, source, active: true }, { onConflict: "jid" });
  if (error) throw new Error(`cadastrar grupo: ${error.message}`);
}

export interface GroupDeps {
  db: Db;
  notifyOwner: (text: string) => Promise<void>;
}

interface GroupPayload {
  name: string;
  participants: string[];
}

// Pedido de criação: vira uma aprovação persistida (número, prazo e processo), não memória do processo.
export async function requestCreateGroup(deps: GroupDeps, name: string, participants: string[]): Promise<string> {
  const approver = process.env.EVOLUTION_APPROVER_NUMBER;
  if (!approver) return "Número aprovador não configurado no .env.";
  if ((await openApprovals(deps.db)).some((r) => r.kind === "grupo")) {
    return "Já existe um pedido de grupo aguardando aprovação. Responda antes de pedir outro.";
  }
  const taskId = await createOwnerTask(deps.db, { title: `Criar grupo ${name}`, groupName: name });
  const approval = await createApproval(deps.db, {
    kind: "grupo",
    toolName: "whatsapp.create_group",
    summary: `criar grupo ${name}`,
    payload: { name, participants } satisfies GroupPayload,
    taskId,
  });
  await addTaskEvent(deps.db, taskId, "approval_requested", "whatsapp.create_group", null);

  const request = `Pedido para criar o grupo "${name}" com ${participants.length} participante(s) (#${approval.id}).
Responda OK para criar ou NÃO para recusar. Sem resposta em 10 minutos, é recusado.`;
  await recordMessage(deps.db, { channel: "whatsapp", author: "maia", text: request });
  for (const to of await approverNumbers(deps.db)) await sendOwnerText(to, request);

  // Aviso de prazo, se este processo ainda estiver no ar. O banco continua sendo a fonte da verdade.
  setTimeout(() => void expireGroupIfPending(deps, approval.id, name, taskId), APPROVAL_TTL_MS).unref();
  return `Pedido de criação do grupo "${name}" enviado ao aprovador (#${approval.id}).`;
}

async function expireGroupIfPending(deps: GroupDeps, id: number, name: string, taskId: number): Promise<void> {
  const updated = await deps.db
    .from("approvals")
    .update({ status: "expired", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (updated.error || !updated.data || updated.data.length === 0) return;
  await addTaskEvent(deps.db, taskId, "approval_expired", "whatsapp.create_group", null);
  await deps.notifyOwner(`O pedido para criar o grupo "${name}" expirou sem resposta do aprovador.`);
}

// Resposta do aprovador (SIM ou NÃO, com número). Retorna true se a mensagem era uma resposta de aprovação.
export async function handleApproverText(deps: GroupDeps, text: string): Promise<boolean> {
  const decision = await decideFromText(deps.db, text);
  if (!decision.handled) return false;
  const approver = process.env.EVOLUTION_APPROVER_NUMBER;
  if (decision.reply) {
    if (approver) await sendOwnerText(approver, decision.reply);
    return true;
  }
  const row = decision.row!;
  // Ação de ferramenta: quem espera a resposta é o agente, que lê o banco. Nada a fazer aqui.
  if (row.kind !== "grupo") return true;

  const payload = row.payload as GroupPayload;
  const taskId = row.task_id;
  if (taskId) await addTaskEvent(deps.db, taskId, decision.approved ? "approval_approved" : "approval_denied", "whatsapp.create_group", null);
  if (!decision.approved) {
    await deps.notifyOwner(`Criação do grupo "${payload.name}" recusada pelo aprovador. Nenhum grupo foi criado.`);
    return true;
  }
  const result = await executeCreateGroup(payload.name, payload.participants);
  if (taskId) await addTaskEvent(deps.db, taskId, result.ok ? "external_done" : "task_failed", "whatsapp.create_group", result.detail);
  if (!result.ok) {
    await deps.notifyOwner(`Não consegui criar o grupo "${payload.name}": ${result.detail}`);
    return true;
  }
  // Conferência: a Evolution devolveu o id do grupo com o nome pedido, ou o grupo aparece na lista da instância.
  const answeredOk = Boolean(result.jid) && groupExists([{ subject: result.subject ?? payload.name }], payload.name);
  const live = answeredOk ? { groups: [], error: null } : await fetchLiveGroups();
  const inList = !answeredOk && !live.error && groupExists(live.groups, payload.name);
  const confirmed = answeredOk || inList;
  // O grupo criado pela Maia passa a ser atendido por ela, sem configurar nada à mão.
  const created = answeredOk ? { jid: result.jid!, subject: result.subject ?? payload.name } : inList ? live.groups.find((g) => groupExists([g], payload.name)) : undefined;
  if (created) await registerGroup(deps.db, created.jid, created.subject, "criado").catch((error) => console.error("[grupos]", error instanceof Error ? error.message : error));
  if (taskId) await addTaskEvent(deps.db, taskId, confirmed ? "task_verified" : "verification_failed", "whatsapp.create_group", confirmed ? null : live.error ?? "grupo não apareceu na lista");
  await deps.notifyOwner(confirmed ? `Grupo "${payload.name}" criado e conferido na lista da instância.` : `O pedido de criação do grupo "${payload.name}" foi aceito, mas não consegui confirmar que ele existe. Confira no WhatsApp antes de pedir de novo.`);
  return true;
}
