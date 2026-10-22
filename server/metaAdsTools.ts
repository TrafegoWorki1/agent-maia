import {z} from "zod";
import type {Db} from "./store.ts";
import {getMcpInsights,listMcpAdAccounts,listMcpCampaigns} from "./integrations/metaAdsMcpAdapter.ts";

export interface MetaAdsTool{name:string;description:string;schema:z.ZodObject<z.ZodRawShape>;run:(db:Db,input:unknown)=>Promise<unknown>}
function define<S extends z.ZodRawShape>(name:string,description:string,shape:S,run:(db:Db,input:z.infer<z.ZodObject<S>>)=>Promise<unknown>):MetaAdsTool{
 const schema=z.object(shape);return {name,description,schema:schema as unknown as z.ZodObject<z.ZodRawShape>,run:async(db,input)=>run(db,schema.parse(input))};
}
const conta=z.string().regex(/^(?:act_)?\d{5,30}$/).describe("ID da conta de anúncios act_... retornado por meta_ads_contas.");
export const metaAdsTools:MetaAdsTool[]=[
 define("meta_ads_contas","Lista as contas de anúncios acessíveis pela conexão Meta Ads do Zernio. Só leitura.",{},db=>listMcpAdAccounts(db)),
 define("meta_ads_campanhas","Lista campanhas, conjuntos e anúncios da conta Meta Ads conectada ao Zernio. Só leitura.",{conta,limite:z.number().int().min(1).max(100).optional()},(db,i)=>listMcpCampaigns(db,i.conta,i.limite??50)),
 define("meta_ads_insights","Consulta gasto e métricas da Meta via Zernio por período e nível. Só leitura; não soma moedas diferentes.",{conta,inicio:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),fim:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),nivel:z.enum(["account","campaign","adset","ad"]).optional()},(db,i)=>getMcpInsights(db,{accountId:i.conta,since:i.inicio,until:i.fim,level:i.nivel})),
];
