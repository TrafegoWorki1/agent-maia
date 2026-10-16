import { Panel } from "../../components/ui";
import type { DepartmentMetric } from "../../lib/departmentMetrics";
export function DepartmentMetricsPanel({metrics,records}:{metrics:DepartmentMetric[];records:Array<{id:string;title:string;status:string}>}){
 return <Panel title="Indicadores de Comercial e CS" caption="Cada valor abre a população usada no cálculo. Ausência de denominador não vira zero.">{metrics.map(metric=><details key={metric.code}><summary>{metric.label}: {metric.value===null?"Indisponível":`${metric.value} ${metric.unit}`}</summary><p>{metric.unavailableReason}</p><p>Fórmula: {metric.formula} · População: {metric.population} · Período: {metric.period} · Fonte: {metric.source} · Meta: não configurada · {metric.coverage}</p><ul>{metric.recordIds.map(id=>{const row=records.find(record=>record.id===id);return <li key={id}>{row?.title??"Registro autorizado"} · {row?.status} · {id}</li>;})}</ul></details>)}</Panel>;
}
