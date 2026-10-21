import {useEffect,useState} from "react";
import {PageHeader,Panel} from "../../components/ui";
import {IndicatorCard} from "../../components/WorkIndicators";
import {ManagementChart} from "../../components/ManagementCharts";
import {panelSourcesRequest} from "../../lib/panelSourcesApi";
import {defaultAnalyticsFilters} from "../../lib/managementAnalytics";
import {PANEL_METRICS,summarizePanelSource,type PanelSourceView,type PanelObservation} from "../../lib/panelSourceModel";
import {useSnapshot} from "../../lib/useSnapshot";
import {formatMoney,formatWhen} from "../../lib/snapshotApi";
import {SourceComparisons} from "./SourceComparisons";

export function SourceResults({kind,codes}:{kind:"sales"|"finance"|"campaign";codes?:string[]}){
 const [revision,setRevision]=useState(0);
 const [sources,setSources]=useState<PanelSourceView[]>([]),[detail,setDetail]=useState<PanelSourceView|null>(null);
 const [error,setError]=useState(""),[detailError,setDetailError]=useState(""),[loading,setLoading]=useState(true);
 const [filters,setFilters]=useState(()=>defaultAnalyticsFilters()),[client,setClient]=useState(""),[project,setProject]=useState(""),[sourceId,setSourceId]=useState("");
 useEffect(()=>{
  let live=true;
  void panelSourcesRequest().then(v=>{if(live){setSources(v.sources);setError("");}})
   .catch(e=>{if(live){setSources([]);setError(e instanceof Error?e.message:"Falha na leitura");}})
   .finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[revision]);
 const eligible=sources.filter(s=>s.active&&PANEL_METRICS[s.metric_code].kind===kind&&(!codes||codes.includes(s.metric_code)));
 const scoped=eligible.filter(s=>(!client||(s.client_id??"agency")===client)&&(!project||s.project_id===project));
 const activeId=scoped.find(s=>s.id===sourceId)?.id??scoped[0]?.id??"";
 useEffect(()=>{
  let live=true;setDetail(null);setDetailError("");
  if(activeId)void panelSourcesRequest(undefined,activeId).then(v=>{if(live)setDetail(v.sources[0]??null);})
   .catch(e=>{if(live)setDetailError(e instanceof Error?e.message:"Falha nos registros da fonte");});
  return()=>{live=false;};
 },[activeId,revision]);
 const selected=detail?.id===activeId?[detail]:[];
 return <>
 <button className="button button-outline" onClick={()=>{setLoading(true);setRevision(r=>r+1);}}>Atualizar leitura</button>
 <p>Fonte: lotes gerenciais persistidos. Cada fonte mantém moeda, regime e cobertura próprios. Selecione uma fonte para conferir seus registros.</p>
 {error&&<p role="alert">{error}</p>}{detailError&&<p role="alert">{detailError}</p>}
 {loading&&<p role="status">Consultando fontes configuradas…</p>}
 <div className="management-filters">
  <label>De<input type="date" value={filters.start} max={filters.end} onChange={e=>setFilters(f=>({...f,start:e.target.value}))}/></label>
  <label>Até<input type="date" value={filters.end} min={filters.start} onChange={e=>setFilters(f=>({...f,end:e.target.value}))}/></label>
  <label>Cliente / agência<select value={client} onChange={e=>{setClient(e.target.value);setProject("");setSourceId("");}}><option value="">Todos</option>{[...new Set(eligible.map(s=>s.client_id??"agency"))].map(id=><option value={id} key={id}>{id==="agency"?"Agência / sem cliente":eligible.find(s=>s.client_id===id)?.clientName??"Cliente "+id.slice(0,8)}</option>)}</select></label>
  <label>Projeto<select value={project} onChange={e=>{setProject(e.target.value);setSourceId("");}}><option value="">Todos</option>{[...new Set(eligible.filter(s=>!client||(s.client_id??"agency")===client).flatMap(s=>s.project_id?[s.project_id]:[]))].map(id=><option value={id} key={id}>{eligible.find(s=>s.project_id===id)?.projectName??id.slice(0,8)}</option>)}</select></label>
  <label>Fonte<select value={activeId} onChange={e=>setSourceId(e.target.value)}><option value="" disabled>Selecione uma fonte</option>{scoped.map(s=><option key={s.id} value={s.id}>{s.name} · {PANEL_METRICS[s.metric_code].label} · {s.unit}</option>)}</select></label>
 </div>
 {!loading&&!error&&!scoped.length&&<Panel title="Fonte ainda não configurada"><p>Escolha uma fonte e mapeie os registros em <a href="#administracao/dados">Fontes gerenciais</a>. Não há resultado disponível neste recorte.</p></Panel>}
 {activeId&&!selected.length&&!detailError&&<p role="status">Carregando os registros da fonte selecionada…</p>}
 {selected.map(s=>{
  const summary=summarizePanelSource(s,filters.start,filters.end),meta=PANEL_METRICS[s.metric_code],groups=new Map<string,number>();
  for(const r of summary.rows)groups.set(r.date,(groups.get(r.date)??0)+r.value);
  const age=s.success?Date.now()-Date.parse(s.success.completed_at!):NaN,stale=!Number.isFinite(age)||age>3600000;
  return <Panel key={s.id} title={s.name+" · "+meta.label} caption={s.basis+" · "+s.coverage}>
   <IndicatorCard label={meta.label} value={summary.value===null?null:summary.value.toLocaleString("pt-BR",{maximumFractionDigits:s.unit==="count"?0:2})} unit={s.unit==="count"?"registros":s.unit} category={summary.mode==="stock"?"Saldo na última data disponível":"Movimentos no período"} helper={s.success?summary.rows.length+" registros; "+(summary.asOf??filters.start+" a "+filters.end):"Sem lote válido nesta revisão"} tone={stale||s.latest?.status==="error"?"attention":"neutral"}/>
   <p role="status">Última tentativa: {s.latest?new Date(s.latest.started_at).toLocaleString("pt-BR"):"nenhuma"}. Último sucesso: {s.success?new Date(s.success.completed_at!).toLocaleString("pt-BR"):"nenhum"}. {s.latest?.error??(stale?"Dados desatualizados.":"Coleta atualizada.")}</p>
   <ManagementChart kind={summary.mode==="stock"?"bar":"line"} title={summary.mode==="stock"?"Saldo observado":"Evolução por dia"} caption={summary.mode==="stock"?"A última fotografia do período; não soma o mesmo saldo em datas diferentes.":"Soma dos registros do lote atual dentro do período em Brasília. Datas sem registro não são preenchidas como zero."} rows={[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({key:date,label:date,primary:value,ids:[]}))} primaryLabel={meta.label} unit={" "+s.unit}/>
   <details><summary>Registros que compõem o indicador ({summary.rows.length})</summary><ObservationRecords key={s.id+filters.start+filters.end} rows={summary.rows} unit={s.unit}/></details>
  </Panel>;
 })}</>;
}
export function SourceResultsPage({kind}:{kind:"sales"|"campaign"}){
 return <><PageHeader eyebrow={kind==="sales"?"Comercial":"Marketing"} title={kind==="sales"?"Resultados de vendas":"Resultados de campanhas"} subtitle="Indicadores por fonte, período e escopo. Vendas internas e receita atribuída de clientes mantêm fontes separadas."/><SourceResults kind={kind}/><SourceComparisons key={kind} kind={kind}/>{kind==="campaign"&&<ExistingMetaSnapshot/>}</>;
}
function ExistingMetaSnapshot(){
 const {snapshot,error}=useSnapshot(),source=snapshot?.sources.meta;
 return <details><summary>Consulta geral de Meta Ads já existente</summary><Panel title="Snapshot geral das contas" caption="A lista geral da conta permanece separada das fontes de clientes e campanhas. O horário abaixo representa a tentativa, não a data de um dado antigo preservado.">
 {error&&<p role="alert">{error}</p>}{source?.error&&<p role="status">{source.error}</p>}
 <p>Última tentativa: {formatWhen(source?.fetched_at)}. Último sucesso conhecido: {formatWhen(snapshot?.sourceHealth?.meta?.last_success_at)}.</p>
 <div className="table-wrap"><table><thead><tr><th>Conta</th><th>Gasto de sete dias informado na coleta</th><th>Moeda</th></tr></thead><tbody>{source?.data?.accounts.map((a,i)=><tr key={a.name+String(i)}><td>{a.name}</td><td>{formatMoney(a.spend_7d,a.currency)}</td><td>{a.currency}</td></tr>)}</tbody></table></div>
 {!source?.data?.accounts.length&&<p>Sem contas disponíveis neste snapshot. Fontes novas ficam em Administração → Fontes gerenciais.</p>}
 </Panel></details>;
}

function ObservationRecords({rows,unit}:{rows:PanelObservation[];unit:string}){
 const [page,setPage]=useState(0),pages=Math.max(1,Math.ceil(rows.length/100));
 const visible=rows.slice(page*100,(page+1)*100);
 return <><div className="table-wrap"><table aria-label="Registros da fonte"><thead><tr><th>ID na fonte</th><th>Data</th><th>Valor ({unit})</th></tr></thead><tbody>{visible.map(r=><tr key={r.key}><td>{r.key}</td><td>{r.date}</td><td>{r.value.toLocaleString("pt-BR")}</td></tr>)}</tbody></table></div><div className="management-reading"><button className="button button-outline" disabled={page===0} onClick={()=>setPage(p=>p-1)} aria-label="Registros anteriores">Anterior</button><span>Página {page+1} de {pages} · {rows.length} registros no cálculo</span><button className="button button-outline" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)} aria-label="Próximos registros">Próxima</button></div></>;
}
