import {getAccessToken} from "./integrations/googleDrive.ts";
import {saveSnapshot,type Db,type SourceId} from "./store.ts";
import {collectConfiguredSources} from "./panelSources.ts";
let refreshing=false;
export const isPanelRefreshing=()=>refreshing;
async function googleGet(path:string):Promise<any>{
 const token=await getAccessToken(),response=await fetch("https://www.googleapis.com/"+path,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error("Google respondeu HTTP "+response.status+"; confira escopos e autorização OAuth");
 return await response.json();
}
export async function collectSourceHealth(db:Db,source:SourceId){
 const attempt=new Date().toISOString();let data:unknown,error:string|null=null;
 try{
  if(source==="sheets"){const r=await googleGet("drive/v3/files?q="+encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")+"&pageSize=5&orderBy=modifiedTime%20desc&fields=files(name,modifiedTime)");data={sheets:(r.files??[]).map((v:any)=>({name:v.name,modified_at:v.modifiedTime}))};}
  else if(source==="calendar"){const r=await googleGet("calendar/v3/users/me/calendarList?maxResults=250&fields=items(summary),nextPageToken");if(r.nextPageToken)throw new Error("Lista excede 250 calendários; cobertura incompleta");data={calendars:(r.items??[]).map((v:any)=>({name:v.summary??"Sem nome"}))};}
  else if(source==="gmail"){
   const count=async(q:string)=>{const r=await googleGet("gmail/v1/users/me/messages?q="+encodeURIComponent(q)+"&maxResults=100&fields=messages(id),nextPageToken");return (r.messages??[]).length;};
   data={unread_count:await count("is:unread"),unread_last_24h:await count("is:unread newer_than:1d")};
  }else throw new Error("Meta Ads sem coletor direto configurado. Cadastre uma fonte de campanhas em Fontes gerenciais.");
 }catch(e){error=e instanceof Error?e.message:"Falha ao ler fonte";}
 const result=await db.from("panel_source_health").upsert({source,last_attempt_at:attempt,...(error===null?{last_success_at:new Date().toISOString()}:{}),error},{onConflict:"source"});
 if(result.error)throw new Error(result.error.message);
 await saveSnapshot(db,source,error===null?{status:"ok",data}:{status:"error",error});
}
export async function refreshPanelSources(db:Db,includeConfigured=true){
 if(refreshing)return false;refreshing=true;
 try{for(const source of ["sheets","calendar","gmail","meta"] as SourceId[])await collectSourceHealth(db,source);if(includeConfigured)await collectConfiguredSources(db);return true;}finally{refreshing=false;}
}
export function schedulePanelCollection(db:Db){
 let stopped=false;
 const run=()=>{if(!stopped)void refreshPanelSources(db).catch(e=>console.error("[panel-collector]",e instanceof Error?e.message:"Falha na coleta"));};
 const initial=setTimeout(run,1000),timer=setInterval(run,30*60*1000);
 return()=>{stopped=true;clearTimeout(initial);clearInterval(timer);};
}
