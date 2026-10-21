import {useId,useState,type KeyboardEvent} from "react";
import type {ChartRow} from "../lib/managementAnalytics";
export type ChartKind="bar"|"column"|"line"|"donut"|"stacked";
const n=new Intl.NumberFormat("pt-BR",{maximumFractionDigits:6});
const colors=["var(--blue)","var(--gold)","var(--chart-green)","var(--chart-red)","var(--chart-purple)","var(--chart-cyan)","var(--chart-neutral)"];
const semantic:Record<string,string>={pending:colors[6],in_progress:colors[0],review:colors[4],awaiting_approval:colors[1],blocked:colors[3],completed:colors[2],cancelled:colors[6],accepted:colors[0],delivered:colors[2],read:colors[1],played:colors[4],failed:colors[3],Pendente:colors[6],"Em execução":colors[0],"Em revisão":colors[4],"Em aprovação":colors[1],Bloqueado:colors[3],Concluído:colors[2],Cancelado:colors[6]};
const color=(key:string,i:number)=>semantic[key]??colors[i%colors.length];

export function ManagementChart({title,caption,rows,primaryLabel,secondaryLabel,onSelect,unit="",kind="bar"}:{title:string;caption:string;rows:ChartRow[];primaryLabel:string;secondaryLabel?:string;onSelect?:(ids:number[])=>void;unit?:string;kind?:ChartKind}){
 const id=useId(),[page,setPage]=useState(0),segmentLabels=[...new Set(rows.flatMap(r=>r.segments?.map(s=>s.label)??[]))];
 const labels=kind==="stacked"?segmentLabels:[primaryLabel,...(secondaryLabel?[secondaryLabel]:[])];
 const values=rows.flatMap(r=>kind==="stacked"?[r.segments?.reduce((s,v)=>s+v.value,0)??r.primary]:[r.primary,...(r.secondary===undefined?[]:[r.secondary])]);
 const low=Math.min(0,...values),ceiling=Math.max(0,...values),high=ceiling===low?low+1:ceiling,span=high-low;
 const active=(ids:number[])=>!!onSelect&&ids.length>0;
 const select=(ids:number[])=>{if(active(ids))onSelect?.(ids);};
 const fmt=(v:number)=>n.format(v)+unit;
 const a11y=(row:ChartRow)=>`${row.label}: ${primaryLabel} ${fmt(row.primary)}${row.secondary===undefined?"":`; ${secondaryLabel} ${fmt(row.secondary)}`}`;
 const interactive=(ids:number[])=>({role:active(ids)?"button":undefined,tabIndex:active(ids)?0:undefined,onClick:()=>select(ids),onKeyDown:(e:KeyboardEvent)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(ids);}}});
 const width=Math.max(680,Math.min(2400,rows.length*64+80)),height=300,left=52,right=20,top=25,bottom=55,plotH=height-top-bottom;
 const y=(v:number)=>top+(high-v)/span*plotH,zero=y(0),slot=(width-left-right)/Math.max(1,rows.length),x=(i:number)=>left+slot*(i+.5);
 const svgGrid=<>{[low,(low+high)/2,high].map((v,i)=><g key={i}><line x1={left} x2={width-right} y1={y(v)} y2={y(v)} className="management-gridline"/><text x={left-8} y={y(v)+4} textAnchor="end">{n.format(v)}</text></g>)}</>;
 const pages=Math.max(1,Math.ceil(rows.length/50)),safePage=Math.min(page,pages-1),visible=rows.slice(safePage*50,(safePage+1)*50);
 const total=rows.reduce((s,r)=>s+r.primary,0),donutValid=rows.every(r=>r.primary>=0)&&total>0;
 let offset=0;
 return <section className="management-chart" aria-labelledby={id} data-chart-kind={kind}>
  <div className="management-chart-heading"><h2 id={id}>{title}</h2><p>{caption}</p></div>
  {!rows.length?<p className="management-no-data">Não há registros suficientes neste recorte.</p>:<>
   {kind!=="donut"&&<div className="management-legend">{labels.map((label,i)=><span key={label}><i style={{background:kind==="stacked"?color(label,i):colors[i%colors.length]}}/>{label}</span>)}</div>}
   {kind==="bar"&&<div className="management-bars">{rows.map(row=><div className="management-chart-row" key={row.key}>
    <button type="button" disabled={!active(row.ids)} onClick={()=>select(row.ids)} aria-label={a11y(row)}><span>{row.label}</span><strong>{fmt(row.primary)}</strong></button>
    <div className="management-track" aria-hidden="true">{[row.primary,...(row.secondary===undefined?[]:[row.secondary])].map((value,i)=><div className="management-signed-track" key={i}><i className="management-zero" style={{left:(-low/span*100)+"%"}}/><span style={{left:((Math.min(value,0)-low)/span*100)+"%",width:(Math.abs(value)/span*100)+"%",background:colors[i]}}/></div>)}</div>
    {row.secondary!==undefined&&<small>{secondaryLabel}: {fmt(row.secondary)}</small>}
    {row.note&&<small>{row.note}</small>}
   </div>)}</div>}
   {kind==="donut"&&(donutValid?<div className="management-donut-layout"><svg viewBox="0 0 220 220" className="management-donut" role="group" aria-label={title}>{rows.map((row,i)=>{
    const part=row.primary/total*100,start=offset;offset+=part;
    return <circle key={row.key} cx="110" cy="110" r="78" pathLength="100" fill="none" stroke={color(row.key,i)} strokeWidth="28" strokeDasharray={`${part} ${100-part}`} strokeDashoffset={-start} transform="rotate(-90 110 110)" {...interactive(row.ids)} aria-label={`${row.label}: ${fmt(row.primary)} (${n.format(part)}%)`}><title>{row.label}: {fmt(row.primary)} ({n.format(part)}%)</title></circle>;
   })}<text x="110" y="108" textAnchor="middle" className="management-donut-total">{n.format(total)}</text><text x="110" y="130" textAnchor="middle">{primaryLabel}</text></svg><div className="management-donut-labels">{rows.map((r,i)=><button key={r.key} disabled={!active(r.ids)} onClick={()=>select(r.ids)}><i style={{background:color(r.key,i)}}/><span>{r.label}</span><strong>{fmt(r.primary)} · {n.format(r.primary/total*100)}%</strong></button>)}</div></div>:<p className="management-no-data">Sem valores positivos para calcular a composição. Consulte os valores na tabela.</p>)}
   {(kind==="column"||kind==="line"||kind==="stacked")&&<div className="management-svg-scroll"><svg viewBox={`0 0 ${width} ${height}`} style={{minWidth:Math.min(width,rows.length*48+80)}} role="group" aria-label={title} className="management-svg">
    {svgGrid}
    {kind==="line"&&[0,...(secondaryLabel?[1]:[])].map(series=>{
     const points=rows.map((r,i)=>({i,v:series===0?r.primary:r.secondary}));
     let previous=false;const d=points.map(p=>{if(p.v===undefined){previous=false;return "";}const command=previous?"L":"M";previous=true;return `${command}${x(p.i)},${y(p.v)}`;}).join(" ");
     return <g key={series}><path d={d} fill="none" stroke={colors[series]} strokeWidth="2.5" strokeDasharray={series?"6 3":undefined}/>{points.filter(p=>p.v!==undefined).map(p=><circle key={p.i} cx={x(p.i)} cy={y(p.v!)} r="5" fill={colors[series]} {...interactive(rows[p.i].ids)} aria-label={`${rows[p.i].label}: ${labels[series]} ${fmt(p.v!)}`}><title>{rows[p.i].label}: {labels[series]} {fmt(p.v!)}</title></circle>)}</g>;
    })}
    {rows.map((row,i)=><g key={row.key}>
     {kind==="column"&&[row.primary,...(row.secondary===undefined?[]:[row.secondary])].map((v,s)=>{const w=Math.min(24,slot/(secondaryLabel?3:2));return <g key={s} {...interactive(row.ids)} aria-label={`${row.label}: ${labels[s]} ${fmt(v)}`}><rect x={x(i)+(secondaryLabel?(s===0?-w:0):-w/2)} y={Math.min(zero,y(v))} width={w-2} height={Math.abs(zero-y(v))} fill={colors[s]}/><text x={x(i)+(secondaryLabel?(s===0?-w/2:w/2):0)} y={v>=0?y(v)-5:y(v)+14} textAnchor="middle">{n.format(v)}</text><title>{row.label}: {labels[s]} {fmt(v)}</title></g>;})}
     {kind==="stacked"&&(()=>{let sum=0;return (row.segments??[]).map(segment=>{const start=sum;sum+=segment.value;return <rect key={segment.label} x={x(i)-Math.min(24,slot/3)} y={y(sum)} width={Math.min(48,slot*2/3)} height={(sum-start)/span*plotH} fill={color(segment.label,segmentLabels.indexOf(segment.label))} {...interactive(segment.ids)} aria-label={`${row.label}: ${segment.label} ${fmt(segment.value)}`}><title>{row.label}: {segment.label} {fmt(segment.value)}</title></rect>;});})()}
     <text x={x(i)} y={height-bottom+20} textAnchor="middle">{row.label.length>18?row.label.slice(0,17)+"…":row.label}</text>
    </g>)}
   </svg></div>}
   <details className="management-chart-table"><summary>Consultar valores em tabela ({rows.length})</summary><div className="table-wrap"><table><thead><tr><th>Grupo</th>{labels.map(label=><th key={label}>{label}{unit&&` (${unit.trim()})`}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.key}><th scope="row">{active(r.ids)?<button onClick={()=>select(r.ids)}>{r.label}</button>:r.label}</th>{kind==="stacked"?labels.map(label=><td key={label}>{n.format(r.segments?.find(s=>s.label===label)?.value??0)}</td>):<><td>{fmt(r.primary)}</td>{secondaryLabel&&<td>{r.secondary===undefined?"Indisponível":fmt(r.secondary)}</td>}</>}</tr>)}</tbody></table></div>{pages>1&&<div className="management-reading"><button disabled={safePage===0} onClick={()=>setPage(safePage-1)}>Anterior</button><span>Página {safePage+1} de {pages}</span><button disabled={safePage+1>=pages} onClick={()=>setPage(safePage+1)}>Próxima</button></div>}</details>
  </>}
 </section>;
}
