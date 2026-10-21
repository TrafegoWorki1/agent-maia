import {supabase} from "./supabaseBrowser";
import type {PanelSourceView} from "./panelSourceModel";
export async function panelSourcesRequest(body?:unknown):Promise<{sources:PanelSourceView[];generatedAt:string;result?:{started:boolean;error?:string}}>{
 const session=await supabase?.auth.getSession();
 const response=await fetch("/api/panel-sources",{method:body?"POST":"GET",cache:"no-store",headers:{"Content-Type":"application/json",...(session?.data.session?{Authorization:"Bearer "+session.data.session.access_token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error??"Falha ao consultar fontes");return result;
}
