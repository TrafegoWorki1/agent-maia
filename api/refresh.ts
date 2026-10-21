import type {IncomingMessage,ServerResponse} from "node:http";
import {authenticatePanelRequest} from "../server/panelIdentity.ts";
import {supabaseFromEnv} from "../server/supabaseClient.ts";
import {refreshPanelSources,isPanelRefreshing} from "../server/panelCollection.ts";
import {json} from "../server/workspaceApi.ts";
export const config={maxDuration:300};
export default async function handler(req:IncomingMessage,res:ServerResponse){
 if(req.method!=="POST")return json(res,405,{error:"method_not_allowed"});
 try{
 if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:"same_origin_required"});
 const db=supabaseFromEnv(),identity=await authenticatePanelRequest(req,db);
 if(!identity.owner)return json(res,403,{error:"owner_only"});
 if(isPanelRefreshing())return json(res,409,{error:"already_refreshing"});
 await refreshPanelSources(db,false);
 return json(res,200,{ok:true});
 }catch(e){const error=e instanceof Error?e.message:"Falha na coleta";return json(res,error==="login_required"?401:/revogado|sem vínculo/i.test(error)?403:500,{error});}
}
