import type {IncomingMessage,ServerResponse} from "node:http";
import {authenticatePanelRequest} from "../server/panelIdentity.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {beginOAuth,connectionStatus,disconnectOAuth,finishOAuth,type OAuthProvider} from "../server/oauthConnections.ts";
import {listMetaAdsMcpTools} from "../server/integrations/metaAdsMcp.ts";
import {json} from "../server/workspaceApi.ts";

export const config={maxDuration:60};
function provider(value:unknown):OAuthProvider|null{return value==="meta_ads"?value:null;}
async function bodyOf(req:IncomingMessage):Promise<Record<string,unknown>>{let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>4000)throw new Error("too_large");}try{return JSON.parse(raw||"{}") as Record<string,unknown>;}catch{throw new Error("invalid_json");}}
function redirect(res:ServerResponse,location:string){res.statusCode=302;res.setHeader("Location",location);res.setHeader("Cache-Control","no-store");res.end();}

export default async function handler(req:IncomingMessage,res:ServerResponse){
 const db=supabaseFromEnv();
 try{
  const url=new URL(req.url??"/api/integration-connections","http://local");
  if(req.method==="GET"&&url.searchParams.get("callback")==="1"){
   const error=url.searchParams.get("error");if(error)return redirect(res,`/?oauth=erro&detail=${encodeURIComponent(error)}#sistema/conexoes`);
   const connected=await finishOAuth(db,url.searchParams.get("state")??"",url.searchParams.get("code")??"");
   return redirect(res,`/?oauth=${connected}#sistema/conexoes`);
  }
  const identity=await authenticatePanelRequest(req,db);if(!identity.owner)return json(res,403,{error:"owner_only"});
  if(req.method==="GET")return json(res,200,{connections:await connectionStatus(db)});
  if(req.method!=="POST")return json(res,405,{error:"method_not_allowed"});
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:"same_origin_required"});
  const body=await bodyOf(req),selected=provider(body.provider);if(!selected)return json(res,400,{error:"invalid_provider"});
  if(body.action==="connect")return json(res,200,await beginOAuth(db,selected,identity.personId,req));
  if(body.action==="disconnect"){await disconnectOAuth(db,selected);return json(res,200,{ok:true});}
  if(body.action==="test"&&selected==="meta_ads"){const tools=await listMetaAdsMcpTools(db);return json(res,200,{ok:true,toolCount:tools.length,tools:tools.map(tool=>tool.name)});}
  return json(res,400,{error:"invalid_action"});
 }catch(error){const message=error instanceof Error?error.message:"Falha na conexao";const status=message==="login_required"?401:/revogado|owner_only/i.test(message)?403:/invalid_|too_large/i.test(message)?400:500;return json(res,status,{error:message});}
}
