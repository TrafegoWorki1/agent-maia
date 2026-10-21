import {describe,it,expect} from "vitest";
import {compareSources} from "../src/lib/sourceComparisons";
import type {PanelSourceView,PanelMetricCode} from "../src/lib/panelSourceModel";
const now=Date.parse("2026-10-20T15:00:00Z"),start="2026-10-19",end="2026-10-25";
function source(code:PanelMetricCode,value:number,extra:Partial<PanelSourceView>={}):PanelSourceView{return{id:code,name:code,metric_code:code,provider:"google_sheets",source_ref:code,range_ref:"Dados!A1:C10",mapping:{key:"id",date:"data",value:"valor"},basis:"mesmo critério",coverage:"completa",unit:code==="campaign.results"||code.startsWith("sales.")?"count":"BRL",client_id:"client",project_id:"p",active:true,revision:1,latest:{id:"run",status:"ok",started_at:"2026-10-20T14:30:00Z",completed_at:"2026-10-20T14:35:00Z",error:null},success:{id:"run",status:"ok",started_at:"2026-10-20T14:30:00Z",completed_at:"2026-10-20T14:35:00Z",error:null,observations:[{key:"1",date:"2026-10-19",value}]},...extra};}
describe("Comparações de fontes explícitas",()=>{
 it("não calcula sem confirmação de cobertura, com fonte faltante, escopo ou moeda diferente",()=>{
  const sources=[source("finance.expected",100),source("finance.received",80)];
  for(const [rows,confirmed] of [[sources,false],[sources.slice(0,1),true],[[sources[0],{...sources[1],client_id:"other"}],true],[[sources[0],{...sources[1],unit:"USD"}],true]] as const)expect(compareSources("forecast",[...rows],start,end,confirmed,now).available).toBe(false);
 });
 it("rejeita coleta falha, desatualizada, inativa ou sem sucesso",()=>{
  const spend=source("campaign.spend",100),revenue=source("campaign.attributed_revenue",400);
  for(const patch of [{active:false},{success:null},{latest:{...revenue.latest!,status:"error" as const}},{success:{...revenue.success!,completed_at:"2026-10-20T10:00:00Z"}}])expect(compareSources("roas",[spend,{...revenue,...patch}],start,end,true,now).available).toBe(false);
 });
 it("calcula fluxo e margem de caixa com estornos preservados e sem somar saldo vencido",()=>{
  const rows=[source("finance.received",1000),source("finance.costs",400),source("finance.expenses",-50)];
  expect(compareSources("cash",rows,start,end,true,now)).toMatchObject({available:true,value:650,unit:"BRL",rows:[{primary:650}]});expect(compareSources("margin",rows,start,end,true,now).value).toBe(65);
  expect(compareSources("cash",[...rows.slice(0,2),source("finance.overdue",50)],start,end,true,now).available).toBe(false);
 });
 it("recusa identificadores sobrepostos de custos e despesas na mesma origem",()=>{
  const rows=[source("finance.received",1000),source("finance.costs",400,{source_ref:"mesma"}),source("finance.expenses",50,{source_ref:"mesma"})];expect(compareSources("cash",rows,start,end,true,now).reason).toContain("sobreposição");
 });
 it("ROAS e custo por resultado usam seus denominadores, mantendo zero legítimo",()=>{
  expect(compareSources("roas",[source("campaign.spend",100),source("campaign.attributed_revenue",400)],start,end,true,now).value).toBe(4);
  expect(compareSources("roas",[source("campaign.spend",0),source("campaign.attributed_revenue",400)],start,end,true,now).value).toBeNull();
  expect(compareSources("cpr",[source("campaign.spend",0),source("campaign.results",5)],start,end,true,now)).toMatchObject({available:true,value:0});
  expect(compareSources("cpr",[source("campaign.spend",100),source("campaign.results",0)],start,end,true,now).available).toBe(false);
 });
 it("ganho externo exige vendas encerradas e não transforma denominador vazio em taxa zero",()=>{
  expect(compareSources("win_rate",[source("sales.won",3),source("sales.lost",1)],start,end,true,now).value).toBe(75);
  expect(compareSources("win_rate",[source("sales.won",0),source("sales.lost",0)],start,end,true,now).value).toBeNull();
 });
});
