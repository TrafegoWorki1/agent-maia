import {useState} from "react";
import {Panel} from "../../components/ui";
import type {CollaborationData,CollaborationTask} from "../../lib/collaborationApi";
import {TaskDetailPanel} from "./TaskDetailPanel";
const dateKey=(date:Date)=>new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
export function WorkCalendar({items,data,reload}:{items:CollaborationTask[];data:CollaborationData;reload:()=>Promise<void>}){
 const [month,setMonth]=useState(dateKey(new Date()).slice(0,7)),[detail,setDetail]=useState<number|null>(null);
 const first=new Date(month+"-01T12:00:00Z"),days=new Date(first.getUTCFullYear(),first.getUTCMonth()+1,0).getDate(),offset=(first.getUTCDay()+6)%7;
 function shift(direction:number){const date=new Date(first);date.setUTCMonth(date.getUTCMonth()+direction);setMonth(date.toISOString().slice(0,7));}
 return <><Panel title="Calendário de compromissos" action={<div className="collab-actions"><button onClick={()=>shift(-1)} aria-label="Mês anterior">Anterior</button><strong>{first.toLocaleDateString("pt-BR",{month:"long",year:"numeric",timeZone:"America/Sao_Paulo"})}</strong><button onClick={()=>shift(1)} aria-label="Próximo mês">Próximo</button></div>}>
  <div className="collab-calendar">{["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map(day=><strong key={day}>{day}</strong>)}{Array.from({length:offset},(_,index)=><div aria-hidden="true" key={"blank"+index}/>)}{Array.from({length:days},(_,index)=>{const day=index+1,key=month+"-"+String(day).padStart(2,"0"),tasks=items.filter(task=>task.committed_due_at&&dateKey(new Date(task.committed_due_at))===key);return <section key={key} aria-label={key}><time dateTime={key}>{day}</time>{tasks.map(task=><button key={task.id} onClick={()=>setDetail(task.id)}>#{task.id} · {task.title}</button>)}</section>;})}</div>
 </Panel>{detail!==null&&items.some(task=>task.id===detail)&&<TaskDetailPanel key={detail} task={items.find(task=>task.id===detail)!} data={data} reload={reload} onClose={()=>setDetail(null)}/>}</>;
}
