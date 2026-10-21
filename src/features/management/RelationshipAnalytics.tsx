import {useState} from "react";
import type {CollaborationData,DepartmentRecord} from "../../lib/collaborationApi";
import type {AnalyticsFilters} from "../../lib/managementAnalytics";
import {buildRelationshipAnalytics} from "../../lib/sectorAnalytics";
import {IndicatorCard,IndicatorGrid} from "../../components/WorkIndicators";
import {ManagementChart} from "../../components/ManagementCharts";
import {Panel} from "../../components/ui";
export function RelationshipAnalytics({data,records,filters,kind}:{data:CollaborationData;records:DepartmentRecord[];filters:AnalyticsFilters;kind:"opportunity"|"cs"}){
 const [selection,setSelection]=useState<string[]|null>(null),a=buildRelationshipAnalytics(data,records,filters,kind);
 if(!data.identity.owner)return null;
 return <>
  <IndicatorGrid label={kind==="cs"?"Retornos de CS":"Acompanhamento comercial"}>
   <IndicatorCard label="Próximas ações vencidas" value={a.overdue.length} unit="itens" helper="Registros abertos com prazo anterior ao momento da leitura" category="Estado atual" onClick={()=>setSelection(a.overdue.map(r=>r.id))}/>
   <IndicatorCard label="Próximas ações no período" value={a.due.length} unit="itens" helper="Registros abertos com prazo dentro do intervalo selecionado" onClick={()=>setSelection(a.due.map(r=>r.id))}/>
   {kind==="cs"?<IndicatorCard label="Aguardando cliente" value={a.waiting.length} unit="itens" helper="Espera pelo cliente explicitamente registrada" category="Estado atual" onClick={()=>setSelection(a.waiting.map(r=>r.id))}/>:<IndicatorCard label="Ganho entre encerramentos do período" value={a.winRate} unit="%" helper={`${a.won} ganhos e ${a.lost} perdas; eventos de mudança de estado, incluindo reencerramentos.`} onClick={()=>setSelection([...new Set(a.events.map(e=>String(e.entity_id)))])}/>}
  </IndicatorGrid>
  <ManagementChart title={kind==="cs"?"Conclusões de retornos por semana":"Ganhos e perdas por semana"} kind={kind==="cs"?"line":"column"} caption="Somente transições registradas no histórico dentro do período. Sem evento não se infere data pelo último ajuste do registro." rows={a.trend} primaryLabel={kind==="cs"?"Conclusões":"Ganhos"} secondaryLabel={kind==="opportunity"?"Perdas":undefined}/>
  <details><summary>Eventos que compõem a evolução ({a.events.length})</summary><div className="table-wrap"><table><thead><tr><th>Registro</th><th>Data</th><th>Estado registrado</th></tr></thead><tbody>{a.events.map(e=><tr key={String(e.id)}><td>{a.rows.find(r=>r.id===e.entity_id)?.title}</td><td>{new Date(String(e.at)).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}</td><td>{String((e.new_value as Record<string,unknown>).status)}</td></tr>)}</tbody></table></div></details>
  {kind==="cs"&&<p className="work-source-note">Tempo de resposta indisponível: os combinados não registram o par solicitação/resposta necessário para medir atendimento.</p>}
  {selection&&<Panel title="Registros do indicador" action={<button onClick={()=>setSelection(null)}>Fechar</button>}><ul>{a.rows.filter(r=>selection.includes(r.id)).map(r=><li key={r.id}><strong>{r.title}</strong> · {r.next_action} · {r.next_action_at?new Date(r.next_action_at).toLocaleString("pt-BR"):"Sem prazo"} · {r.status}</li>)}</ul>{!selection.length&&<p>Nenhum registro nesta população.</p>}</Panel>}
 </>;
}
