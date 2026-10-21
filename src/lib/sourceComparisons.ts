import {summarizePanelSource,validDay,type PanelMetricCode,type PanelSourceView} from "./panelSourceModel";
import type {ChartRow} from "./managementAnalytics";
export type ComparisonKind="forecast"|"cash"|"margin"|"cpr"|"roas"|"win_rate";
export const COMPARISONS:Record<ComparisonKind,{label:string;codes:PanelMetricCode[];unit:string}>={
 forecast:{label:"Previsto × recebido",codes:["finance.expected","finance.received"],unit:""},
 cash:{label:"Fluxo líquido de caixa",codes:["finance.received","finance.costs","finance.expenses"],unit:""},
 margin:{label:"Margem de caixa",codes:["finance.received","finance.costs","finance.expenses"],unit:"%"},
 cpr:{label:"Custo por resultado",codes:["campaign.spend","campaign.results"],unit:""},
 roas:{label:"ROAS observado",codes:["campaign.spend","campaign.attributed_revenue"],unit:"×"},
 win_rate:{label:"Ganho entre vendas encerradas",codes:["sales.won","sales.lost"],unit:"%"}
};
export function compareSources(kind:ComparisonKind,sources:PanelSourceView[],start:string,end:string,confirmed:boolean,now=Date.now()){
 const spec=COMPARISONS[kind],fail=(reason:string)=>({available:false as const,reason,value:null,unit:spec.unit,rows:[] as ChartRow[],totals:[] as number[]});
 if(!validDay(start)||!validDay(end)||start>end)return fail("Informe um período válido.");
 if(!confirmed)return fail("Confirme a cobertura e a compatibilidade das fontes para este cálculo.");
 if(sources.length!==spec.codes.length||new Set(sources.map(s=>s.id)).size!==sources.length||spec.codes.some(code=>sources.filter(s=>s.metric_code===code).length!==1))return fail("Selecione uma fonte diferente para cada componente.");
 const selected=spec.codes.map(code=>sources.find(s=>s.metric_code===code)!);
 const first=selected[0];
 if(selected.some(s=>!s.active||s.client_id!==first.client_id||s.project_id!==first.project_id||s.basis.trim()!==first.basis.trim()))return fail("Fontes precisam ter o mesmo cliente, projeto e regime/objetivo/atribuição.");
 const money=selected.filter(s=>s.unit!=="count");
 if(money.some(s=>s.unit!==money[0].unit))return fail("Moedas diferentes não podem ser combinadas.");
 if(selected.some(s=>!s.success||!s.success.completed_at||now-Date.parse(s.success.completed_at)>3600000||!Number.isFinite(Date.parse(s.success.completed_at))||s.latest?.status==="error"))return fail("Todas as fontes precisam de coleta válida e atualizada, sem erro na última tentativa.");
 const summaries=selected.map(s=>summarizePanelSource(s,start,end));
 if(summaries.some(s=>s.value===null))return fail("Falta um lote válido no período.");
 if(kind==="cash"||kind==="margin"){
  const costs=new Set(summaries[1].rows.map(r=>selected[1].source_ref+":"+r.key));
  if(summaries[2].rows.some(r=>costs.has(selected[2].source_ref+":"+r.key)))return fail("Custos e despesas contêm o mesmo identificador na mesma planilha; corrija a sobreposição.");
 }
 const totals=summaries.map(s=>s.value!);
 if(["margin","roas"].includes(kind)&&totals[0]<=0)return fail("O denominador deve ser maior que zero.");
 if(kind==="win_rate"&&totals[0]+totals[1]<=0)return fail("Não há vendas encerradas para formar o denominador.");
 const value=kind==="forecast"?null:kind==="cash"?totals[0]-totals[1]-totals[2]:kind==="margin"?(totals[0]-totals[1]-totals[2])/totals[0]*100:kind==="cpr"?(totals[1]>0?totals[0]/totals[1]:null):kind==="roas"?totals[1]/totals[0]:totals[0]/(totals[0]+totals[1])*100;
 if(kind==="cpr"&&value===null)return fail("Não há resultados para formar o denominador.");
 const dates=[...new Set(summaries.flatMap(s=>s.rows.map(r=>r.date)))].sort();
 // O zero nesta comparação é autorizado pela declaração explícita de cobertura completa.
 const days=summaries.map(s=>{const map=new Map<string,number>();for(const r of s.rows)map.set(r.date,(map.get(r.date)??0)+r.value);return map;});
 const rows:ChartRow[]=dates.map(date=>({key:date,label:date,ids:[],primary:days[0].get(date)??0,secondary:kind==="forecast"||kind==="win_rate"?days[1].get(date)??0:undefined}));
 if(kind==="cash"||kind==="margin")for(const row of rows)row.primary=(days[0].get(row.key)??0)-(days[1].get(row.key)??0)-(days[2].get(row.key)??0);
 // Razões diárias exigem denominador daquele dia; ficam em tabela, sem ligar lacunas como zero.
 if(kind==="cpr"||kind==="roas")for(const row of rows){row.primary=days[0].get(row.key)??0;row.secondary=days[1].get(row.key)??0;}
 return{available:true as const,reason:null,value,unit:spec.unit||(money[0]?.unit??"%"),rows,totals};
}
