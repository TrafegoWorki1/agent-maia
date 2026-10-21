import {useMemo,useState} from "react";
import type {CollaborationData,CollaborationTask} from "../../lib/collaborationApi";
import {buildManagementAnalytics,defaultAnalyticsFilters} from "../../lib/managementAnalytics";
import {ManagementChart} from "../../components/ManagementCharts";
import {DeliveryTimeline} from "./DeliveryTimeline";
import {buildSectorAnalytics} from "../../lib/sectorAnalytics";
import type {AnalyticsFilters} from "../../lib/managementAnalytics";
import {IndicatorCard,IndicatorGrid} from "../../components/WorkIndicators";
import {Tasks} from "../collaboration/CollaborationPage";
import {Panel} from "../../components/ui";
export function DepartmentAnalytics({data,tasks,reload,filters,projects=false}:{data:CollaborationData;tasks:CollaborationTask[];reload:()=>Promise<void>;filters?:AnalyticsFilters;projects?:boolean}){
 const [ids,setIds]=useState<number[]|null>(null);
 const period=filters??defaultAnalyticsFilters(new Date(data.generatedAt));
 const value=useMemo(()=>buildManagementAnalytics({...data,tasks},period,new Date(data.generatedAt)),[data,tasks,period.start,period.end,period.client,period.project,period.person,period.team,period.area]);
 const sector=buildSectorAnalytics({...data,tasks},period);
 if(!data.identity.owner)return null;
 return <>
  <div className="management-chart-grid">
   <ManagementChart title="Fluxo de trabalho" kind="donut" caption="Composição pelo estado atual no recorte do setor." rows={value.stateChart} primaryLabel="Tarefas" onSelect={setIds}/>
   <ManagementChart title="Bloqueios por espera" caption="Distingue a espera pela equipe, pelo cliente e por dependências externas." rows={value.waitingChart} primaryLabel="Bloqueios" onSelect={setIds}/>
   <ManagementChart title="Entregas por semana" kind="line" caption="Conclusões registradas no período, agrupadas pela semana em Brasília. Semanas parciais respeitam o intervalo selecionado." rows={sector.throughput} primaryLabel="Conclusões" onSelect={setIds}/>
   <ManagementChart title="Idade do trabalho aberto" caption={`Dias de calendário desde o início registrado até a leitura atual. ${sector.unknownStart} itens sem início ficam fora das faixas.`} rows={sector.aging} primaryLabel="Itens" onSelect={setIds}/>
   <ManagementChart title="Composição por área" kind="stacked" caption="Estado atual das tarefas de cada área; os segmentos abrem os mesmos registros." rows={sector.composition} primaryLabel="Tarefas" onSelect={setIds}/>
   <ManagementChart title="Motivos de devolução" caption="Eventos de revisão no período; uma tarefa pode ter mais de uma devolução. O detalhe abre as tarefas correspondentes." rows={sector.returns} primaryLabel="Devoluções" onSelect={setIds}/>
   {projects&&<ManagementChart title="Entregáveis previstos e no prazo" kind="column" caption="Entregáveis com prazo no período × concluídos até esse prazo. Cancelamentos permanecem na população prevista." rows={sector.projectPlan} primaryLabel="Previstos" secondaryLabel="Entregues no prazo" onSelect={setIds}/>}
  </div>
  {projects&&<Panel title="Cronograma de entregáveis" caption="Datas de compromisso e conclusão observada; ausência de conclusão não é atraso histórico reconstruído."><IndicatorGrid label="Compromissos dos projetos"><IndicatorCard label="Entregáveis no prazo" value={sector.onTimeMilestones} unit="%" helper={`${sector.measurableMilestones} compromissos já vencidos e mensuráveis; cancelados excluídos.`}/></IndicatorGrid><DeliveryTimeline rows={sector.milestones} data={data} tasks={sector.tasks} start={period.start} end={period.end} onSelect={setIds}/></Panel>}
  <details><summary>Itens abertos por idade</summary><div className="table-wrap"><table><thead><tr><th>Tarefa</th><th>Dias desde o início</th><th>Estado atual</th></tr></thead><tbody>{sector.aged.map(({task,days})=><tr key={task.id}><th><button onClick={()=>setIds([task.id])}>#{task.id} · {task.title}</button></th><td>{days===null?"Início não informado":days.toLocaleString("pt-BR",{maximumFractionDigits:1})}</td><td>{task.workflow_status}</td></tr>)}</tbody></table></div></details>
  {ids&&<Panel title="Registros do gráfico" action={<button onClick={()=>setIds(null)}>Fechar</button>}><Tasks items={tasks.filter(t=>ids.includes(t.id))} data={data} people={data.people} reload={reload}/></Panel>}
 </>;
}
