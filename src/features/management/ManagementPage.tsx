import {useMemo,useState} from "react";
import {ArrowRight,RefreshCw} from "lucide-react";
import {PageHeader,Panel} from "../../components/ui";
import {IndicatorCard,IndicatorGrid} from "../../components/WorkIndicators";
import {ManagementChart} from "../../components/ManagementCharts";
import {AnalyticsFilters as FilterControls} from "../../components/AnalyticsFilters";
import {DepartmentAnalytics} from "./DepartmentAnalytics";
import {buildManagementAnalytics,defaultAnalyticsFilters,type AnalyticsFilters} from "../../lib/managementAnalytics";
import {Tasks,useCollaboration} from "../collaboration/CollaborationPage";
export function ManagementPage(){
 const [filters,setFilters]=useState<AnalyticsFilters>(()=>defaultAnalyticsFilters()),[selection,setSelection]=useState<{label:string;ids:number[]}|null>(null);
 const {data,error,loading,stale,reload}=useCollaboration(filters);
 const result=useMemo(()=>data?buildManagementAnalytics(data,filters,new Date(data.generatedAt)):null,[data,filters]);
 if(data&&!data.identity.owner)return <p role="alert">O panorama consolidado exige acesso do proprietário.</p>;
 return <><PageHeader eyebrow="Gestão" title="Panorama da operação" subtitle="Compromissos, capacidade e decisões. Abra um indicador para conferir os registros." action={<button className="button button-outline" disabled={loading} onClick={()=>void reload()}><RefreshCw size={15} aria-hidden="true"/> Atualizar leitura</button>}/>
 {error&&<p role="alert">{error}</p>}{stale&&<p className="management-warning" role="status">Exibindo a última leitura disponível. Atualize antes de decidir.</p>}
 {loading&&!data&&<p role="status">Carregando os registros autorizados…</p>}
 {data&&result&&<>
 <FilterControls data={data} value={filters} onChange={f=>{setFilters(f);setSelection(null);}}/>
 {!result.valid&&<p role="alert">Informe um período válido para calcular compromissos e conclusões.</p>}
 <div className="management-reading"><span>{result.tasks.length} tarefas no recorte</span><span>Leitura em {new Date(data.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</span><a href="#administracao/dados">Conferir fontes e cobertura <ArrowRight size={14} aria-hidden="true"/></a></div>
 <IndicatorGrid label="Indicadores de gestão">{result.metrics.map(m=><IndicatorCard key={m.code} label={m.label} value={m.value} unit={m.unit} category={m.code==="overdue"||m.code==="blocked"||m.code==="decisions"?"Estado atual":"Período selecionado"} helper={m.coverage} tone={(m.code==="overdue"||m.code==="blocked")&&Number(m.value)>0?"attention":"neutral"} onClick={m.ids.length?()=>setSelection({label:m.label,ids:m.ids}):undefined} selected={selection?.label===m.label}/>)}</IndicatorGrid>
 {selection&&<Panel title={selection.label+" — registros do cálculo"} action={<button className="button button-outline" onClick={()=>setSelection(null)}>Fechar registros</button>}><Tasks data={data} items={data.tasks.filter(t=>selection.ids.includes(t.id))} people={data.people} reload={reload}/></Panel>}
 <div className="management-chart-grid">
 <ManagementChart title="Compromissos por vencimento" kind="column" caption="Prazo da baseline quando disponível. As entregas no prazo pertencem à mesma população." rows={result.planChart} primaryLabel="Comprometidas" secondaryLabel="Entregues no prazo" onSelect={ids=>setSelection({label:"Compromissos por vencimento",ids})}/>
 <ManagementChart title="Atrasos por projeto" caption="Trabalho aberto com prazo anterior à leitura atual." rows={result.projectChart} primaryLabel="Atrasadas" onSelect={ids=>setSelection({label:"Atrasos por projeto",ids})}/>
 <ManagementChart title="Trabalho por estado" kind="donut" caption="Estado atual das mesmas tarefas selecionadas nos filtros." rows={result.stateChart} primaryLabel="Tarefas" onSelect={ids=>setSelection({label:"Trabalho por estado",ids})}/>
 <ManagementChart title="Carga e disponibilidade" caption="Esforço das tarefas abertas com prazo no período e capacidade semanal informada. Não há rateio por cliente." rows={result.loadChart} primaryLabel="Esforço estimado" secondaryLabel="Disponibilidade líquida" unit=" h" onSelect={ids=>setSelection({label:"Carga informada",ids})}/>
 </div>
 <details className="management-more"><summary>Evolução, composição por área e revisões</summary><DepartmentAnalytics data={data} tasks={result.tasks} filters={filters} reload={reload}/></details>
 <Panel title="O que precisa de decisão" caption="Atrasos, bloqueios e revisões/aprovações pendentes, por prioridade. São registros observados da operação."><Tasks data={data} items={result.exceptions} people={data.people} reload={reload}/></Panel>
 <div className="management-notes"><p><strong>{result.completed}</strong> conclusões registradas no período. Tempo mediano: {result.cycleMedianDays===null?"indisponível":result.cycleMedianDays.toLocaleString("pt-BR",{maximumFractionDigits:1})+" dias"}; amostra de {result.cycleSample} conclusões com início e fim. P85: {result.cycleP85Days===null?"amostra mínima de sete conclusões":result.cycleP85Days.toLocaleString("pt-BR",{maximumFractionDigits:1})+" dias"}.</p><p>{result.cancelled} compromissos cancelados; {result.addedAfterBaseline} itens adicionados após baseline. {result.loadChart.reduce((s,r)=>s+r.missingEstimates,0)} tarefas da carga sem esforço informado.</p><details><summary>Como os indicadores são calculados</summary>{result.metrics.map(m=><p key={m.code}><strong>{m.label}:</strong> {m.description} {m.coverage}</p>)}<p>Prazo alterado sem baseline não permite recuperar o compromisso original. O estado atual não representa o estado histórico de uma semana passada.</p></details></div>
 </>}
 </>;
}
