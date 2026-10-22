// Adaptador das ferramentas estáveis da Maia para o MCP oficial do Meta Ads.
// A autenticação vem do login OAuth feito no painel; nenhum token é argumento da ferramenta.
import type {Db} from "../store.ts";
import {callMetaAdsMcpTool} from "./metaAdsMcp.ts";

export class MetaAdsMcpError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export function normalizeMcpAccountId(value:string):string{const clean=value.trim();if(!/^(?:act_)?\d{5,30}$/.test(clean))throw new MetaAdsMcpError("ID da conta de anúncios inválido");return clean.startsWith("act_")?clean:`act_${clean}`;}
export function buildMcpInsightsParams(input:{since:string;until:string;level?:"account"|"campaign"|"adset"|"ad"}):{ok:true;params:Record<string,string>}|{ok:false;error:string}{
 const since=Date.parse(`${input.since}T00:00:00Z`),until=Date.parse(`${input.until}T00:00:00Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.since)||!/^\d{4}-\d{2}-\d{2}$/.test(input.until)||!Number.isFinite(since)||!Number.isFinite(until))return {ok:false,error:"período inválido; use AAAA-MM-DD"};
 if(until<since)return {ok:false,error:"fim do período anterior ao início"};if(until-since>366*86_400_000)return {ok:false,error:"período maior que 366 dias"};
 return {ok:true,params:{since:input.since,until:input.until,level:input.level??"account"}};
}
export async function listMcpAdAccounts(db:Db):Promise<unknown>{return callMetaAdsMcpTool(db,"ads_get_ad_accounts",{});}
export async function listMcpCampaigns(db:Db,accountId?:string,limit=50):Promise<unknown>{return callMetaAdsMcpTool(db,"ads_get_ad_entities",{...(accountId?{ad_account_id:normalizeMcpAccountId(accountId)}:{}),entity_type:"campaign",limit:Math.min(100,Math.max(1,Math.trunc(limit)))});}
export async function getMcpInsights(db:Db,input:{accountId?:string;since:string;until:string;level?:"account"|"campaign"|"adset"|"ad"}):Promise<unknown>{const built=buildMcpInsightsParams(input);if(!built.ok)throw new MetaAdsMcpError(built.error);return callMetaAdsMcpTool(db,"ads_insights_performance_trend",{...(input.accountId?{ad_account_id:normalizeMcpAccountId(input.accountId)}:{}),since:built.params.since,until:built.params.until,level:built.params.level});}
