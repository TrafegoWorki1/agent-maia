import type {IncomingMessage,ServerResponse} from "node:http";
import {authenticatePanelRequest} from "../server/panelIdentity.ts";
import {serializeIdentity} from "../server/collaborativeWork.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {json} from "../server/workspaceApi.ts";
import {validDay} from "../src/lib/panelSourceModel.ts";
import {defaultAnalyticsFilters} from "../src/lib/managementAnalytics.ts";

export default async function handler(req:IncomingMessage,res:ServerResponse){
 try{
  res.setHeader("Cache-Control","no-store, private");
  if(req.method!=="GET")return json(res,405,{error:"method_not_allowed"});
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:"same_origin_required"});
  const db=supabaseFromEnv(),identity=await authenticatePanelRequest(req,db);
  if(!identity.owner)return json(res,403,{error:"Acesso exclusivo do proprietário"});
  const params=new URL(req.url??"/api/panel-operations","http://localhost").searchParams,defaults=defaultAnalyticsFilters();
  const start=params.get("start")??defaults.start,end=params.get("end")??defaults.end;
  if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>92*86400000)return json(res,400,{error:"Selecione até 93 dias válidos"});
  async function read(table:string,select:string,date:string,pk="id",filter?:(q:any)=>any){
   const rows:Record<string,any>[]=[];
   for(let from=0;;from+=1000){let query=db.from(table).select(select).gte(date,start+"T00:00:00-03:00").lte(date,end+"T23:59:59.999-03:00");if(filter)query=filter(query);const r=await query.order(date).order(pk).range(from,from+999);if(r.error)throw new Error(r.error.message);rows.push(...(r.data??[]));if((r.data??[]).length<1000)return rows;}
  }
  const [runs,failures,receipts,approvals,health]=await Promise.all([
   read("agent_runs","id,started_at,status,cost_usd,provider,model","started_at"),
   read("tasks","id,status,finished_at","finished_at","id",q=>q.eq("kind","operacional").eq("status","falhou")),
   read("outbound_receipts","message_id,created_at,status","created_at","message_id"),
   read("approvals","id,requested_at,status","requested_at"),
   Promise.resolve().then(()=>db.from("panel_source_health").select("source,last_attempt_at,last_success_at,error").order("source"))
  ]);
  if(health.error)throw new Error(health.error.message);
  if(serializeIdentity(identity).accessVersion!==serializeIdentity(await authenticatePanelRequest(req,db)).accessVersion)return json(res,403,{error:"Acesso ou escopo alterado"});
  return json(res,200,{runs,failures,receipts,approvals,health:health.data??[],start,end,generatedAt:new Date().toISOString()});
 }catch(e){const message=e instanceof Error?e.message:"Falha na leitura";return json(res,message==="login_required"?401:/exclusiv|revogado|sem vínculo/i.test(message)?403:503,{error:message.slice(0,500)});}
}
