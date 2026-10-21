// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {SourceResults} from "../src/features/management/SourceResults";
import {panelSourcesRequest} from "../src/lib/panelSourcesApi";
import {brtDate} from "../src/lib/managementAnalytics";
vi.mock("../src/lib/panelSourcesApi",()=>({panelSourcesRequest:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root;
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML="";vi.clearAllMocks();});
describe("Detalhe de fontes",()=>{
 it("pagina registros sem mudar o total e conserva último sucesso após erro",async()=>{
 const now=new Date().toISOString(),id="12345678-1234-1234-1234-123456789abc";
 const source={id,name:"Recebido real",metric_code:"finance.received",unit:"BRL",basis:"Caixa",coverage:"Agência",active:true,client_id:null,project_id:null,latest:{started_at:now,status:"error",error:"Leitura recusada"},success:{started_at:now,completed_at:now,observations:Array.from({length:205},(_,i)=>({key:"id-"+i,date:brtDate(new Date()),value:1}))}};
 vi.mocked(panelSourcesRequest).mockImplementation(async(_body,sourceId)=>({sources:[sourceId?source:{...source,success:{...source.success,observations:[]}}] as any,generatedAt:now}));
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);
 await act(async()=>root.render(createElement(SourceResults,{kind:"finance"})));
 expect(panelSourcesRequest).toHaveBeenCalledWith(undefined,id);
 expect(node.querySelector(".work-indicator-measure strong")?.textContent).toBe("205");
 expect(node.textContent).toContain("Leitura recusada");
 const rows=()=>node.querySelectorAll('table[aria-label="Registros da fonte"] tbody tr');
 expect(rows()).toHaveLength(100);
 await act(async()=>(node.querySelector('button[aria-label="Próximos registros"]') as HTMLButtonElement).click());
 await act(async()=>(node.querySelector('button[aria-label="Próximos registros"]') as HTMLButtonElement).click());
 expect(rows()).toHaveLength(5);expect(node.querySelector(".work-indicator-measure strong")?.textContent).toBe("205");
 });
});
