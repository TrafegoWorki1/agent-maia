import {useEffect,useState} from "react";
import {Panel} from "../../components/ui";
import {IndicatorCard} from "../../components/WorkIndicators";
import {ManagementChart} from "../../components/ManagementCharts";
import {panelSourcesRequest} from "../../lib/panelSourcesApi";
import {defaultAnalyticsFilters} from "../../lib/managementAnalytics";
import {PANEL_METRICS,type PanelSourceView} from "../../lib/panelSourceModel";
import {COMPARISONS,compareSources,type ComparisonKind} from "../../lib/sourceComparisons";

export function SourceComparisons({kind}:{kind:"finance"|"campaign"|"sales"}){
 const modes:ComparisonKind[]=kind==="finance"?["forecast","cash","margin"]:kind==="campaign"?["cpr","roas"]:["win_rate"];
 const [mode,setMode]=useState<ComparisonKind>(modes[0]),[period,setPeriod]=useState(()=>defaultAnalyticsFilters()),[sources,setSources]=useState<PanelSourceView[]>([]),[ids,setIds]=useState<Record<string,string>>({}),[confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState(""),[loading,setLoading]=useState(false),[details,setDetails]=useState<PanelSourceView[]|null>(null),[now,setNow]=useState(Date.now),[metadataLoading,setMetadataLoading]=useState(true);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{let live=true;void panelSourcesRequest().then(v=>{if(live)setSources(v.sources);}).catch(e=>{if(live)setError(e instanceof Error?e.message:"Falha nas fontes");}).finally(()=>{if(live)setMetadataLoading(false);});return()=>{live=false;};},[]);
 const spec=COMPARISONS[mode],result=details?compareSources(mode,details,period.start,period.end,confirmed,now):null;
 function reset(){setDetails(null);setConfirmed(false);setError("");}
 async function calculate(){setLoading(true);setError("");setDetails(null);try{const results=await Promise.all(spec.codes.map(code=>panelSourcesRequest(undefined,ids[code])));const values=results.flatMap(r=>r.sources);setDetails(values);}catch(e){setError(e instanceof Error?e.message:"Não foi possível conferir as fontes");}finally{setLoading(false);}}
 return <Panel title="Comparações e resultados calculados" caption="Selecione fontes compatíveis. O cálculo consulta os lotes atuais e mantém a referência dos registros originais.">
  <form className="management-filters" onSubmit={e=>{e.preventDefault();void calculate();}}>
   <label>Análise<select value={mode} onChange={e=>{reset();setMode(e.target.value as ComparisonKind);setIds({});}}>{modes.map(m=><option value={m} key={m}>{COMPARISONS[m].label}</option>)}</select></label>
   <label>De<input type="date" required max={period.end} value={period.start} onChange={e=>{reset();setPeriod(p=>({...p,start:e.target.value}));}}/></label>
   <label>Até<input type="date" required min={period.start} value={period.end} onChange={e=>{reset();setPeriod(p=>({...p,end:e.target.value}));}}/></label>
   {spec.codes.map(code=><label key={code}>{PANEL_METRICS[code].label}<select required value={ids[code]??""} onChange={e=>{reset();setIds(p=>({...p,[code]:e.target.value}));}}><option value="">Selecione uma fonte</option>{sources.filter(s=>s.active&&s.metric_code===code).map(s=><option value={s.id} key={s.id}>{s.name} · {s.clientName??"Agência"} · {s.unit}</option>)}</select></label>)}
   <label className="management-coverage"><input type="checkbox" checked={confirmed} onChange={e=>{setDetails(null);setConfirmed(e.target.checked);}}/>Confirmo cobertura completa do período, mesmo escopo e critérios, sem duplicidade entre custos/despesas. Para campanhas, confirmei conta, campanha, objetivo e janela de atribuição iguais.</label>
   <button className="button button-outline" disabled={loading||!confirmed||spec.codes.some(code=>!ids[code])}>{loading?"Conferindo fontes…":"Conferir e calcular"}</button>
  </form>
  {error&&<p role="alert">{error}</p>}
  {result&&!result.available&&<p role="status">{result.reason}</p>}
  {result?.available&&<>
   {mode!=="forecast"&&<IndicatorCard label={spec.label} value={result.value===null?null:result.value.toLocaleString("pt-BR",{maximumFractionDigits:4})} unit={result.unit} helper={mode==="margin"?"(Recebido − custos pagos − despesas pagas) ÷ recebido. Margem de caixa; não equivale a lucro contábil.":mode==="roas"?"Receita atribuída ÷ investimento, com a compatibilidade declarada nas fontes.":mode==="cpr"?"Investimento ÷ resultados do mesmo objetivo.":mode==="win_rate"?"Ganhas ÷ (ganhas + perdidas) no período.":"Recebido − custos pagos − despesas pagas no período."}/>}
   {["forecast","cash","margin","win_rate"].includes(mode)&&<ManagementChart title={mode==="forecast"?"Previsto e recebido por dia":mode==="win_rate"?"Ganhos e perdas por dia":"Fluxo líquido por dia"} kind={mode==="forecast"||mode==="win_rate"?"column":"line"} caption="A população é o período e a cobertura que você confirmou. Valores negativos preservam estornos e saídas líquidas." rows={result.rows} primaryLabel={mode==="forecast"?"Previsto":mode==="win_rate"?"Ganhas":"Fluxo líquido"} secondaryLabel={mode==="forecast"?"Recebido":mode==="win_rate"?"Perdidas":undefined} unit={mode==="win_rate"?"":" "+result.unit.replace("%",details?.[0]?.unit??"")}/>}
   {mode==="roas"&&<ManagementChart title="Investimento e receita atribuída por dia" kind="line" caption="Valores monetários da conta, campanha e atribuição declaradas; o ROAS acima é a razão dos totais do período." rows={result.rows} primaryLabel="Investimento" secondaryLabel="Receita atribuída" unit={" "+details![0].unit}/>}
   {mode==="cpr"&&<div className="management-chart-grid"><ManagementChart title="Investimento por dia" kind="line" caption="Valores monetários da fonte selecionada." rows={result.rows.map(r=>({...r,secondary:undefined}))} primaryLabel="Investimento" unit={" "+details!.find(s=>s.metric_code==="campaign.spend")!.unit}/><ManagementChart title="Resultados por dia" kind="line" caption="Contagens do mesmo objetivo; não compartilha escala com dinheiro." rows={result.rows.map(r=>({...r,primary:r.secondary??0,secondary:undefined}))} primaryLabel="Resultados" unit=" registros"/></div>}
   <div className="table-wrap"><table><thead><tr><th>Componente</th><th>Total no período</th><th>Fonte / lote</th><th>Critério / cobertura</th></tr></thead><tbody>{spec.codes.map((code,i)=>{const source=details!.find(s=>s.metric_code===code)!;return <tr key={code}><th>{PANEL_METRICS[code].label}</th><td>{result.totals[i].toLocaleString("pt-BR")} {source.unit}</td><td>{source.name} · {source.success?.id}<br/><a href={"https://docs.google.com/spreadsheets/d/"+encodeURIComponent(source.source_ref)} target="_blank" rel="noreferrer">Abrir origem</a></td><td>{source.basis} · {source.coverage}</td></tr>;})}</tbody></table></div>
   <details><summary>Identificadores dos registros do cálculo</summary>{details!.map(s=><SourceRecordKeys key={s.id} source={s} start={period.start} end={period.end}/>)}</details>
  </>}
  {!metadataLoading&&!error&&!sources.some(s=>s.active&&PANEL_METRICS[s.metric_code].kind===kind)&&<p>Nenhuma fonte real configurada para estas comparações. Cadastre em <a href="#administracao/dados">Fontes gerenciais</a>.</p>}
 </Panel>;
}
function SourceRecordKeys({source,start,end}:{source:PanelSourceView;start:string;end:string}){
 const [page,setPage]=useState(0),rows=(source.success?.observations??[]).filter(r=>r.date>=start&&r.date<=end),pages=Math.max(1,Math.ceil(rows.length/100)),safe=Math.min(page,pages-1);
 return <div><h3>{source.name} · {rows.length} registros</h3><div className="table-wrap"><table><thead><tr><th>ID na origem</th><th>Data</th><th>Valor ({source.unit})</th></tr></thead><tbody>{rows.slice(safe*100,(safe+1)*100).map(r=><tr key={r.key}><td>{r.key}</td><td>{r.date}</td><td>{r.value.toLocaleString("pt-BR")}</td></tr>)}</tbody></table></div>{pages>1&&<div className="management-reading"><button disabled={!safe} onClick={()=>setPage(safe-1)}>Anterior</button><span>Página {safe+1} de {pages}</span><button disabled={safe+1>=pages} onClick={()=>setPage(safe+1)}>Próxima</button></div>}</div>;
}
