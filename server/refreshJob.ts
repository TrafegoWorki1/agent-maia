import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { isReadTool } from "./approvalPolicy.ts";
import { finishRun, readSnapshots, saveSnapshot, startRun, type Db, type SourceId } from "./store.ts";

// Atualização periódica das fontes (Gmail, Meta Ads, Sheets) pelo Agent SDK, com as conexões
// MCP desta conta. Só ferramentas de leitura. Cada fonte exige um JSON com formato fixo: se a
// resposta não bater com o formato, o painel mostra erro, nunca um número inventado.

// Teto por fonte. Cada consulta carrega o contexto de todos os conectores MCP, por isso o
// modelo é o Haiku e cada fonte só recebe as ferramentas de leitura que precisa.
const MAX_BUDGET_USD = 0.5;
const MAX_TURNS = 8;
const INTERVAL_MS = 30 * 60 * 1000;
const MODEL = "haiku";

const JSON_RULE =
  'Responda SOMENTE com um bloco JSON, sem texto fora dele. Use apenas leituras, nunca altere nada. Se não conseguir consultar, responda {"error": "motivo curto"}.';

type Validator = (value: Record<string, unknown>) => unknown;

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const SOURCES: Record<SourceId, { prompt: string; tools: string[]; validate: Validator }> = {
  gmail: {
    prompt: `Consulte o Gmail com a busca "is:unread" e conte os resultados (até 100). Depois conte os que chegaram nas últimas 24 horas com a busca "is:unread newer_than:1d". Não inclua remetentes, assuntos nem conteúdo. Formato: {"unread_count": number, "unread_last_24h": number}. ${JSON_RULE}`,
    tools: ["mcp__claude_ai_Gmail__search_threads"],
    validate: (v) => {
      if (!isCount(v.unread_count) || !isCount(v.unread_last_24h)) throw new Error("formato inesperado");
      return { unread_count: v.unread_count, unread_last_24h: v.unread_last_24h };
    },
  },
  meta: {
    prompt: `Consulte o Meta Ads desta conta: liste as contas de anúncio e o gasto total dos últimos 7 dias em cada uma. Formato: {"accounts": [{"name": string, "spend_7d": number, "currency": string}]}. ${JSON_RULE}`,
    tools: ["mcp__claude_ai_Meta_ADS__ads_get_ad_accounts", "mcp__claude_ai_Meta_ADS__ads_insights_performance_trend"],
    validate: (v) => {
      if (!Array.isArray(v.accounts)) throw new Error("formato inesperado");
      return {
        accounts: v.accounts.map((a) => {
          const item = a as Record<string, unknown>;
          if (typeof item.name !== "string" || typeof item.spend_7d !== "number" || typeof item.currency !== "string") throw new Error("conta fora do formato");
          return { name: item.name, spend_7d: item.spend_7d, currency: item.currency };
        }),
      };
    },
  },
  sheets: {
    prompt: `Liste as 5 planilhas do Google Drive modificadas mais recentemente, somente nome e data de modificação. Não leia o conteúdo das células. Formato: {"sheets": [{"name": string, "modified_at": string}]}. ${JSON_RULE}`,
    tools: ["mcp__claude_ai_Google_Drive__list_recent_files", "mcp__claude_ai_Google_Drive__search_files"],
    validate: (v) => {
      if (!Array.isArray(v.sheets)) throw new Error("formato inesperado");
      return {
        sheets: v.sheets.map((s) => {
          const item = s as Record<string, unknown>;
          if (typeof item.name !== "string" || typeof item.modified_at !== "string") throw new Error("planilha fora do formato");
          return { name: item.name, modified_at: item.modified_at };
        }),
      };
    },
  },
  calendar: {
    prompt: `Liste os calendários do Google Agenda desta conta, somente o nome de cada um. Não leia eventos. Formato: {"calendars": [{"name": string}]}. ${JSON_RULE}`,
    tools: ["mcp__claude_ai_Google_Calendar__list_calendars"],
    validate: (v) => {
      if (!Array.isArray(v.calendars)) throw new Error("formato inesperado");
      return {
        calendars: v.calendars.map((c) => {
          const item = c as Record<string, unknown>;
          if (typeof item.name !== "string") throw new Error("calendário fora do formato");
          return { name: item.name };
        }),
      };
    },
  },
};

// Cada fonte só usa as próprias ferramentas de leitura listadas em SOURCES.
function permissionFor(source: SourceId): CanUseTool {
  return async (toolName, input) =>
    isReadTool(toolName) && SOURCES[source].tools.includes(toolName)
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Atualização somente leitura, com ferramentas desta fonte." };
}

// Pega o primeiro objeto JSON do texto da resposta.
export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("resposta sem JSON");
  const value = JSON.parse(text.slice(start, end + 1)) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("resposta sem JSON");
  return value as Record<string, unknown>;
}

async function runSource(db: Db, source: SourceId): Promise<void> {
  const runId = await startRun(db, `refresh:${source}`);
  let costUsd: number | null = null;
  try {
    const run = query({
      prompt: SOURCES[source].prompt,
      options: {
        systemPrompt: "Você atualiza o painel da Maia com dados de leitura. Nunca execute ações.",
        model: MODEL,
        maxTurns: MAX_TURNS,
        maxBudgetUsd: MAX_BUDGET_USD,
        persistSession: false,
        canUseTool: permissionFor(source),
        // Só os conectores do claude.ai: sem configurações locais, sem servidores MCP do computador.
        settingSources: [],
        disallowedTools: ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"],
        cwd: process.cwd(),
        env: { ...process.env },
      },
    });
    let text = "";
    for await (const message of run) {
      if (message.type === "result") {
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? null;
        if (message.is_error || message.subtype !== "success") throw new Error(`Agent SDK falhou (${message.subtype})`);
        text = message.result;
        break;
      }
    }
    const parsed = parseJsonObject(text);
    if (typeof parsed.error === "string") throw new Error(parsed.error);
    await saveSnapshot(db, source, { status: "ok", data: SOURCES[source].validate(parsed) });
    await finishRun(db, runId, "ok", costUsd, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveSnapshot(db, source, { status: "error", error: message });
    await finishRun(db, runId, "error", costUsd, message);
  }
}

let running = false;

export function isRefreshing(): boolean {
  return running;
}

// Atualiza as três fontes em sequência. Não roda duas vezes ao mesmo tempo.
export async function refreshAll(db: Db): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    for (const source of Object.keys(SOURCES) as SourceId[]) await runSource(db, source);
    return true;
  } finally {
    running = false;
  }
}

// Ao subir, atualiza só se o último dado tiver mais de 30 minutos. Depois, a cada 30 minutos.
export function scheduleRefresh(db: Db): () => void {
  const isStale = async (): Promise<boolean> => {
    const snapshots = await readSnapshots(db);
    if (snapshots.length < Object.keys(SOURCES).length) return true;
    return snapshots.some((s) => Date.now() - Date.parse(s.fetched_at) > INTERVAL_MS);
  };
  const tick = () => {
    void (async () => {
      if (await isStale()) await refreshAll(db);
    })().catch((error) => console.error("[refresh]", error instanceof Error ? error.message : error));
  };
  const first = setTimeout(tick, 20_000);
  const timer = setInterval(tick, INTERVAL_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
