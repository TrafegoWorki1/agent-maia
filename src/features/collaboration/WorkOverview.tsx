import { useState, type ReactNode } from "react";
import { IndicatorCard, IndicatorGrid, MeasureBar } from "../../components/WorkIndicators";
import { EmptyState, Panel } from "../../components/ui";
import type { CollaborationData, CollaborationTask } from "../../lib/collaborationApi";

const active = (task: CollaborationTask) => !["completed", "cancelled"].includes(task.workflow_status);
export function WorkOverview({ data, tasks, mode, teamId = "", renderRecords }: {
  data: CollaborationData; tasks: CollaborationTask[]; mode: "day" | "team" | "coordination" | "department"; teamId?: string;
  renderRecords: (tasks: CollaborationTask[]) => ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const now = Date.parse(data.generatedAt);
  const overdue = tasks.filter(task => active(task) && task.committed_due_at && Date.parse(task.committed_due_at) < now);
  const upcoming = tasks.filter(task => active(task) && task.committed_due_at && Date.parse(task.committed_due_at) >= now && Date.parse(task.committed_due_at) <= now + 7 * 86400000);
  const blocked = tasks.filter(task => task.workflow_status === "blocked");
  const reviews = tasks.filter(task => task.workflow_status === "review" && (mode !== "day" || task.reviewer_person_id === data.identity.personId));
  const approvals = tasks.filter(task => task.workflow_status === "awaiting_approval" && (mode !== "day" || task.approver_person_id === data.identity.personId));
  const indicators = mode === "coordination" ? [
    { code: "overdue", label: "Prazos vencidos", rows: overdue, tone: "danger" as const, helper: "Trabalho aberto com prazo anterior à leitura" },
    { code: "reviews", label: "Fila de revisão", rows: reviews, helper: "Entregas aguardando revisão interna" },
    { code: "approvals", label: "Fila de aprovação", rows: approvals, helper: "Entregas aguardando decisão" },
    { code: "blocked", label: "Trabalho bloqueado", rows: blocked, tone: "attention" as const, helper: "Itens com impedimento registrado" },
  ] : [
    { code: "upcoming", label: "Próximos prazos", rows: upcoming, helper: "Trabalho aberto com prazo nos próximos 7 dias" },
    { code: "overdue", label: "Prazos vencidos", rows: overdue, tone: "danger" as const, helper: "Trabalho aberto com prazo anterior à leitura" },
    { code: "blocked", label: "Trabalho bloqueado", rows: blocked, tone: "attention" as const, helper: "Itens com impedimento registrado" },
    { code: "decisions", label: mode === "day" ? "Decisões atribuídas" : "Revisões e aprovações", rows: [...reviews, ...approvals], helper: mode === "day" ? "Revisões e aprovações atribuídas a você" : "Entregas aguardando revisão ou aprovação" },
  ];
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(data.generatedAt));
  const plans = new Set(data.plans.filter(plan => plan.period_kind === "weekly" && (!teamId || plan.team_id === teamId) && String(plan.period_start) <= today && String(plan.period_end) >= today).map(plan => String(plan.id)));
  const baselines = data.baselines.filter(row => plans.has(row.plan_id));
  const baselineIds = new Set(baselines.flatMap(row => row.task_snapshots.map(task => task.id)));
  const baseline = tasks.filter(task => baselineIds.has(task.id));
  const completed = baseline.filter(task => task.workflow_status === "completed");
  const addedIds = new Set(data.planItems.filter(item => plans.has(String(item.plan_id)) && item.added_after_baseline).map(item => Number(item.work_task_id)));
  const unplanned = tasks.filter(task => addedIds.has(task.id));
  const selectedIndicator = [...indicators, ...(baselines.length ? [
    { code: "baseline", label: "Compromissos da baseline", rows: baseline },
    { code: "completed", label: "Compromissos concluídos", rows: completed },
    { code: "unplanned", label: "Acrescentados após baseline", rows: unplanned },
  ] : [])].find(row => row.code === selected);
  function select(code: string) {
    setSelected(current => current === code ? null : code);
  }
  return <Panel title={mode === "day" ? "Seu trabalho em foco" : mode === "coordination" ? "Pontos de atenção" : "Panorama do trabalho"} caption={`Recorte autorizado e filtros atuais · leitura em ${new Date(data.generatedAt).toLocaleString("pt-BR")}. Clique para abrir os registros.`}>
    <IndicatorGrid compact label="Resumo do trabalho">{indicators.map(row => <IndicatorCard key={row.code} label={row.label} value={row.rows.length} unit="itens" category={mode === "day" ? "Meu dia" : "Operação"} helper={row.helper} tone={row.rows.length ? row.tone : "neutral"} selected={selected === row.code} onClick={() => select(row.code)} />)}</IndicatorGrid>
    {(mode === "team" || mode === "coordination") && <div className="work-planning-summary">
      <div><h3>Planejado e realizado</h3><p>Baseline semanal preservada · compromissos no recorte atual.</p></div>
      <IndicatorGrid label="Planejamento semanal">
        <IndicatorCard label="Compromissos da baseline" value={baselines.length ? baseline.length : null} unit="itens" category="Planejado" helper={baselines.length ? "Compromissos originais da semana" : "Nenhuma baseline semanal disponível neste recorte"} onClick={baselines.length ? () => select("baseline") : undefined} selected={selected === "baseline"} />
        <IndicatorCard label="Compromissos concluídos" value={baselines.length ? completed.length : null} unit="itens" category="Realizado" helper={baselines.length ? "Concluídos entre os compromissos originais" : "Registre uma baseline para comparar"} onClick={baselines.length ? () => select("completed") : undefined} selected={selected === "completed"} />
        <IndicatorCard label="Acrescentados após baseline" value={baselines.length ? unplanned.length : null} unit="itens" category="Mudança de plano" helper={baselines.length ? "Marcados como acrescentados após o planejamento" : "Nenhuma baseline semanal disponível neste recorte"} onClick={baselines.length ? () => select("unplanned") : undefined} selected={selected === "unplanned"} />
      </IndicatorGrid>
      {baseline.length > 0 && <MeasureBar value={completed.length} total={baseline.length} label={`${completed.length} de ${baseline.length} compromissos da baseline concluídos (${Math.round(completed.length / baseline.length * 100)}%)`} />}
    </div>}
    {selectedIndicator && <div className="work-indicator-detail"><h3>{selectedIndicator.label} · registros</h3>{renderRecords(selectedIndicator.rows)}</div>}
  </Panel>;
}

export function CapacityOverview({ data, personIds }: { data: CollaborationData; personIds?: Set<string> }) {
  const rows = data.load.filter(row => !personIds || personIds.has(row.personId));
  return <div className="collab-load">{rows.length ? rows.map(row => <article key={row.personId} className="work-capacity-card">
    <strong>{data.people.find(person => person.id === row.personId)?.name ?? "Pessoa autorizada"}</strong>
    <span>{row.assigned} compromissos nesta semana</span>
    <div className="work-capacity-value"><strong>{row.utilization === null ? "—" : new Intl.NumberFormat("pt-BR").format(row.utilization) + "%"}</strong><span>da capacidade informada</span></div>
    <span>{row.estimatedHours === null ? "Esforço incompleto" : `${row.estimatedHours.toLocaleString("pt-BR")} h estimadas`} · {row.availableHours === null ? "Disponibilidade não informada" : `${row.availableHours.toLocaleString("pt-BR")} h disponíveis`}</span>
    {row.utilization !== null && row.estimatedHours !== null && row.availableHours !== null ? <MeasureBar value={row.estimatedHours} total={row.availableHours} label={row.utilization > 100 ? `${row.utilization.toLocaleString("pt-BR")}% · acima da disponibilidade informada` : "Esforço estimado / disponibilidade líquida"} attention={row.utilization > 100} /> : <span>{row.unavailableReason ?? "Sem dados suficientes para calcular utilização."}</span>}
  </article>) : <EmptyState title="Capacidade ainda não disponível" detail="Informe disponibilidade, ausências e estimativas em horas no planejamento." />}</div>;
}
