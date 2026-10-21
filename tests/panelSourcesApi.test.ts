import {describe,it,expect,vi,beforeEach} from "vitest";
import {Readable} from "node:stream";
import type {IncomingMessage,ServerResponse} from "node:http";
import handler from "../api/panel-sources";
const mocks=vi.hoisted(()=>({auth:vi.fn(),view:vi.fn(),save:vi.fn(),collect:vi.fn()}));
vi.mock("../server/panelIdentity.ts",()=>({authenticatePanelRequest:mocks.auth}));
vi.mock("../server/supabaseClient.ts",()=>({supabaseFromEnv:()=>({})}));
vi.mock("../server/panelSources.ts",()=>({panelSourcesView:mocks.view,savePanelSource:mocks.save,collectPanelSource:mocks.collect}));
async function request(method="GET",body?:unknown,headers:Record<string,string>={}){
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]) as IncomingMessage;req.method=method;req.headers={host:"panel.test","content-type":"application/json",...headers};
 let status=0,result:any;const res={setHeader:vi.fn(),set statusCode(v:number){status=v;},end(value:string){result=JSON.parse(value);}} as unknown as ServerResponse;
 await handler(req,res);return {status,result};
}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({owner:true});mocks.view.mockResolvedValue([]);mocks.collect.mockResolvedValue({started:true});});
describe("Acesso às fontes gerenciais",()=>{
 it("exige login e proprietário para leitura e escrita",async()=>{mocks.auth.mockRejectedValue(new Error("login_required"));expect((await request()).status).toBe(401);mocks.auth.mockResolvedValue({owner:false});expect((await request()).status).toBe(403);expect((await request("POST",{action:"collect",id:"a"})).status).toBe(403);expect(mocks.view).not.toHaveBeenCalled();expect(mocks.collect).not.toHaveBeenCalled();});
 it("recusa outra origem, formatos e ações inválidas",async()=>{expect((await request("POST",{action:"save"},{origin:"https://outro.test"})).status).toBe(403);expect((await request("POST",{},{"content-type":"text/plain"})).status).toBe(415);expect((await request("POST",{action:"erase"})).status).toBe(400);expect((await request("DELETE")).status).toBe(405);expect(mocks.save).not.toHaveBeenCalled();});
 it("revalida proprietário antes de entregar dados",async()=>{mocks.auth.mockResolvedValueOnce({owner:true}).mockResolvedValueOnce({owner:false});expect((await request()).status).toBe(403);});
 it("salva configuração com revisão e retorna a leitura atual",async()=>{const config={name:"Fonte"};expect((await request("POST",{action:"save",config,id:"source",revision:3})).status).toBe(200);expect(mocks.save).toHaveBeenCalledWith({},config,"source",3);});
});
