import { fetchLiveGroups, type LiveGroup } from "./groups.ts";
import { addTaskEvent, type Db } from "./store.ts";

// Ações da Maia em grupos do WhatsApp (decisão do owner, 2026-10-09): mandar texto com menção, enquete, ler enquetes
// e agendar texto ou enquete. Enviar e agendar passam pela aprovação (OK ou NÃO). Ler é livre.
// O grupo é sempre validado pelo nome na lista da instância (identificador JID), nunca por texto livre.

const MAX_TEXT = 3000;

function evo(): { url: string; instance: string; apikey: string } {
  const url = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!url || !instance || !apikey) throw new Error("Evolution não configurada no .env");
  return { url, instance, apikey };
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Nome do grupo -> grupo da instância. Exige um único resultado.
export function pickGroup(groups: LiveGroup[], name: string): { ok: true; group: LiveGroup } | { ok: false; error: string } {
  const wanted = norm(name);
  const hits = groups.filter((g) => norm(g.subject) === wanted);
  if (hits.length === 1) return { ok: true, group: hits[0] };
  if (hits.length > 1) return { ok: false, error: `há mais de um grupo chamado "${name}"` };
  return { ok: false, error: `não achei o grupo "${name}" na lista da instância` };
}

export async function resolveGroup(name: string): Promise<{ ok: true; group: LiveGroup } | { ok: false; error: string }> {
  const live = await fetchLiveGroups();
  if (live.error && live.groups.length === 0) return { ok: false, error: live.error };
  return pickGroup(live.groups, name);
}

// Menções: números (com ou sem símbolos) ou nomes cadastrados em Pessoas. O texto precisa trazer @número.
export async function resolveMentions(db: Db, items: string[]): Promise<{ ok: true; numbers: string[] } | { ok: false; error: string }> {
  const numbers: string[] = [];
  for (const raw of items) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 12 && digits.length <= 13) {
      numbers.push(digits);
      continue;
    }
    const { data, error } = await db.from("people").select("id, name").ilike("name", `%${raw.trim()}%`).eq("active", true);
    if (error) return { ok: false, error: `não consegui consultar Pessoas: ${error.message}` };
    if (!data || data.length !== 1) return { ok: false, error: `não identifiquei quem é "${raw}" (${data?.length ?? 0} pessoas com esse nome). Passe o número.` };
    const nums = await db.from("person_numbers").select("number").eq("person_id", data[0].id);
    const first = (nums.data ?? [])[0]?.number as string | undefined;
    if (!first) return { ok: false, error: `"${raw}" não tem número cadastrado` };
    numbers.push(first.replace(/\D/g, ""));
  }
  return { ok: true, numbers: [...new Set(numbers)] };
}

// O texto ganha @número no fim para cada menção que ainda não está nele (é isso que o WhatsApp destaca).
export function withMentionTags(text: string, numbers: string[]): string {
  const missing = numbers.filter((n) => !text.includes(`@${n}`));
  return missing.length ? `${text.trim()} ${missing.map((n) => `@${n}`).join(" ")}` : text;
}

export function validateText(text: string): string | null {
  const t = text.trim();
  if (!t) return "o texto está vazio";
  if (t.length > MAX_TEXT) return `o texto passa de ${MAX_TEXT} caracteres`;
  return null;
}

export function validatePoll(question: string, options: string[], selectable: number): string | null {
  if (!question.trim()) return "a pergunta da enquete está vazia";
  const clean = options.map((o) => o.trim()).filter(Boolean);
  if (clean.length < 2) return "a enquete precisa de pelo menos 2 opções";
  if (clean.length > 12) return "a enquete aceita até 12 opções";
  if (new Set(clean.map(norm)).size !== clean.length) return "há opções repetidas";
  if (selectable < 1 || selectable > clean.length) return "a quantidade de respostas permitidas é inválida";
  return null;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const { url, instance, apikey } = evo();
  const response = await fetch(`${url}${path}/${instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

const messageId = (json: unknown): string | null => {
  const id = (json as { key?: { id?: unknown } } | null)?.key?.id;
  return typeof id === "string" ? id : null;
};

// Devolve o id da mensagem aceita pelo WhatsApp (a conferência da entrega).
export async function sendGroupText(jid: string, text: string, mentions: string[]): Promise<string> {
  const body: Record<string, unknown> = { number: jid, text: withMentionTags(text, mentions) };
  if (mentions.length) body.mentioned = mentions;
  const { status, json } = await post("/message/sendText", body);
  const id = messageId(json);
  if (status < 200 || status >= 300 || !id) throw new Error(`a Evolution não confirmou o envio do texto (HTTP ${status})`);
  return id;
}

export async function sendGroupPoll(jid: string, question: string, options: string[], selectable: number): Promise<string> {
  const { status, json } = await post("/message/sendPoll", { number: jid, name: question.trim(), selectableCount: selectable, values: options.map((o) => o.trim()).filter(Boolean) });
  const id = messageId(json);
  if (status < 200 || status >= 300 || !id) throw new Error(`a Evolution não confirmou o envio da enquete (HTTP ${status})`);
  return id;
}

export interface PollResult {
  question: string;
  at: string | null;
  options: { name: string; votes: number | null }[];
  voters: number | null;
}

// Lê as enquetes recentes do grupo. A contagem vem do que a Evolution guardou; o que ela não informa fica nulo.
export async function readGroupPolls(jid: string, limit = 3): Promise<PollResult[]> {
  const { status, json } = await post("/chat/findMessages", { where: { key: { remoteJid: jid }, messageType: "pollCreationMessage" }, limit: 20 });
  if (status < 200 || status >= 300) throw new Error(`a Evolution não devolveu as mensagens (HTTP ${status})`);
  const root = json as { messages?: { records?: unknown[] } | unknown[] } | unknown[] | null;
  const records = (Array.isArray(root) ? root : Array.isArray((root as { messages?: unknown })?.messages) ? ((root as { messages: unknown[] }).messages) : ((root as { messages?: { records?: unknown[] } })?.messages?.records ?? [])) as Record<string, unknown>[];
  return records
    .map((r) => parsePoll(r))
    .filter((p): p is PollResult => p !== null)
    .sort((a, b) => Date.parse(b.at ?? "0") - Date.parse(a.at ?? "0"))
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

export function parsePoll(record: Record<string, unknown>): PollResult | null {
  const message = (record.message ?? {}) as Record<string, unknown>;
  const poll = (message.pollCreationMessage ?? message.pollCreationMessageV3 ?? message.pollCreationMessageV2) as { name?: string; options?: { optionName?: string }[] } | undefined;
  if (!poll?.name) return null;
  const names = (poll.options ?? []).map((o) => String(o.optionName ?? ""));
  const updates = (record.pollUpdates ?? message.pollUpdates) as { pollUpdateMessageKey?: unknown; vote?: { selectedOptions?: unknown[] }; senderTimestampMs?: unknown; sender?: string }[] | undefined;
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  let voters: number | null = null;
  if (Array.isArray(updates)) {
    // Último voto de cada pessoa vale.
    const last = new Map<string, string[]>();
    for (const u of updates) {
      const who = String(u.sender ?? Math.random());
      const selected = (u.vote?.selectedOptions ?? []).map((s) => (typeof s === "string" ? s : String((s as { optionName?: unknown })?.optionName ?? "")));
      last.set(who, selected);
    }
    for (const selected of last.values()) for (const name of selected) if (counts.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    voters = last.size;
  }
  const ts = Number(record.messageTimestamp);
  return {
    question: poll.name,
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    options: names.map((name) => ({ name, votes: Array.isArray(updates) ? counts.get(name) ?? 0 : null })),
    voters,
  };
}

// ---- Agendamento ----

export interface SchedulePayload {
  text?: string;
  mentions?: string[];
  question?: string;
  options?: string[];
  selectable?: number;
}

export async function scheduleAction(
  db: Db,
  input: { kind: "texto" | "enquete"; group: LiveGroup; payload: SchedulePayload; runAt: Date; taskId: number | null },
): Promise<number> {
  const { data, error } = await db
    .from("scheduled_actions")
    .insert({ kind: input.kind, group_jid: input.group.jid, group_name: input.group.subject, payload: input.payload, run_at: input.runAt.toISOString(), task_id: input.taskId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`agendar: ${error?.message ?? "sem retorno"}`);
  return data.id as number;
}

export function validateRunAt(value: string, now = new Date()): { ok: true; at: Date } | { ok: false; error: string } {
  const when = Date.parse(value);
  if (Number.isNaN(when)) return { ok: false, error: "horário inválido (use data e hora ISO, com fuso)" };
  if (when <= now.getTime() + 60_000) return { ok: false, error: "o horário precisa ser pelo menos 1 minuto no futuro" };
  if (when > now.getTime() + 90 * 24 * 3600_000) return { ok: false, error: "o agendamento passa de 90 dias" };
  return { ok: true, at: new Date(when) };
}

interface DueRow {
  id: number;
  kind: "texto" | "enquete";
  group_jid: string;
  group_name: string;
  payload: SchedulePayload;
  task_id: number | null;
}

// Executa as ações vencidas. Já foram aprovadas na hora de agendar. Cada uma roda uma vez e nunca é repetida:
// falha vira "failed" e avisa o dono. Sem id de mensagem aceito pela Evolution, não conta como entregue.
export async function runDueActions(db: Db, notify: (text: string) => Promise<void>): Promise<number> {
  const claimed = await db.rpc("claim_due_actions", { p_limit: 5 });
  if (claimed.error) throw new Error(`claim_due_actions: ${claimed.error.message}`);
  const rows = (claimed.data ?? []) as DueRow[];
  for (const row of rows) {
    try {
      const id =
        row.kind === "texto"
          ? await sendGroupText(row.group_jid, row.payload.text ?? "", row.payload.mentions ?? [])
          : await sendGroupPoll(row.group_jid, row.payload.question ?? "", row.payload.options ?? [], row.payload.selectable ?? 1);
      await db.from("scheduled_actions").update({ status: "done", result: `mensagem ${id}`, finished_at: new Date().toISOString() }).eq("id", row.id);
      if (row.task_id) await addTaskEvent(db, row.task_id, "task_verified", `agendado.${row.kind}`, `mensagem ${id}`).catch(() => {});
      await notify(`Enviei no grupo "${row.group_name}" (${row.kind === "texto" ? "texto" : "enquete"} agendado).`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await db.from("scheduled_actions").update({ status: "failed", result: reason.slice(0, 300), finished_at: new Date().toISOString() }).eq("id", row.id);
      await notify(`Não consegui enviar o ${row.kind} agendado para o grupo "${row.group_name}": ${reason}. Não repeti sozinha.`);
    }
  }
  return rows.length;
}

// Ações que ficaram "running" quando o worker caiu: viram falhas, para nunca enviar duas vezes.
export async function recoverRunningActions(db: Db): Promise<number> {
  const { data } = await db.from("scheduled_actions").update({ status: "failed", result: "worker reiniciou durante o envio; confira o grupo", finished_at: new Date().toISOString() }).eq("status", "running").select("id");
  return data?.length ?? 0;
}
