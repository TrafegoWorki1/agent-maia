import {supabase} from "./supabaseBrowser";

export interface IntegrationConnection {connected:boolean;detail:string}
export interface IntegrationConnections {meta_ads:IntegrationConnection}

async function authHeaders():Promise<Record<string,string>>{
 const session=await supabase?.auth.getSession();
 return {"Content-Type":"application/json",...(session?.data.session?{Authorization:`Bearer ${session.data.session.access_token}`}:{})};
}

async function request(method:"GET"|"POST",body?:unknown):Promise<Record<string,unknown>>{
 const response=await fetch("/api/integration-connections",{method,cache:"no-store",headers:await authHeaders(),...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json().catch(()=>({})) as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof result.error==="string"?result.error:`Falha na conexão (HTTP ${response.status})`);
 return result;
}

export async function fetchIntegrationConnections():Promise<IntegrationConnections>{
 const result=await request("GET");return result.connections as unknown as IntegrationConnections;
}
export async function startMetaConnection():Promise<string>{
 const result=await request("POST",{action:"connect",provider:"meta_ads"});
 if(typeof result.authorizationUrl!=="string")throw new Error("A Meta não devolveu a página de autorização");
 return result.authorizationUrl;
}
export async function disconnectMeta():Promise<void>{await request("POST",{action:"disconnect",provider:"meta_ads"});}
export async function testMetaConnection():Promise<{toolCount:number;tools:string[]}>{
 const result=await request("POST",{action:"test",provider:"meta_ads"});
 return {toolCount:Number(result.toolCount??0),tools:Array.isArray(result.tools)?result.tools.map(String):[]};
}
