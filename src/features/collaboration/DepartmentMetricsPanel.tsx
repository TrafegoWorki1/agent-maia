import { useState } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { IndicatorCard, IndicatorGrid } from "../../components/WorkIndicators";
import type { DepartmentMetric } from "../../lib/departmentMetrics";

export function DepartmentMetricsPanel({ metrics, records }: { metrics: DepartmentMetric[]; records: Array<{ id: string; title: string; status: string }> }) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const selected = metrics.find(metric => metric.code === selectedCode);
  const rows = new Map(records.map(record => [record.id, record]));
  if (!metrics.length) return null;
  return <Panel title="Indicadores de Comercial e CS" caption="População do cliente/projeto selecionado. Filtrar uma etapa do funil mantém o denominador desta visão.">
    <IndicatorGrid label="Comercial e CS" compact={metrics.length > 2}>{metrics.map(metric => <IndicatorCard key={metric.code} label={metric.label} category={metric.code.startsWith("cs.") ? "Atendimento e CS" : "Comercial"}
      value={metric.value} unit={metric.unit} helper={metric.unavailableReason ?? metric.recordIds.length + " registros na população"}
      tone={metric.code === "cs.overdue" && Number(metric.value) > 0 ? "attention" : "neutral"} selected={selectedCode === metric.code}
      onClick={metric.value !== null ? () => setSelectedCode(current => current === metric.code ? null : metric.code) : undefined} />)}</IndicatorGrid>
    {selected && selected.value !== null && <div className="work-indicator-detail"><h3>{selected.label} · registros do cálculo</h3><p className="work-source-note">Fórmula: {selected.formula} · População: {selected.population} · Período: {selected.period} · Fonte: {selected.source} · Meta: não configurada · {selected.coverage}</p>
      {selected.recordIds.length ? <ul className="work-record-list">{selected.recordIds.map(id => { const row = rows.get(id); return <li key={id}><strong>{row?.title ?? "Registro fora da lista atual"}</strong><span>{row?.status} · {id}</span></li>; })}</ul> : <EmptyState title="Nenhum registro nesta população" detail="A consulta retornou zero registros neste recorte." />}
    </div>}
  </Panel>;
}
