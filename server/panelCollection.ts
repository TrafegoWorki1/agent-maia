import {getAccessToken} from "./integrations/googleDrive.ts";
import {saveSnapshot,type Db,type SourceId} from "./store.ts";
import {collectConfiguredSources} from "./panelSources.ts";
import {runClaudeSimple} from "./ai/providers/claudeSimple.ts";
import {isReadTool} from "./approvalPolicy.ts";
import {SOURCES,parseJsonObject} from "./refreshJob.ts";
let refreshing=false;
export const isPanelRefreshing=()=>refreshing;
async function googleGet(path:string):Promise<any>{
 const token=await getAccessToken(),response=await fetch("https://www.googleapis.com/"+path,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error("Google respondeu HTTP "+response.status+"; confira escopos e autorização OAuth");
 return await response.json();
}
// Calendar, Gmail e Meta Ads passam pelo Claude Code CLI, usando os conectores mcp__claude_ai_* desta
// conta (decisão do owner, 21/10/2026): essas três fontes não têm um token/coletor direto próprio do
// servidor, e os conectores da conta já leem Google Calendar/Gmail e Meta Ads sem escopo adicional.
// Sheets continua lendo o Drive direto (token OAuth do servidor), mais barato e sem depender do CLI.
// US$0,50/8 turnos estourou em produção (calendar falhou com error_max_budget_usd) mesmo numa
// consulta de uma ferramenta só: o CLI carrega o contexto de todos os servidores MCP configurados
// na conta/máquina (não só os liberados aqui), então o custo por chamada varia com o que mais estiver
// conectado. Teto maior dá folga sem abrir mão do valor baixo por fonte.
const CLAUDE_SOURCE_BUDGET_USD=1.5,CLAUDE_SOURCE_MAX_TURNS=12,CLAUDE_SOURCE_MODEL="haiku";
async function collectViaClaude(source:Exclude<SourceId,"sheets">):Promise<unknown>{
 const {prompt,tools,validate}=SOURCES[source];
 const answer=await runClaudeSimple({prompt,systemPrompt:"Você atualiza o painel gerencial da Maia com dados de leitura. Nunca execute ações.",model:CLAUDE_SOURCE_MODEL,maxTurns:CLAUDE_SOURCE_MAX_TURNS,maxBudgetUsd:CLAUDE_SOURCE_BUDGET_USD,allowTool:(toolName)=>isReadTool(toolName)&&tools.includes(toolName)});
 const parsed=parseJsonObject(answer.text);
 if(typeof parsed.error==="string")throw new Error(parsed.error);
 return validate(parsed);
}
export async function collectSourceHealth(db:Db,source:SourceId){
 const attempt=new Date().toISOString();let data:unknown,error:string|null=null;
 try{
  if(source==="sheets"){const r=await googleGet("drive/v3/files?q="+encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")+"&pageSize=5&orderBy=modifiedTime%20desc&fields=files(name,modifiedTime)");data={sheets:(r.files??[]).map((v:any)=>({name:v.name,modified_at:v.modifiedTime}))};}
  else data=await collectViaClaude(source);
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
