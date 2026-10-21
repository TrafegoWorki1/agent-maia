import type {CollaborationData} from "../lib/collaborationApi";
import {defaultAnalyticsFilters,type AnalyticsFilters as Filters} from "../lib/managementAnalytics";
export function AnalyticsFilters({data,value,onChange,area=true}:{data:CollaborationData;value:Filters;onChange:(value:Filters)=>void;area?:boolean}){
 function field(k:keyof Filters,v:string){onChange({...value,[k]:v,...(k==="client"?{project:""}:{})});}
 return <form className="management-filters" onSubmit={e=>e.preventDefault()} aria-label="Filtros gerenciais">
  <label>De<input type="date" value={value.start} max={value.end} onChange={e=>field("start",e.target.value)}/></label><label>Até<input type="date" value={value.end} min={value.start} onChange={e=>field("end",e.target.value)}/></label>
  <label>Cliente<select value={value.client} onChange={e=>field("client",e.target.value)}><option value="">Todos autorizados</option>{data.clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <label>Projeto<select value={value.project} onChange={e=>field("project",e.target.value)}><option value="">Todos autorizados</option>{data.projects.filter(p=>!value.client||p.client_id===value.client).map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}</select></label>
  <label>Equipe<select value={value.team} onChange={e=>field("team",e.target.value)}><option value="">Todas autorizadas</option>{data.teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
  <label>Responsável<select value={value.person} onChange={e=>field("person",e.target.value)}><option value="">Todos autorizados</option>{data.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  {area&&<label>Área<select value={value.area} onChange={e=>field("area",e.target.value)}><option value="">Todas</option>{[...new Set(data.tasks.flatMap(t=>t.area?[t.area]:[]))].sort().map(a=><option value={a} key={a}>{a}</option>)}</select></label>}
  <button type="button" className="button button-outline" onClick={()=>onChange(defaultAnalyticsFilters())}>Semana atual</button>
 </form>;
}
