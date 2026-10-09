import { isRefreshing } from "./refreshJob.ts";
import { brtDayStart } from "./proactive.ts";
import { fetchLiveGroups } from "./groups.ts";
import { jevView } from "./jev.ts";
import { buildScorecard, isoWeek, isoWeekBounds, previousWeek, type Scorecard } from "./quality.ts";
import {
  approvalsBetween,
  chatRunsBetween,
  eventCountsSince,
  groupActivitySince,
  lastEventAt,
  lastRun,
  ownerMessagesSince,
  pendingApprovals,
  readSnapshots,
  recentTasks,
  taskEventsBetween,
  tasksBetween,
  type Db,
} from "./store.ts";

// Foto do painel. Montada a cada pedido de /api/snapshot: não há cache do lado do painel.
// WhatsApp é consultado ao vivo na Evolution, com tempo limite; se falhar, mostra o erro.

export interface WhatsAppStatus {
  state: string | null;
  error: string | null;
}

async function whatsappStatus(): Promise<WhatsAppStatus> {
  const url = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!url || !instance || !apikey) return { state: null, error: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${url}/instance/connectionState/${instance}`, {
      headers: { apikey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { state: null, error: `Evolution respondeu HTTP ${response.status}` };
    const data = (await response.json()) as { instance?: { state?: string } };
    return { state: data.instance?.state ?? "desconhecido", error: null };
  } catch (error) {
    return { state: null, error: error instanceof Error ? error.message : "falha ao consultar a Evolution" };
  }
}

async function scorecardFor(db: Db, week: string): Promise<Scorecard> {
  const { from, to } = isoWeekBounds(week);
  return buildScorecard(
    {
      tasks: await tasksBetween(db, from, to),
      events: await taskEventsBetween(db, from, to),
      chatRuns: await chatRunsBetween(db, from, to),
      approvals: await approvalsBetween(db, from, to),
      from,
      to,
    },
    week,
  );
}

// Estatísticas das mensagens do dono: só contagens e médias, sem o texto.
async function conversationStats(db: Db, now: Date) {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await ownerMessagesSince(db, since);
  const perDay: Record<string, number> = {};
  const perHour: number[] = Array.from({ length: 24 }, () => 0);
  const perChannel: Record<string, number> = {};
  let words = 0;
  let questions = 0;
  for (const row of rows) {
    const brt = new Date(Date.parse(row.at) - 3 * 60 * 60 * 1000);
    const day = brt.toISOString().slice(0, 10);
    perDay[day] = (perDay[day] ?? 0) + 1;
    perHour[brt.getUTCHours()] += 1;
    perChannel[row.channel] = (perChannel[row.channel] ?? 0) + 1;
    words += row.text.trim().split(/\s+/).length;
    if (row.text.includes("?")) questions += 1;
  }
  return {
    total7d: rows.length,
    averageWords: rows.length ? Math.round((words / rows.length) * 10) / 10 : null,
    questionShare: rows.length ? Math.round((questions / rows.length) * 100) : null,
    perDay,
    perHourBrt: perHour,
    perChannel,
  };
}

export async function buildSnapshot(db: Db, now = new Date()): Promise<Record<string, unknown>> {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Um intervalo que termina um pouco depois de agora, para incluir o que chegou neste instante.
  const nowIso = new Date(now.getTime() + 1).toISOString();
  const publicUrl = process.env.WEBHOOK_PUBLIC_URL ?? null;
  const chatRun = await lastRun(db, "chat");
  const sources = Object.fromEntries((await readSnapshots(db)).map((s) => [s.source, s]));

  const today = brtDayStart(now).toISOString();
  const operationalToday = (await tasksBetween(db, today, nowIso)).filter((t) => t.kind === "operacional");
  const byStatus: Record<string, number> = {};
  for (const task of operationalToday) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;

  const week = isoWeek(now);
  const current = await scorecardFor(db, week);
  const previous = await scorecardFor(db, previousWeek(week));

  // Ocorrências dos últimos 7 dias: tarefas com erro ou incertas, bloqueios e aprovações não decididas.
  const recentWeek = await tasksBetween(db, sevenDaysAgo, nowIso);
  const recentEvents = await taskEventsBetween(db, sevenDaysAgo, nowIso);
  const incidents = [
    ...recentWeek
      .filter((t) => t.status === "falhou" || t.status === "incerta")
      .map((t) => ({ at: t.created_at, kind: t.status, taskId: t.id, summary: t.summary })),
    ...recentEvents
      .filter((e) => e.type === "access_denied" || e.type === "approval_expired" || e.type === "approval_denied")
      .map((e) => ({ at: e.at, kind: e.type, taskId: e.task_id, summary: e.operation ?? e.detail ?? "" })),
    ...current.incidents.map((i) => ({ at: i.timestamp, kind: i.errorCode, taskId: i.taskId, summary: i.operation ?? "" })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: now.toISOString(),
    refreshing: isRefreshing(),
    whatsapp: await whatsappStatus(),
    webhook: {
      host: publicUrl ? publicUrl.replace(/^https?:\/\//, "") : null,
      lastEventAt: await lastEventAt(db),
    },
    events24h: await eventCountsSince(db, since24h),
    chat: chatRun,
    approvals: await pendingApprovals(db),
    sources,
    tasks: {
      today: { total: operationalToday.length, byStatus },
      recent: await recentTasks(db, 20),
    },
    quality: { current, previous: { week: previous.week, overall: previous.overall } },
    incidents: incidents.slice(0, 50),
    conversation: await conversationStats(db, now),
    groups: await groupsView(db, now),
    jev: await jevView(db, now),
  };
}

// Grupos: lista ao vivo da Evolution (com cache) e atividade dos últimos 7 dias. Sem o texto das mensagens.
async function groupsView(db: Db, now: Date) {
  const live = await fetchLiveGroups(now.getTime());
  const activity = new Map((await groupActivitySince(db, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString())).map((a) => [a.jid, a]));
  const groups = live.groups
    .map((g) => ({
      jid: g.jid,
      subject: g.subject,
      size: g.size,
      messages7d: activity.get(g.jid)?.messages ?? 0,
      lastActivity: activity.get(g.jid)?.last_at ?? null,
    }))
    .sort((a, b) => (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "") || a.subject.localeCompare(b.subject));
  return { groups, error: live.error, total: groups.length };
}
