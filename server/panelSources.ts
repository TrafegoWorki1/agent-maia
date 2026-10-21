import type {Db} from "./store.ts";
import {getAccessToken} from "./integrations/googleDrive.ts";
import {PANEL_METRICS,validDay,type PanelMetricCode,type PanelObservation,type PanelSourceConfig,type PanelSourceView} from "../src/lib/panelSourceModel.ts";
const uuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function check(error:{message:string}|null){if(error)throw new Error(error.message);}
export function validatePanelSource(input:unknown):Omit<PanelSourceConfig,"id"|"revision">{
 if(!input||typeof input!=="object")throw new Error("Configuração inválida");
 const c=input as Record<string,any>,metric=PANEL_METRICS[c.metric_code as PanelMetricCode];
 if(!metric)throw new Error("Métrica não suportada");
 const sourceRef=String(c.source_ref??"").match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1]??String(c.source_ref??"").trim();
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(sourceRef))throw new Error("Informe o ID ou link da planilha");
 // Intervalo limitado e explícito: a primeira linha contém os nomes das colunas.
 const range=String(c.range_ref??"").trim();
 const match=range.match(/^(?:'[^']{1,80}'|[^'!]{1,80})!([A-Z]{1,2})([1-9]\d*):([A-Z]{1,2})([1-9]\d*)$/);
 const col=(v:string)=>[...v].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
 if(!match||Number(match[4])-Number(match[2])>5000||Number(match[4])<=Number(match[2])||col(match[3])<col(match[1])||col(match[3])-col(match[1])>51)throw new Error("Use um intervalo com cabeçalho e até 5.000 linhas e 52 colunas, por exemplo Dados!A1:F5001");
 const mapping=c.mapping;
 if(!mapping||!["key","date","value"].every(k=>typeof mapping[k]==="string"&&mapping[k].trim().length>0&&mapping[k].length<=80)||new Set(Object.values(mapping)).size!==3)throw new Error("Mapeie três colunas diferentes: identificador, data e valor");
 if(!["BRL","USD","EUR","count"].includes(c.unit)||(metric.unit==="count")!==(c.unit==="count"))throw new Error("Unidade incompatível com a métrica");
 for(const [key,max] of [["name",120],["basis",250],["coverage",500]] as const)if(typeof c[key]!=="string"||!c[key].trim()||c[key].length>max)throw new Error("Preencha nome, regime/objetivo e cobertura");
 if((c.client_id&&!uuid(c.client_id))||(c.project_id&&!uuid(c.project_id)))throw new Error("Escopo inválido");
 return {name:c.name.trim(),provider:"google_sheets",metric_code:c.metric_code,source_ref:sourceRef,range_ref:range,mapping:{key:mapping.key.trim(),date:mapping.date.trim(),value:mapping.value.trim()},unit:c.unit,basis:c.basis.trim(),coverage:c.coverage.trim(),client_id:c.client_id||null,project_id:c.project_id||null,active:c.active===true};
}
function sourceDay(value:unknown):string{
 if(typeof value==="number"&&Number.isFinite(value))return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 const s=String(value??"").trim(),br=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
 const day=br?br[3]+"-"+br[2]+"-"+br[1]:s;
 if(!validDay(day))throw new Error("Data inválida; use datas da planilha, AAAA-MM-DD ou DD/MM/AAAA");
 return day;
}
export function parsePanelRows(values:unknown[][],mapping:PanelSourceConfig["mapping"]):PanelObservation[]{
 if(values.length>5001)throw new Error("Limite de 5.000 registros excedido");
 if(!values.length)throw new Error("Intervalo sem cabeçalho");
 const header=values[0].map(v=>String(v).trim()),indices=["key","date","value"].map(k=>{
 const name=mapping[k as keyof typeof mapping],found=header.flatMap((v,i)=>v===name?[i]:[]);
 if(found.length!==1)throw new Error("Coluna ausente ou repetida: "+name);return found[0];});
 const seen=new Set<string>(),rows:PanelObservation[]=[];
 for(let i=1;i<values.length;i++){
  const row=values[i];if(row.every(v=>v===null||v===undefined||String(v).trim()===""))continue;
  const key=String(row[indices[0]]??"").trim(),value=row[indices[2]];
  if(!key||key.length>200)throw new Error("Identificador obrigatório na linha "+(i+1));
  if(seen.has(key))throw new Error("Identificador duplicado na linha "+(i+1));
  if(typeof value!=="number"||!Number.isFinite(value))throw new Error("Valor deve ser numérico na linha "+(i+1));
  const date=sourceDay(row[indices[1]]);if(!validDay(date))throw new Error("Data inválida na linha "+(i+1));
  seen.add(key);rows.push({key,date,value});
 }return rows;
}
export async function savePanelSource(db:Db,input:unknown,id:unknown,revision:unknown){
 const config=validatePanelSource(input);
 if(config.project_id){const project=await db.from("work_projects").select("client_id").eq("id",config.project_id).single();check(project.error);if(project.data?.client_id!==config.client_id)throw new Error("Projeto não pertence ao cliente selecionado");}
 if(id){
  if(!uuid(id)||!Number.isInteger(revision)||Number(revision)<1)throw new Error("Revisão inválida");
  const result=await db.from("panel_data_sources").update({...config,revision:Number(revision)+1,updated_at:new Date().toISOString()}).eq("id",id).eq("revision",revision).select("id").maybeSingle();
  check(result.error);if(!result.data)throw new Error("Configuração alterada em outra sessão; atualize a tela");
 }else{
  const count=await db.from("panel_data_sources").select("id",{count:"exact",head:true});check(count.error);
  if((count.count??0)>=20)throw new Error("Limite de 20 fontes; edite uma fonte existente");
  check((await db.from("panel_data_sources").insert(config)).error);
 }
}
export async function panelSourcesView(db:Db,sourceId?:string):Promise<PanelSourceView[]>{
 let query=db.from("panel_data_sources").select("*,maia_clients(name),work_projects(name)").order("name");
 if(sourceId)query=query.eq("id",sourceId);
 const configs=await query;check(configs.error);
 return await Promise.all((configs.data??[]).map(async c=>{
 const [latest,success,history]=await Promise.all([
 db.from("panel_source_runs").select("id,status,started_at,completed_at,error").eq("source_id",c.id).eq("config_revision",c.revision).order("started_at",{ascending:false}).limit(1).maybeSingle(),
 db.from("panel_source_runs").select("id,status,started_at,completed_at,error"+(sourceId?",observations":"")).eq("source_id",c.id).eq("config_revision",c.revision).eq("status","ok").order("completed_at",{ascending:false}).limit(1).maybeSingle(),
 db.from("panel_source_runs").select("id,status,config_revision,started_at,completed_at,error").eq("source_id",c.id).order("started_at",{ascending:false}).limit(5)
 ]);check(latest.error);check(success.error);check(history.error);const good=success.data as unknown as PanelSourceView["success"];return {...c,clientName:c.maia_clients?.name,projectName:c.work_projects?.name,latest:latest.data,success:good?{...good,observations:good.observations??[]}:null,history:history.data} as PanelSourceView;
 }));
}
export async function collectPanelSource(db:Db,id:string){
 const query=await db.from("panel_data_sources").select("*").eq("id",id).single();check(query.error);
 const config=query.data as PanelSourceConfig;
 const claim=await db.rpc("claim_panel_source",{p_source:id,p_revision:config.revision});check(claim.error);
 if(!claim.data)return {started:false};
 const run=String(claim.data);
 try{
 const token=await getAccessToken();
 const response=await fetch("https://sheets.googleapis.com/v4/spreadsheets/"+encodeURIComponent(config.source_ref)+"/values/"+encodeURIComponent(config.range_ref)+"?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER",{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error("Google Sheets respondeu HTTP "+response.status+"; confira acesso e intervalo");
 const payload=await response.json() as {values?:unknown[][]};
 const rows=parsePanelRows(payload.values??[],config.mapping);
 if(config.unit==="count"&&rows.some(r=>!Number.isInteger(r.value)||r.value<0))throw new Error("Contagens precisam ser inteiras e não negativas");
 check((await db.rpc("finish_panel_source",{p_run:run,p_rows:rows,p_error:null})).error);
 return {started:true,rows:rows.length};
 }catch(error){
 const message=error instanceof Error?error.message:"Falha na coleta";
 check((await db.rpc("finish_panel_source",{p_run:run,p_rows:null,p_error:message.slice(0,500)})).error);
 return {started:true,error:message.slice(0,500)};
 }
}
export async function collectConfiguredSources(db:Db){
 const configs=await db.from("panel_data_sources").select("id").eq("active",true);check(configs.error);
 for(const row of configs.data??[])await collectPanelSource(db,String(row.id));
}
