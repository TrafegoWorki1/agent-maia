import { useState } from "react";
import { EmptyState, Panel } from "../../components/ui";
import { IndicatorCard, IndicatorGrid } from "../../components/WorkIndicators";
import type { CollaborationData, Metric } from "../../lib/collaborationApi";
import { DepartmentMetricsPanel } from "./DepartmentMetricsPanel";

const groupNames: Record<string, string> = {
  individual: "Meu trabalho", team: "Equipe e planejamento", creative: "Criação",
  content: "Conteúdo", traffic: "Tráfego", marketing: "Marketing", project: "Projetos",
  projects: "Projetos", finance: "Financeiro", maia: "Maia", commercial: "Comercial", cs: "Atendimento e CS",
};
export function MetricsPanel({ data, direction = false }: { data: CollaborationData; direction?: boolean }) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const metrics = direction ? data.dashboards.direction?.metrics ?? [] : data.metrics;
  const selected = metrics.find(metric => metric.code === selectedCode);
  const groups = new Map<string, Metric[]>();
  for (const metric of metrics) {
    const group = metric.code.split(".")[0];
    const rows = groups.get(group) ?? []; rows.push(metric); groups.set(group, rows);
  }
  const catalog = selected ? data.metricCatalog.find(row => row.code === selected.code) : undefined;
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  function card(metric: Metric, group: string) {
    const metadata = data.metricCatalog.find(row => row.code === metric.code);
    return <IndicatorCard key={metric.code} label={metric.label} value={metric.available ? metric.value : null} unit={metric.unit} category={group}
      helper={metric.available ? metric.recordIds.length + " registros na população · " + String(metadata?.period ?? "Período conforme o cálculo") : metric.unavailableReason ?? "Fonte ainda não disponível"}
      tone={metric.code === "team.blocked_aging" && Number(metric.value) > 0 ? "attention" : "neutral"}
      onClick={metric.available ? () => setSelectedCode(current => current === metric.code ? null : metric.code) : undefined} selected={metric.code === selectedCode} />;
  }
  return <div className="work-metrics-page">
    <div className="work-metrics-heading"><div><span className="eyebrow">{direction ? "VISÃO CONSOLIDADA" : "DADOS DO SEU ESCOPO"}</span><h2>Indicadores para decidir</h2><p>Abra um cartão para conferir a população e a fonte do cálculo.</p></div><span className="work-data-stamp">Leitura em {new Date(data.generatedAt).toLocaleString("pt-BR")}</span></div>
    {[...groups].map(([code, rows]) => {
      const name = direction && code === "individual" ? "Compromissos e trabalho" : groupNames[code] ?? String(data.metricCatalog.find(row => row.code === rows[0].code)?.level ?? "Outros indicadores");
      const available = rows.filter(row => row.available), pending = rows.filter(row => !row.available);
      return <section key={code} className="work-metric-group" aria-label={name}><div className="work-group-heading"><h3>{name}</h3><span>{available.length} de {rows.length} disponíveis</span></div>
        {available.length > 0 && <IndicatorGrid label={name}>{available.map(metric => card(metric, name))}</IndicatorGrid>}
        {pending.length > 0 && <details className="work-pending-metrics"><summary>{pending.length} {pending.length === 1 ? "indicador aguardando dados" : "indicadores aguardando dados"}</summary><IndicatorGrid label={name + " · aguardando dados"}>{pending.map(metric => card(metric, name))}</IndicatorGrid></details>}
      </section>;
    })}
    {selected?.available && <Panel title={selected.label + " · registros do cálculo"} action={<button type="button" onClick={() => setSelectedCode(null)}>Fechar</button>}>
      <p className="work-source-note">Fórmula: {String(catalog?.formula ?? "Consulte o catálogo")} · Período: {String(catalog?.period ?? "Conforme o cálculo")} · Fonte: {String(catalog?.source ?? "work_tasks")} · Meta: {String(catalog?.target ?? "Não configurada")}</p>
      {selected.recordIds.length ? <div className="table-wrap"><table><thead><tr><th>ID</th><th>Registro</th><th>Estado</th></tr></thead><tbody>{selected.recordIds.map(id => { const task = tasks.get(id); return <tr key={id}><td>#{id}</td><td>{task?.title ?? "Registro fora da lista atual"}</td><td>{task?.workflow_status ?? "—"}</td></tr>; })}</tbody></table></div> : <EmptyState title="Nenhum registro nesta população" detail="A consulta completa retornou uma população vazia para este indicador." />}
    </Panel>}
    {!!data.departmentMetrics?.length && <DepartmentMetricsPanel key={data.identity.accessVersion} metrics={data.departmentMetrics} records={data.departmentRecords ?? []} />}
    {!metrics.length && !data.departmentMetrics?.length && <EmptyState title="Nenhum indicador disponível neste escopo" detail="Os indicadores aparecem conforme as fontes e permissões da sua pessoa." />}
    <Panel title="Observações de fontes externas" caption="Origem, período e última coleta acompanham cada observação persistida.">{data.externalMetrics.length ? <div className="table-wrap"><table><thead><tr><th>Métrica</th><th>Valor / unidade</th><th>Período</th><th>Fonte</th><th>Tentativa</th><th>Sucesso / indisponibilidade</th></tr></thead><tbody>{data.externalMetrics.map(row => <tr key={String(row.id)}><td>{String(row.metric_code)}</td><td>{row.value === null ? "Indisponível" : String(row.value) + " " + String(row.unit)}</td><td>{String(row.period_start)} a {String(row.period_end)}</td><td>{String(row.source_name)} · {String(row.source_ref ?? "Sem referência adicional")}</td><td>{String(row.last_attempt_at)}</td><td>{String(row.last_success_at ?? row.unavailable_reason ?? "Sem sucesso")}</td></tr>)}</tbody></table></div> : <EmptyState title="Nenhuma coleta disponível neste escopo" detail="Fontes que exigem conexão ou mapeamento por cliente aguardam sua configuração." />}</Panel>
    <details className="work-pending-metrics"><summary>Consultar fórmulas, fontes e cobertura</summary><Panel title="Catálogo de métricas"><div className="table-wrap"><table><thead><tr><th>Métrica / nível</th><th>Fórmula</th><th>População / período</th><th>Fonte / unidade</th><th>Meta / cobertura</th></tr></thead><tbody>{data.metricCatalog.map(row => <tr key={String(row.code)}><td>{String(row.label)} · {String(row.level)}</td><td>{String(row.formula)}</td><td>{String(row.population)} · {String(row.period)}</td><td>{String(row.source)} · {String(row.unit)}</td><td>{String(row.target ?? "Meta não informada")} · {String(row.coverage_rule)}</td></tr>)}</tbody></table></div></Panel></details>
  </div>;
}
