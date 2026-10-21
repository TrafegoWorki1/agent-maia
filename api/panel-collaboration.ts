import type {IncomingMessage,ServerResponse} from "node:http";
import {authenticatePanelRequest} from "../server/panelIdentity.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {canAccessTask,collaborationView,serializeIdentity,type CollaborativeTask} from "../server/collaborativeWork.ts";
import {defaultAnalyticsFilters} from "../src/lib/managementAnalytics.ts";
import {validDay} from "../src/lib/panelSourceModel.ts";
import {json} from "../server/workspaceApi.ts";

export default async function handler(req:IncomingMessage,res:ServerResponse){
 try{
  res.setHeader("Cache-Control","no-store, private");
  if(req.method!=="GET")return json(res,405,{error:"method_not_allowed"});
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:"same_origin_required"});
  const db=supabaseFromEnv(),identity=await authenticatePanelRequest(req,db),params=new URL(req.url??"/api/panel-collaboration","http://localhost").searchParams;
  if(!identity.owner&&!serializeIdentity(identity).screens.length)throw new Error("Acesso ao painel revogado");
  const fingerprint=serializeIdentity(identity).accessVersion;
  async function send(value:unknown){if(fingerprint!==serializeIdentity(await authenticatePanelRequest(req,db)).accessVersion)throw new Error("Acesso ou escopo alterado; carregue novamente");return json(res,200,value);}
  if(params.has("task")){
   const taskId=Number(params.get("task")),page=Number(params.get("page")??0);
   if(!Number.isSafeInteger(taskId)||taskId<1||!Number.isSafeInteger(page)||page<0||page>100000)return json(res,400,{error:"Identificador ou página inválidos"});
   const task=await db.from("work_tasks").select("*").eq("id",taskId).maybeSingle();if(task.error)throw new Error(task.error.message);
   if(!task.data||!canAccessTask(identity,task.data as CollaborativeTask,"trabalho.ver"))return json(res,403,{error:"Registro fora do escopo"});
   const history=await db.from("work_task_history").select("id,work_task_id,at,actor_person_id,actor_origin,event_type,from_value,to_value,reason,evidence,revision").eq("work_task_id",taskId).order("at").order("id").range(page*100,page*100+100);
   if(history.error)throw new Error(history.error.message);
   return await send({history:(history.data??[]).slice(0,100),hasMore:(history.data??[]).length>100,page,generatedAt:new Date().toISOString()});
  }
  const defaults=defaultAnalyticsFilters(),start=params.get("start")??defaults.start,end=params.get("end")??defaults.end;
  if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>365*86400000)return json(res,400,{error:"Informe um período válido de até 366 dias"});
  const view=await collaborationView(db,identity,new Date(),"panel",{start,end});
  return await send({...view,readWindow:{start,end,historyOnDemand:true}});
 }catch(error){const message=error instanceof Error?error.message:"Falha na leitura";return json(res,message==="login_required"?401:/negad|denied|revogado|escopo alterado|fora do escopo|sem vínculo/i.test(message)?403:503,{error:message.slice(0,500)});}
}
