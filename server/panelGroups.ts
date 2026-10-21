import type {LiveGroup} from "./groups.ts";
// O contador de group_activity é acumulado. Não existe série diária para reconstruir sete dias.
export function mergePanelGroups(live:LiveGroup[],registered:Array<{jid:string;name:string}>,activity:Array<{jid:string;messages:number;last_at:string}>){
 const map=new Map<string,{jid:string;subject:string;size:number|null;messages7d:null;recordedMessages:number|null;lastActivity:string|null}>();
 for(const g of registered)map.set(g.jid,{jid:g.jid,subject:g.name,size:null,messages7d:null,recordedMessages:null,lastActivity:null});
 for(const g of live)map.set(g.jid,{...g,messages7d:null,recordedMessages:null,lastActivity:null});
 for(const a of activity){if(!a.jid.endsWith("@g.us"))continue;const row=map.get(a.jid)??{jid:a.jid,subject:"Grupo com atividade registrada",size:null,messages7d:null,recordedMessages:null,lastActivity:null};map.set(a.jid,{...row,recordedMessages:a.messages,lastActivity:a.last_at});}
 return [...map.values()].sort((a,b)=>(b.lastActivity??"").localeCompare(a.lastActivity??"")||a.subject.localeCompare(b.subject));
}
