import type {IncomingMessage,ServerResponse} from "node:http";
import {authenticatePanelRequest} from "../server/panelIdentity.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {json} from "../server/workspaceApi.ts";
import {panelSourcesView,savePanelSource,collectPanelSource} from "../server/panelSources.ts";
export const config={maxDuration:60};
export default async function handler(req:IncomingMessage,res:ServerResponse){
 try{
 if(!["GET","POST"].includes(req.method??""))return json(res,405,{error:"method_not_allowed"});
 if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:"same_origin_required"});
 const db=supabaseFromEnv(),identity=await authenticatePanelRequest(req,db);
 if(!identity.owner)return json(res,403,{error:"Acesso exclusivo do proprietário"});
 if(req.method==="POST"){
 if(!req.headers["content-type"]?.startsWith("application/json"))return json(res,415,{error:"json_required"});
 let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8000)return json(res,413,{error:"too_large"});}
 const body=JSON.parse(raw);
 if(body.action==="save")await savePanelSource(db,body.config,body.id,body.revision);
 else if(body.action==="collect"&&typeof body.id==="string"&&/^[0-9a-f-]{36}$/i.test(body.id)){
  const result=await collectPanelSource(db,body.id);if(!(await authenticatePanelRequest(req,db)).owner)return json(res,403,{error:"Acesso revogado"});return json(res,200,{result});
 }else return json(res,400,{error:"Ação inválida"});
 }
 const sourceId=new URL(req.url??"/api/panel-sources","http://localhost").searchParams.get("source")??undefined;
 if(sourceId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId))return json(res,400,{error:"Fonte inválida"});
 const sources=await panelSourcesView(db,sourceId);
 if(!(await authenticatePanelRequest(req,db)).owner)return json(res,403,{error:"Acesso revogado"});
 return json(res,200,{sources,generatedAt:new Date().toISOString()});
 }catch(error){const message=error instanceof Error?error.message:"Falha na consulta";return json(res,message==="login_required"?401:/exclusiv|revogado|sem vínculo/i.test(message)?403:400,{error:message.slice(0,500)});}
}
