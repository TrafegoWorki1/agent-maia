// Ferramentas estáveis da Maia para Meta Ads pela API Zernio.
// A credencial permanece no servidor; as ferramentas expostas aqui são somente leitura.
import type { Db } from "../store.ts";
import { zernioGet, ZernioError } from "./zernio.ts";

type Connection = { id: string; name: string };
type AdAccount = { accountId: string; adAccountId: string; name: string; currency: string | null; accountStatus: unknown; selectable: boolean; unusableReason: string | null };

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function items(value: unknown, key: string): Record<string, unknown>[] {
  const rows = object(value)[key];
  return Array.isArray(rows) ? rows.map(object) : [];
}
function isEnabled(row: Record<string, unknown>): boolean {
  return row.isActive !== false && row.enabled !== false && row.needsReconnection !== true;
}

async function connections(): Promise<Connection[]> {
  const rows = items(await zernioGet("/accounts"), "accounts");
  return rows.filter(row => row.platform === "metaads" && isEnabled(row)).map(row => ({
    id: String(row._id ?? row.id ?? ""),
    name: String(row.displayName ?? row.name ?? "Meta Ads"),
  })).filter(row => row.id);
}

async function accountRows(connection: Connection): Promise<AdAccount[]> {
  const rows = items(await zernioGet("/ads/accounts", { accountId: connection.id }), "accounts");
  return rows.map(row => {
    const adAccountId = String(row.id ?? row.accountId ?? "");
    return {
      accountId: connection.id,
      adAccountId,
      name: String(row.name ?? adAccountId),
      currency: typeof row.currency === "string" ? row.currency : null,
      accountStatus: row.accountStatus ?? null,
      selectable: row.selectable !== false,
      unusableReason: typeof row.unusableReason === "string" ? row.unusableReason : null,
    };
  }).filter(row => row.adAccountId);
}

export class MetaAdsMcpError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function normalizeMcpAccountId(value: string): string {
  const clean = value.trim();
  if (!/^(?:act_)?\d{5,30}$/.test(clean)) throw new MetaAdsMcpError("ID da conta de anúncios inválido");
  return clean.startsWith("act_") ? clean : `act_${clean}`;
}

export function buildMcpInsightsParams(input: { since: string; until: string; level?: "account" | "campaign" | "adset" | "ad" }): { ok: true; params: Record<string, string> } | { ok: false; error: string } {
  const since = Date.parse(`${input.since}T00:00:00Z`), until = Date.parse(`${input.until}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.since) || !/^\d{4}-\d{2}-\d{2}$/.test(input.until) || !Number.isFinite(since) || !Number.isFinite(until) || new Date(since).toISOString().slice(0, 10) !== input.since || new Date(until).toISOString().slice(0, 10) !== input.until) return { ok: false, error: "período inválido; use AAAA-MM-DD" };
  if (until < since) return { ok: false, error: "fim do período anterior ao início" };
  if (until - since > 730 * 86_400_000) return { ok: false, error: "período maior que 730 dias" };
  return { ok: true, params: { since: input.since, until: input.until, level: input.level ?? "account" } };
}

export async function getZernioMetaAdsStatus(): Promise<{ connected: boolean; detail: string; accountCount: number }> {
  const linked = await connections();
  if (!linked.length) return { connected: false, detail: "Nenhuma conexão Meta Ads ativa no Zernio", accountCount: 0 };
  const rows = (await Promise.all(linked.map(accountRows))).flat();
  return { connected: true, detail: `${linked.length} conexão(ões) Zernio; ${rows.length} conta(s) de anúncios acessíveis`, accountCount: rows.length };
}

export async function listMcpAdAccounts(_db: Db): Promise<unknown> {
  const linked = await connections();
  const accounts = (await Promise.all(linked.map(accountRows))).flat();
  return { accounts };
}

async function resolveAccount(adAccountId: string): Promise<{ connection: Connection; adAccountId: string }> {
  const normalized = normalizeMcpAccountId(adAccountId);
  const linked = await connections();
  for (const connection of linked) {
    const rows = await accountRows(connection);
    const found = rows.find(row => normalizeMcpAccountId(row.adAccountId) === normalized);
    if (found && !found.selectable) throw new MetaAdsMcpError(`A conta ${found.name} não pode ser consultada: ${found.unusableReason ?? "a Meta/Zernio marcou a conta como não selecionável"}`, 403);
    if (found) return { connection, adAccountId: found.adAccountId };
  }
  throw new MetaAdsMcpError("A conta de anúncios não está acessível pela conexão Meta Ads do Zernio", 404);
}

export async function listMcpCampaigns(_db: Db, accountId: string, limit = 50): Promise<unknown> {
  const { connection, adAccountId } = await resolveAccount(accountId);
  const bounded = Math.min(100, Math.max(1, Math.trunc(limit)));
  return zernioGet("/ads/tree", { accountId: connection.id, adAccountId, limit: bounded });
}

export async function getMcpInsights(_db: Db, input: { accountId: string; since: string; until: string; level?: "account" | "campaign" | "adset" | "ad" }): Promise<unknown> {
  const built = buildMcpInsightsParams(input);
  if (!built.ok) throw new MetaAdsMcpError(built.error);
  const { connection, adAccountId } = await resolveAccount(input.accountId);
  return zernioGet("/ads/insights", {
    accountId: connection.id,
    objectId: adAccountId,
    level: built.params.level,
    fromDate: built.params.since,
    toDate: built.params.until,
    limit: 500,
  });
}

export function isMetaAdsNotConfigured(error: unknown): boolean {
  return error instanceof ZernioError && error.status === 0;
}
