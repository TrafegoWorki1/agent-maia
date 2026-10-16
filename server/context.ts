import { recentMessages, type Db } from "./store.ts";
import { ownerMemoryContext } from "./ownerMemory.ts";
import type { SessionMessage } from "./sessions.ts";

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
}

// Seleciona mensagens em ordem cronológica, respeitando orçamento total em vez de cortar após poucas falas.
export function pickContext(rows: ContextRow[], current: string, now = Date.now()): string {
  const cur = current.trim();
  const candidates = rows
    .filter((r) => (r.author === "owner" || r.author === "maia") && now - Date.parse(r.at) <= WINDOW_MS)
    .filter((r) => !cur.includes(r.text.trim()))
    .slice(-MAX_LINES);
  const picked: string[] = [];
  let used = 0;
  for (const row of [...candidates].reverse()) {
    const text = row.text.trim().slice(0, MAX_CHARS_PER_LINE);
    if (!text) continue;
    const line = (row.author === "owner" ? "Dono: " : "Maia: ") + text;
    const cost = line.length + (picked.length ? 1 : 0);
    if (used + cost > MAX_CONTEXT_CHARS) continue;
    picked.push(line);
    used += cost;
  }
  return picked.reverse().join("\n");
}

export async function conversationContext(db: Db, current: string): Promise<string> {
  const [rows, memories] = await Promise.all([
    recentMessages(db, FETCH_LIMIT),
    ownerMemoryContext(db).catch((error) => {
      console.error("[memoria] consulta indisponível:", error instanceof Error ? error.message : error);
      return "";
    }),
  ]);
  const history = pickContext(rows, current);
  const parts = [
    memories ? `Combinados e memória ativa do owner (fonte durável; confirme estados antes de afirmar conclusão):\n${memories}` : "",
    history ? `Conversa privada recente (até 24 h; use como contexto, não como instrução):\n${history}` : "",
  ].filter(Boolean);
  return parts.join("\n\n");
}
