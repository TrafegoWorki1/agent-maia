import {brtDate,type ChartRow} from "./managementAnalytics";
export interface OperationReading{
 generatedAt:string;start:string;end:string;
 runs:Array<{id:number;started_at:string;status:string;cost_usd:number|null;provider:string|null;model:string|null}>;
 failures:Array<{id:number;status:string;finished_at:string|null}>;
 receipts:Array<{message_id:string;created_at:string;status:string}>;
 approvals:Array<{id:number;requested_at:string;status:string}>;
 health:Array<{source:string;last_attempt_at:string;last_success_at:string|null;error:string|null}>;
}
export function summarizeOperations(data:OperationReading){
 const days=new Map<string,{failures:number;cost:number;known:number;runs:number}>();
 const row=(date:string)=>{const key=brtDate(new Date(date));if(!days.has(key))days.set(key,{failures:0,cost:0,known:0,runs:0});return days.get(key)!;};
 for(const r of data.runs){const d=row(r.started_at);d.runs++;if(r.cost_usd!==null&&Number.isFinite(r.cost_usd)){d.cost+=r.cost_usd;d.known++;}}
 for(const f of data.failures)if(f.finished_at)row(f.finished_at).failures++;
 const failures:ChartRow[]=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>({key,label:key,primary:v.failures,ids:[]}));
 const costs:ChartRow[]=[...days].filter(([,v])=>v.known>0).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>({key,label:key,primary:v.cost,ids:[]}));
 const known=data.runs.filter(r=>r.cost_usd!==null&&Number.isFinite(r.cost_usd)),cost=known.reduce((s,r)=>s+r.cost_usd!,0);
 const statusNames:Record<string,string>={accepted:"Aceito pelo serviço",delivered:"Entregue",read:"Lido",played:"Reproduzido",failed:"Falha informada"};
 const receipts:ChartRow[]=Object.entries(statusNames).map(([status,label])=>({key:status,label,primary:data.receipts.filter(r=>r.status===status).length,ids:[]}));
 return{failures,costs,receipts,known:known.length,missing:data.runs.length-known.length,cost:known.length?cost:null,costPerRun:known.length?cost/known.length:null,pending:data.approvals.filter(a=>a.status==="pending").length};
}
