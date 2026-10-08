// Contrato do painel com o servidor local (/api/snapshot e /api/refresh). Só existe no `pnpm dev`.

export interface SourceResult<T> {
  status: "ok" | "error";
  fetched_at: string;
  data: T | null;
  error: string | null;
}

export interface GmailData {
  unread_count: number;
  unread_last_24h: number;
}

export interface MetaData {
  accounts: { name: string; spend_7d: number; currency: string }[];
}

export interface SheetsData {
  sheets: { name: string; modified_at: string }[];
}

export interface Snapshot {
  generatedAt: string;
  refreshing: boolean;
  whatsapp: { state: string | null; error: string | null };
  webhook: { host: string | null; lastEventAt: string | null };
  events24h: Record<string, number>;
  chat: { started_at: string; status: string; error: string | null } | null;
  approvals: { requested_at: string; tool_name: string }[];
  sources: {
    gmail?: SourceResult<GmailData>;
    meta?: SourceResult<MetaData>;
    sheets?: SourceResult<SheetsData>;
    calendar?: SourceResult<{ calendars: { name: string }[] }>;
  };
  tasks: {
    today: { total: number; byStatus: Record<string, number> };
    recent: TaskRow[];
  };
  quality: { current: Scorecard; previous: { week: string; overall: number | null } };
  groups: { groups: { jid: string; subject: string; size: number | null; messages7d: number; lastActivity: string | null }[]; error: string | null; total: number };
  incidents: { at: string; kind: string; taskId: number | null; summary: string }[];
  conversation: {
    total7d: number;
    averageWords: number | null;
    questionShare: number | null;
    perDay: Record<string, number>;
    perHourBrt: number[];
    perChannel: Record<string, number>;
  };
}

export interface TaskRow {
  id: number;
  created_at: string;
  channel: string;
  kind: string;
  summary: string;
  status: string;
  replied_at: string | null;
}

export interface Scorecard {
  week: string;
  status: "calculado" | "dados insuficientes";
  overall: number | null;
  dimensions: Record<"velocidade" | "precisaoConferencia" | "proatividade" | "gestaoRisco" | "confiabilidadeTecnica" | "comunicacao", number | null>;
  weights: Record<string, number>;
  counts: { tasks: number; terminal: number; replied: number; failures: number; uncertain: number; verified: number; withoutEvidence: number };
  incidents: { taskId: number | null; operation: string | null; errorCode: string; timestamp: string }[];
  criticalCap: number;
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error(`Painel local respondeu HTTP ${response.status}`);
  return (await response.json()) as Snapshot;
}

// Retorna false se já há uma atualização rodando.
export async function requestRefresh(): Promise<boolean> {
  const response = await fetch("/api/refresh", { method: "POST" });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`Não foi possível atualizar (HTTP ${response.status})`);
  return true;
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}
