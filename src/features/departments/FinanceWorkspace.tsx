import { PageHeader, Panel } from "../../components/ui";
import { useCollaboration } from "../collaboration/CollaborationPage";
import { MetricsPanel } from "../collaboration/MetricsPanel";

export function FinanceWorkspace({kind}:{kind:"receipts"|"costs"}){
 const {data,error,loading,stale,reload}=useCollaboration();
 const codes=new Set(kind==="receipts"?["finance.received","finance.expected","finance.overdue"]:["finance.costs","finance.expenses"]);
 const catalog=data?.metricCatalog.filter(row=>row.financial===true&&codes.has(String(row.code)))??[];
 const allowedCodes=new Set(catalog.map(row=>String(row.code)));
 return <><PageHeader eyebrow="FINANCEIRO AUTORIZADO" title={kind==="receipts"?"Receitas":"Custos e despesas"} subtitle="Observações persistidas por fonte, período e escopo. Ausência de dado não significa zero."/>
  {loading&&!data&&<p role="status">Carregando fontes autorizadas…</p>}
  {error&&<p role="alert">{error} <button onClick={()=>void reload()}>Tentar novamente</button></p>}
  {stale&&data&&<p role="status">Leitura desatualizada; confira a última coleta de cada fonte.</p>}
  {data&&<><Panel title="Limites da fonte"><p>Atualizar a tela não executa coleta nem ativa integração. Não somamos moedas ou períodos diferentes. {catalog.length?"O catálogo abaixo identifica as fontes esperadas.":"Nenhuma métrica deste tipo está catalogada e autorizada neste escopo."}</p></Panel><MetricsPanel data={{...data,metrics:data.metrics.filter(row=>allowedCodes.has(row.code)),metricCatalog:catalog,externalMetrics:data.externalMetrics.filter(row=>allowedCodes.has(String(row.metric_code))),departmentMetrics:[]}}/></>}
 </>;
}
