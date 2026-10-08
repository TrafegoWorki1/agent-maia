import { kvGet, kvSet, pendingApprovals, readSnapshots, tasksBetween, type Db, type StoredSnapshot } from "./store.ts";

// Avisos proativos da Maia para o dono. Tudo é gerado localmente, a partir do banco e das
// fontes em cache: não consome o plano do Claude. Cada aviso é enviado uma vez por ocorrência.

const SUMMARY_HOUR_BRT = Number(process.env.MAIA_SUMMARY_HOUR ?? 8);
const APPROVAL_ALERT_MIN = 8;
const SOURCES = ["gmail", "meta", "sheets", "calendar"] as const;

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

// Dia e hora no fuso de Brasília (UTC-3, sem horário de verão desde 2019).
export function brtDay(now: Date): string {
  return new Date(now.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

export function brtHour(now: Date): number {
  return new Date(now.getTime() - BRT_OFFSET_MS).getUTCHours();
}

// Início do dia em Brasília, em UTC.
export function brtDayStart(now: Date): Date {
  const day = brtDay(now);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + BRT_OFFSET_MS);
}

function countBy(rows: { status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = (out[row.status] ?? 0) + 1;
  return out;
}

export async function buildDailySummary(db: Db, now = new Date()): Promise<string> {
  const since = brtDayStart(now).toISOString();
  const until = new Date(brtDayStart(now).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const today = (await tasksBetween(db, since, until)).filter((t) => t.kind === "operacional");
  const byStatus = countBy(today);
  const waiting = await pendingApprovals(db);
  const failed = today.filter((t) => t.status === "falhou" || t.status === "incerta");
  const sources = await readSnapshots(db);
  const broken = sources.filter((s) => s.status === "error").map((s) => s.source);

  const lines = [
    `Resumo do dia (${brtDay(now)})`,
    `Tarefas operacionais hoje: ${today.length}`,
    `- Concluídas: ${byStatus.concluida ?? 0} · Em andamento: ${byStatus.em_andamento ?? 0} · Aguardando aprovação: ${byStatus.aguardando_aprovacao ?? 0}`,
    `- Com erro: ${byStatus.falhou ?? 0} · Incertas (reinício): ${byStatus.incerta ?? 0}`,
    `Aprovações em aberto: ${waiting.length}`,
    broken.length ? `Conexões com erro: ${broken.join(", ")}` : "Conexões com erro: nenhuma",
  ];
  if (failed.length) lines.push(`Revisar: ${failed.length} tarefa(s) com erro ou incerta.`);
  return lines.join("\n");
}

// Aviso de conexão só quando muda de estado: ok → erro (alerta) e erro → ok (aviso de volta).
// Na primeira observação, só alerta se já estiver com erro; "ok" inicial não gera aviso.
export function sourceTransitions(previous: Record<string, string>, current: Record<string, string>): { source: string; to: "ok" | "error" }[] {
  const changes: { source: string; to: "ok" | "error" }[] = [];
  for (const source of SOURCES) {
    const before = previous[source] || undefined;
    const now = current[source];
    if (!now || before === now) continue;
    if (before === undefined && now === "ok") continue;
    if (now === "error" || now === "ok") changes.push({ source, to: now });
  }
  return changes;
}

export interface ProactiveSender {
  (text: string): Promise<void>;
}

export async function runProactive(db: Db, send: ProactiveSender, now = new Date()): Promise<void> {
  // Resumo diário: uma vez por dia, a partir da hora configurada.
  if (brtHour(now) >= SUMMARY_HOUR_BRT && (await kvGet(db, "summary:last_day")) !== brtDay(now)) {
    await send(await buildDailySummary(db, now));
    await kvSet(db, "summary:last_day", brtDay(now), now);
  }

  // Conexões: alerta quando uma fonte cai e aviso quando volta.
  const snapshots: Record<string, StoredSnapshot> = Object.fromEntries((await readSnapshots(db)).map((s) => [s.source, s]));
  const current: Record<string, string> = Object.fromEntries(SOURCES.filter((s) => snapshots[s]).map((s) => [s, snapshots[s].status]));
  const previousEntries = await Promise.all(SOURCES.map(async (s) => [s, (await kvGet(db, `source:${s}`)) ?? ""] as const));
  const previous: Record<string, string> = Object.fromEntries(previousEntries.filter(([, v]) => v));
  for (const change of sourceTransitions(previous, current)) {
    const message = change.to === "error"
      ? `Alerta: a conexão ${change.source} está com erro. Veja em Conexões e dados.`
      : `A conexão ${change.source} voltou a funcionar.`;
    await send(message);
    await kvSet(db, `source:${change.source}`, change.to, now);
  }

  // Aprovação parada: lembra o dono quando um pedido de escrita passa de alguns minutos sem resposta.
  for (const approval of await pendingApprovals(db)) {
    const ageMin = (now.getTime() - Date.parse(approval.requested_at)) / 60000;
    const key = `approval:${approval.requested_at}`;
    if (ageMin >= APPROVAL_ALERT_MIN && (await kvGet(db, key)) === null) {
      await send(`Aprovação pendente há ${Math.round(ageMin)} min: ${approval.tool_name}. Responda SIM ou NÃO ao aprovador.`);
      await kvSet(db, key, "sent", now);
    }
  }

  // Gasto do Meta Ads acima do limite configurado (opcional): um aviso por dia.
  const threshold = Number(process.env.MAIA_META_SPEND_ALERT ?? 0);
  const meta = snapshots.meta;
  if (threshold > 0 && meta?.status === "ok" && Array.isArray((meta.data as { accounts?: unknown[] })?.accounts)) {
    const total = (meta.data as { accounts: { spend_7d: number }[] }).accounts.reduce((sum, a) => sum + a.spend_7d, 0);
    if (total > threshold && (await kvGet(db, "meta:spend_alert_day")) !== brtDay(now)) {
      await send(`Alerta: gasto do Meta Ads nos últimos 7 dias chegou a ${total.toFixed(2)}, acima do limite de ${threshold}.`);
      await kvSet(db, "meta:spend_alert_day", brtDay(now), now);
    }
  }
}
