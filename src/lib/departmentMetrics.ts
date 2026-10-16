// Contrato puro compartilhado pelo backend e pelas visões filtradas. Arrays são metadados, nunca dados operacionais.
export interface MetricRecord {id:string;kind:"opportunity"|"cs";status:string;next_action_at:string|null;canViewMetrics?:boolean}
export interface DepartmentMetric {code:string;label:string;value:number|null;unit:string;formula:string;population:string;period:string;source:string;target:null;coverage:string;recordIds:string[];unavailableReason:string|null}
export function calculateDepartmentMetrics(records:MetricRecord[],generatedAt:string):DepartmentMetric[]{
 const authorized=records.filter(row=>row.canViewMetrics);
 const opportunities=authorized.filter(row=>row.kind==="opportunity"),cs=authorized.filter(row=>row.kind==="cs");
 const open=(rows:MetricRecord[])=>rows.filter(row=>!["won","lost","completed","cancelled"].includes(row.status));
 const closed=opportunities.filter(row=>["won","lost"].includes(row.status));
 const due=open(cs).filter(row=>row.next_action_at);
 const overdue=due.filter(row=>Date.parse(row.next_action_at!)<Date.parse(generatedAt));
 const result=(code:string,label:string,rows:MetricRecord[],value:number|null,unit:string,formula:string,population:string,reason:string|null=null):DepartmentMetric=>({code,label,value,unit,formula,population,period:`Estado atual em ${generatedAt}`,source:"work_department_records",target:null,coverage:"Consulta completa do escopo autorizado, sem truncamento. Não mede produtividade individual.",recordIds:rows.map(row=>row.id),unavailableReason:reason});
 return [
  result("commercial.open","Oportunidades abertas",open(opportunities),open(opportunities).length,"registros","contagem de oportunidades não encerradas","oportunidades autorizadas abertas"),
  result("commercial.win_rate","Ganho entre oportunidades encerradas",closed,closed.length?Math.round(closed.filter(row=>row.status==="won").length/closed.length*1000)/10:null,"%","ganhas / (ganhas + perdidas) × 100","oportunidades ganhas ou perdidas; não é conversão por etapa",closed.length?null:"Sem oportunidades encerradas para formar o denominador."),
  result("cs.open","Combinados em aberto",open(cs),open(cs).length,"registros","contagem de combinados não encerrados","combinados de CS autorizados abertos"),
  result("cs.overdue","Próximas ações de CS vencidas",due,due.length?overdue.length:null,"registros","contagem de próximas ações abertas com prazo anterior à leitura","combinados de CS abertos com prazo informado; os sem prazo ficam fora",due.length?null:"Sem próximos retornos abertos com prazo informado."),
 ];
}
