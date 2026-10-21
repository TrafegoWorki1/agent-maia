import {useState} from "react";
import type {CollaborationData,CollaborationTask} from "../../lib/collaborationApi";
import {brtDate} from "../../lib/managementAnalytics";
const states:Record<string,string>={pending:"Pendente",in_progress:"Em execução",review:"Em revisão",awaiting_approval:"Aguardando aprovação",completed:"Concluído",cancelled:"Cancelado"};
const when=(v:unknown)=>v?new Date(String(v)).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"Sem conclusão registrada";
export function DeliveryTimeline({rows,data,tasks,start,end,onSelect}:{rows:Array<Record<string,unknown>>;data:CollaborationData;tasks:CollaborationTask[];start:string;end:string;onSelect:(ids:number[])=>void}){
 const [page,setPage]=useState(0),pages=Math.max(1,Math.ceil(rows.length/25)),safe=Math.min(page,pages-1),visible=rows.slice(safe*25,(safe+1)*25);
 const dates=visible.flatMap(d=>[d.due_at,d.completed_at]).filter(v=>v&&Number.isFinite(Date.parse(String(v)))).map(v=>Date.parse(String(v)));
 const from=Math.min(Date.parse(start+"T00:00:00-03:00"),...dates),to=Math.max(Date.parse(end+"T23:59:59.999-03:00"),...dates),x=(v:unknown)=>200+(Date.parse(String(v))-from)/Math.max(1,to-from)*510;
 const ids=(d:Record<string,unknown>)=>tasks.filter(t=>t.deliverable_id===d.id).map(t=>t.id);
 return <>
  {!!visible.length&&<div className="management-svg-scroll"><div className="management-legend"><span><i/>Prazo previsto</span><span><i style={{background:"var(--gold)"}}/>Conclusão registrada</span></div><svg className="management-timeline" viewBox={`0 0 740 ${visible.length*42+55}`} role="img" aria-label="Cronograma: prazo previsto e conclusão registrada de cada entregável">
   <text x="200" y="14">{brtDate(new Date(from))}</text><text x="710" y="14" textAnchor="end">{brtDate(new Date(to))}</text>
   {visible.map((d,i)=>{const y=44+i*42,done=!!d.completed_at&&Number.isFinite(Date.parse(String(d.completed_at)));return <g key={String(d.id)}><title>{String(d.title)} · Prazo: {when(d.due_at)} · Conclusão: {when(d.completed_at)}</title><text x="0" y={y+4}>{String(d.title).slice(0,25)}</text><line x1="200" x2="710" y1={y} y2={y} className="management-gridline"/>{done&&<line x1={x(d.due_at)} x2={x(d.completed_at)} y1={y} y2={y} stroke="var(--muted)" strokeWidth="2"/>}<rect x={x(d.due_at)-5} y={y-5} width="10" height="10" fill="var(--blue)"/>{done&&<circle cx={x(d.completed_at)} cy={y} r="5" fill="var(--gold)"/>}</g>;})}
  </svg></div>}
  <div className="table-wrap"><table><thead><tr><th>Entregável / projeto</th><th>Previsto</th><th>Concluído</th><th>Estado</th><th>Trabalho vinculado</th></tr></thead><tbody>{visible.map(d=><tr key={String(d.id)}><th>{String(d.title)}<small className="collab-detail">{String(data.projects.find(p=>p.id===d.project_id)?.name??"Projeto autorizado")}</small></th><td>{when(d.due_at)}</td><td>{when(d.completed_at)}</td><td>{states[String(d.status)]??String(d.status)}</td><td>{ids(d).length?<button onClick={()=>onSelect(ids(d))}>Abrir {ids(d).length} tarefas</button>:"Sem tarefa vinculada"}</td></tr>)}</tbody></table></div>
  {!rows.length&&<p>Nenhum entregável com prazo neste período.</p>}
  {pages>1&&<div className="management-reading"><button disabled={!safe} onClick={()=>setPage(safe-1)}>Anterior</button><span>Página {safe+1} de {pages} · {rows.length} entregáveis no cálculo</span><button disabled={safe+1>=pages} onClick={()=>setPage(safe+1)}>Próxima</button></div>}
 </>;
}
