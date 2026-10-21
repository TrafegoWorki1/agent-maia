export const PANEL_METRICS = {
 "sales.won":{label:"Vendas ganhas",kind:"sales",unit:"count",mode:"flow"},
 "sales.lost":{label:"Vendas perdidas",kind:"sales",unit:"count",mode:"flow"},
 "finance.received":{label:"Recebido",kind:"finance",unit:"BRL",mode:"flow"},
 "finance.expected":{label:"Previsto para receber",kind:"finance",unit:"BRL",mode:"flow"},
 "finance.overdue":{label:"Saldo vencido",kind:"finance",unit:"BRL",mode:"stock"},
 "finance.costs":{label:"Custos pagos",kind:"finance",unit:"BRL",mode:"flow"},
 "finance.expenses":{label:"Despesas pagas",kind:"finance",unit:"BRL",mode:"flow"},
 "campaign.spend":{label:"Investimento de campanha",kind:"campaign",unit:"BRL",mode:"flow"},
 "campaign.results":{label:"Resultados da campanha",kind:"campaign",unit:"count",mode:"flow"},
 "campaign.attributed_revenue":{label:"Receita atribuída à campanha",kind:"campaign",unit:"BRL",mode:"flow"}
} as const;
export type PanelMetricCode=keyof typeof PANEL_METRICS;
export interface PanelObservation{key:string;date:string;value:number}
export interface PanelSourceConfig{id:string;name:string;provider:"google_sheets";metric_code:PanelMetricCode;source_ref:string;range_ref:string;mapping:{key:string;date:string;value:string};unit:"BRL"|"USD"|"EUR"|"count";basis:string;coverage:string;client_id:string|null;project_id:string|null;active:boolean;revision:number}
export interface PanelRun{id:string;status:"running"|"ok"|"error";started_at:string;completed_at:string|null;error:string|null}
export interface PanelSourceView extends PanelSourceConfig{clientName?:string;projectName?:string;history?:Array<PanelRun&{config_revision:number}>;latest:PanelRun|null;success:(PanelRun&{observations:PanelObservation[]})|null}
export function validDay(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value;}
export function summarizePanelSource(source:PanelSourceView,start:string,end:string){
 const meta=PANEL_METRICS[source.metric_code],rows=source.success?.observations??[];
 const period=rows.filter(r=>r.date>=start&&r.date<=end),latestDay=period.map(r=>r.date).sort().at(-1);
 const included=meta.mode==="stock"?period.filter(r=>r.date===latestDay):period;
 return {rows:included,value:source.success&&(meta.mode!=="stock"||!!latestDay)&&validDay(start)&&validDay(end)&&start<=end?included.reduce((s,r)=>s+r.value,0):null,asOf:meta.mode==="stock"?latestDay:null,mode:meta.mode};
}
