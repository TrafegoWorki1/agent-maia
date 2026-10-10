import { buildScorecard, isoWeek, isoWeekBounds } from "../server/quality.ts";
import { approvalsBetween, chatRunsBetween, getDb, taskEventsBetween, tasksBetween } from "../server/store.ts";

// Auditoria somente leitura do mesmo cálculo usado pelo painel. Nunca chama os
// modelos, envia mensagens ou corrige o histórico do banco.
const now = new Date();
const week = process.argv[2] ?? isoWeek(now);
const { from, to } = isoWeekBounds(week);
const db = getDb();
const [tasks, events, chatRuns, approvals] = await Promise.all([
  tasksBetween(db, from, to), taskEventsBetween(db, from, to), chatRunsBetween(db, from, to), approvalsBetween(db, from, to),
]);
console.log(JSON.stringify({ observedAt: now.toISOString(), scorecard: buildScorecard({ tasks, events, chatRuns, approvals, from, to }, week) }, null, 2));
