import {useId} from "react";
import type {ChartRow} from "../lib/managementAnalytics";
const n=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1});
export function ManagementChart({title,caption,rows,primaryLabel,secondaryLabel,onSelect,unit=""}:{title:string;caption:string;rows:ChartRow[];primaryLabel:string;secondaryLabel?:string;onSelect?:(ids:number[])=>void;unit?:string}){
 const id=useId(),max=Math.max(1,...rows.flatMap(r=>[r.primary,r.secondary??0]));
 return <section className="management-chart" aria-labelledby={id}><div className="management-chart-heading"><h2 id={id}>{title}</h2><p>{caption}</p></div>
 <div className="management-legend"><span><i/>{primaryLabel}</span>{secondaryLabel&&<span><i className="management-secondary"/>{secondaryLabel}</span>}</div>
 {!rows.length?<p className="management-no-data">Não há registros suficientes neste recorte.</p>:<div className="management-bars">{rows.map(row=><div className="management-chart-row" key={row.key}>
 <button type="button" disabled={!onSelect||!row.ids.length} onClick={()=>onSelect?.(row.ids)} aria-label={`${row.label}: ${primaryLabel} ${n.format(row.primary)}${unit}; ${secondaryLabel??""} ${row.secondary===undefined?"":n.format(row.secondary)+unit}`}><span>{row.label}</span><strong>{n.format(row.primary)}{unit}</strong></button>
 <div className="management-track" aria-hidden="true"><span style={{width:Math.max(0,row.primary/max*100)+"%"}}/>{row.secondary!==undefined&&<span className="management-secondary" style={{width:Math.max(0,row.secondary/max*100)+"%"}}/>}</div>
 {row.secondary!==undefined&&<small>{secondaryLabel}: {n.format(row.secondary)}{unit}</small>}</div>)}</div>}
 <details className="management-chart-table"><summary>Consultar valores em tabela</summary><div className="table-wrap"><table><thead><tr><th>Grupo</th><th>{primaryLabel}</th>{secondaryLabel&&<th>{secondaryLabel}</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.key}><td>{r.label}</td><td>{n.format(r.primary)}{unit}</td>{secondaryLabel&&<td>{r.secondary===undefined?"Indisponível":n.format(r.secondary)+unit}</td>}</tr>)}</tbody></table></div></details></section>;
}
