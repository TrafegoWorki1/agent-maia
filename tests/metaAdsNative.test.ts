import {describe,expect,it} from "vitest";
import {decideAccess,type Requester} from "../server/access.ts";
import {isReadTool,requiresApproval} from "../server/approvalPolicy.ts";
import {buildMcpInsightsParams,normalizeMcpAccountId,MetaAdsMcpError} from "../server/integrations/metaAdsMcpAdapter.ts";
import {metaAdsTools} from "../server/metaAdsTools.ts";
import {isKnownMcpTool} from "../server/toolPolicy.ts";

const owner:Requester={role:"owner",name:"Herickson",number:"5511988886666",permissions:new Set()};
const member=(...permissions:string[]):Requester=>({role:"member",personId:"p1",name:"Jéssica",number:"5585911112222",permissions:new Set(permissions)});

describe("política das ferramentas Meta Ads via MCP oficial",()=>{
 it("expõe somente as três leituras",()=>{
  expect(metaAdsTools.map(tool=>tool.name)).toEqual(["meta_ads_contas","meta_ads_campanhas","meta_ads_insights"]);
  for(const tool of metaAdsTools){expect(isKnownMcpTool("mcp__maia__"+tool.name)).toBe(true);expect(isReadTool("mcp__maia__"+tool.name)).toBe(true);}
 });
 it("não expõe escrita nesta primeira etapa",()=>{
  for(const name of ["meta_ads_criar_campanha","meta_ads_alterar_status","meta_ads_excluir"]){
   expect(isKnownMcpTool("mcp__maia__"+name)).toBe(false);
   expect(decideAccess("mcp__maia__"+name,owner,{},false).decision).toBe("deny");
  }
 });
 it("membro consulta com meta.ler e sem ela pede aprovação",()=>{
  expect(decideAccess("mcp__maia__meta_ads_insights",member("meta.ler"),{},true).decision).toBe("allow");
  expect(decideAccess("mcp__maia__meta_ads_insights",member(),{},true).decision).toBe("approve");
  expect(requiresApproval("mcp__maia__meta_ads_insights")).toBe(false);
 });
});
describe("validação dos argumentos Meta MCP",()=>{
 it("normaliza a conta e rejeita identificadores inválidos",()=>{
  expect(normalizeMcpAccountId("123456789")).toBe("act_123456789");
  expect(normalizeMcpAccountId("act_123456789")).toBe("act_123456789");
  expect(()=>normalizeMcpAccountId("act_x")).toThrow(MetaAdsMcpError);
 });
 it("aceita período válido e rejeita intervalo invertido ou excessivo",()=>{
  const built=buildMcpInsightsParams({since:"2026-10-01",until:"2026-10-22",level:"campaign"});
  expect(built.ok&&built.params.level).toBe("campaign");
  expect(buildMcpInsightsParams({since:"2026-10-22",until:"2026-10-01"}).ok).toBe(false);
  expect(buildMcpInsightsParams({since:"2020-01-01",until:"2026-10-01"}).ok).toBe(false);
 });
});
