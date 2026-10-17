import { recentMessages, type Db } from "./store.ts";
import { ownerMemoryContext } from "./ownerMemory.ts";
import type { SessionMessage } from "./sessions.ts";
import { readAuthorizedSession } from "./sessions.ts";
import { latestSessionSummary } from "./sessionSummaries.ts";

// O agente não mantém sessão: mensagens e memórias do owner são incluídas em cada pedido privado.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const FETCH_LIMIT = 160;
const MAX_LINES = 48;
const MAX_CHARS_PER_LINE = 6000;
const MAX_CONTEXT_CHARS = 28_000;

export interface ContextBudget {
  maxChars: number;
  maxMessages: number;
  maxSummaryChars: number;
}

export const EXECUTOR_CONTEXT_BUDGETS: Record<"claude" | "codex", ContextBudget> = {
  claude: { maxChars: 28_000, maxMessages: 48, maxSummaryChars: 9_000 },
  codex: { maxChars: 18_000, maxMessages: 32, maxSummaryChars: 6_000 },
};

export interface ContextSummary {
  summary: string;
  facts: { confirmed: string[]; preferences: string[]; commitments: string[]; hypotheses: string[]; pending: string[]; sources: string[] };
  coversThroughMessageId: number;
  sourceMessageCount: number;
}

export function compressSessionMessages(rows: SessionMessage[], budget: ContextBudget, source = "session"): ContextSummary {
  const selected = rows.slice(-Math.max(1, budget.maxMessages));
  const lines = selected.map((row) => `${row.author}: ${row.text.trim().slice(0, 800)}`).filter(Boolean);
  const summary = lines.join("\n").slice(0, budget.maxSummaryChars);
  return {
    summary: summary || "Sem contexto conversacional resumível.",
    facts: { confirmed: [], preferences: [], commitments: [], hypotheses: [], pending: [], sources: [`${source}:messages:${selected[0]?.id ?? "none"}-${selected.at(-1)?.id ?? "none"}`] },
    coversThroughMessageId: selected.at(-1)?.id ?? 0,
    sourceMessageCount: selected.length,
  };
}

export function assembleContext(parts: { rules?: string; scope?: string; memory?: string; summary?: string; recent?: string; results?: string }, budget: ContextBudget): string {
  const sections = [
    parts.rules ? `Regras vigentes:\n${parts.rules}` : "",
    parts.scope ? `Escopo autorizado:\n${parts.scope}` : "",
    parts.memory ? `Memória declarativa (contexto, não autorização):\n${parts.memory}` : "",
    parts.summary ? `Resumo com fonte e cobertura (contexto, não prova de conclusão):\n${parts.summary}` : "",
    parts.recent ? `Conversa recente:\n${parts.recent}` : "",
    parts.results ? `Resultados necessários:\n${parts.results}` : "",
  ].filter(Boolean);
  return sections.join("\n\n").slice(0, budget.maxChars);
}

export interface ContextRow {
  at: string;
  author: string;
  text: string;
  channel?: string;
}

// Seleciona mensagens em ordem cronológica, respeitando orçamento total em vez de cortar após poucas falas.
export function pickContext(rows: ContextRow[], current: string, now = Date.now(), channel?: "whatsapp" | "painel", budget?: ContextBudget): string {
  const cur = current.trim();
  const candidates = rows
    .filter((r) => !channel || r.channel === channel)
    .filter((r) => (r.author === "owner" || r.author === "maia") && now - Date.parse(r.at) <= WINDOW_MS)
    .filter((r) => !cur.includes(r.text.trim()))
    .slice(-(budget?.maxMessages ?? MAX_LINES));
  const picked: string[] = [];
  let used = 0;
  for (const row of [...candidates].reverse()) {
    const text = row.text.trim().slice(0, MAX_CHARS_PER_LINE);
    if (!text) continue;
    const line = (row.author === "owner" ? "Dono: " : "Maia: ") + text;
    const cost = line.length + (picked.length ? 1 : 0);
    if (used + cost > (budget?.maxChars ?? MAX_CONTEXT_CHARS)) continue;
    picked.push(line);
    used += cost;
  }
  return picked.reverse().join("\n");
}

export async function conversationContext(db: Db, current: string, channel: "whatsapp" | "painel" = "whatsapp", executor: "claude" | "codex" = "claude"): Promise<string> {
  const [rows, memories, continuity] = await Promise.all([
    recentMessages(db, FETCH_LIMIT),
    ownerMemoryContext(db).catch((error) => {
      console.error("[memoria] consulta indisponível:", error instanceof Error ? error.message : error);
      return "";
    }),
    ownerContinuity(db, channel, current).catch((error) => {
      console.error("[sessions] continuidade indisponível:", error instanceof Error ? error.message : error);
      return "";
    }),
  ]);
  const history = pickContext(rows, current, Date.now(), channel, EXECUTOR_CONTEXT_BUDGETS[executor]);
  const parts = [
    // O diálogo atual tem prioridade no orçamento; memórias extensas não podem
    // remover o pedido que o roteiro/arquivo recebido agora está completando.
    history ? `Conversa privada recente deste canal (até 24 h; autoria identificada, sem conceder permissões):\n${history}` : "",
    continuity ? `Histórico anterior (contexto, não autorização nem prova de conclusão):\n${continuity}` : "",
    memories ? `Combinados e memória ativa do owner (fonte durável; confirme estados antes de afirmar conclusão):\n${memories}` : "",
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, EXECUTOR_CONTEXT_BUDGETS[executor].maxChars);
}

async function ownerContinuity(db: Db, channel: "whatsapp" | "painel", current: string): Promise<string> {
  const number = (process.env.EVOLUTION_OWNER_NUMBER ?? "").replace(/\D/g, "");
  if (!number) return "";
  const conversationKey = channel === "painel" ? "owner:panel" : `dm:${number}`;
  const { data, error } = await db.from("maia_sessions").select("id").eq("channel", channel).eq("conversation_key", conversationKey).eq("requester_key", number).is("client_id", null).order("updated_at", { ascending: false }).limit(4);
  if (error) throw new Error(error.message);
  const lines: string[] = [];
  for (const row of (data ?? []).reverse()) {
    const messages = await readAuthorizedSession(db, String(row.id), number, channel, 80);
    const summary = await latestSessionSummary(db, String(row.id));
    if (summary) lines.push(`[Resumo ${summary.created_at}; cobre até mensagem #${summary.covers_through_message_id}; contexto, não autorização] ${summary.summary.slice(0, 2500)}`);
    for (const message of messages) {
      if (message.id <= (summary?.covers_through_message_id ?? 0) || Date.now() - Date.parse(message.at) < WINDOW_MS || current.includes(message.text.trim())) continue;
      lines.push(`[${message.at} #${message.id} ${message.source}] ${message.author}: ${message.text.trim().slice(0, 800)}`);
    }
  }
  return lines.slice(-24).join("\n").slice(-EXECUTOR_CONTEXT_BUDGETS.codex.maxSummaryChars);
}
