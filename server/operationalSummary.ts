import { pendingApprovals, readSnapshots, recentTasks, tasksBetween, type Db } from "./store.ts";
import { workTasksView } from "./workTasks.ts";

// Resumo interno a partir dos mesmos registros que alimentam o painel. Não consulta
// WhatsApp/conectores nem interpreta uma resposta da IA como conclusão de trabalho.
export async function operationalSummary(db: Db, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const [tasks, recent, approvals, sources, work] = await Promise.all([
    tasksBetween(db, since, new Date(now.getTime() + 1).toISOString()),
    recentTasks(db, 10),
    pendingApprovals(db),
    readSnapshots(db),
    workTasksView(db, now),
  ]);
  const byStatus: Record<string, number> = {};
  for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
  return {
    consultadoEm: now.toISOString(),
    periodo: { desde: since, ate: now.toISOString() },
    registrosDeExecucao: { total: tasks.length, porStatus: byStatus },
    pedidosRecentes: recent.map((t) => ({ id: t.id, pedido: t.summary, status: t.status, criadoEm: t.created_at, respondidoEm: t.replied_at })),
    aprovacoesPendentes: approvals,
    conexoes: sources.map((s) => ({ fonte: s.source, status: s.status, coletadoEm: s.fetched_at })),
    tarefasComPrazo: true,
    lembretesDeTarefa: true,
    trabalho: work,
    observacao: "Trabalho tem três estados e atraso calculado pelo prazo. Evidência de conclusão é informada, não verificação externa automática. Lembretes privados ao owner dependem do worker ativo. Registros de execução não são tarefas concluídas de trabalho.",
  };
}
