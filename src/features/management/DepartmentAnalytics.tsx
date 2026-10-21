import {useMemo,useState} from "react";
import type {CollaborationData,CollaborationTask} from "../../lib/collaborationApi";
import {buildManagementAnalytics,defaultAnalyticsFilters} from "../../lib/managementAnalytics";
import {ManagementChart} from "../../components/ManagementCharts";
import {Tasks} from "../collaboration/CollaborationPage";
import {Panel} from "../../components/ui";
export function DepartmentAnalytics({data,tasks,reload}:{data:CollaborationData;tasks:CollaborationTask[];reload:()=>Promise<void>}){
 const [ids,setIds]=useState<number[]|null>(null);
 const value=useMemo(()=>buildManagementAnalytics({...data,tasks},defaultAnalyticsFilters(new Date(data.generatedAt)),new Date(data.generatedAt)),[data,tasks]);
 if(!data.identity.owner)return null;
 return <><div className="management-chart-grid"><ManagementChart title="Fluxo de trabalho" caption="Estado atual no recorte do setor." rows={value.stateChart} primaryLabel="Tarefas" onSelect={setIds}/><ManagementChart title="Bloqueios por espera" caption="Distingue a espera pela equipe, pelo cliente e por dependências externas." rows={value.waitingChart} primaryLabel="Bloqueios" onSelect={setIds}/></div>{ids&&<Panel title="Registros do gráfico" action={<button onClick={()=>setIds(null)}>Fechar</button>}><Tasks items={tasks.filter(t=>ids.includes(t.id))} data={data} people={data.people} reload={reload}/></Panel>}</>;
}
