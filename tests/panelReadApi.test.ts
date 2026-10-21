import {beforeEach,describe,it,expect,vi} from "vitest";
import {Readable} from "node:stream";
import type {IncomingMessage,ServerResponse} from "node:http";
import compactHandler from "../api/panel-collaboration";
import operationsHandler from "../api/panel-operations";
const mocks=vi.hoisted(()=>({auth:vi.fn(),view:vi.fn(),can:vi.fn(),from:vi.fn()}));
vi.mock("../server/panelIdentity.ts",()=>({authenticatePanelRequest:mocks.auth}));
vi.mock("../server/supabaseClient.ts",()=>({supabaseFromEnv:()=>({from:mocks.from})}));
vi.mock("../server/collaborativeWork.ts",()=>({collaborationView:mocks.view,canAccessTask:mocks.can,serializeIdentity:(identity:{version?:string;screens?:string[]})=>({accessVersion:identity.version??"a",screens:identity.screens??["meu-dia"]})}));
async function request(handler:typeof compactHandler,url:string,method="GET",origin?:string){
 const req=Readable.from([]) as IncomingMessage;req.url=url;req.method=method;req.headers={host:"panel.test",...(origin?{origin}:{})};
 let status=0,result:any;const headers:Record<string,string>={};const res={setHeader:(k:string,v:string)=>{headers[k]=v;},set statusCode(v:number){status=v;},end(v:string){result=JSON.parse(v);}} as unknown as ServerResponse;
 await handler(req,res);return{status,result,headers};
}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({owner:true});mocks.can.mockReturnValue(true);mocks.view.mockResolvedValue({tasks:[]});mocks.from.mockImplementation(table=>{
 const result={data:table==="work_tasks"?{id:1}:table==="work_task_history"?Array.from({length:101},(_,i)=>({id:i+1})):[],error:null};const q:any={then:(resolve:any)=>Promise.resolve(result).then(resolve)};for(const name of ["select","eq","gte","lte","order","range","maybeSingle"])q[name]=vi.fn(()=>q);return q;
});});
describe("Leituras próprias do painel",()=>{
 it("exige autenticação nas duas APIs e não consulta dados após recusa",async()=>{mocks.auth.mockRejectedValue(new Error("login_required"));for(const handler of [compactHandler,operationsHandler])expect((await request(handler,"/api/read")).status).toBe(401);expect(mocks.from).not.toHaveBeenCalled();expect(mocks.view).not.toHaveBeenCalled();});
 it("operações continuam exclusivas do proprietário",async()=>{mocks.auth.mockResolvedValue({owner:false});expect((await request(operationsHandler,"/api/panel-operations")).status).toBe(403);expect(mocks.from).not.toHaveBeenCalled();});
 it("indisponibilidade de leitura é 503 e não erro de preenchimento",async()=>{mocks.view.mockRejectedValue(new Error("database unavailable"));mocks.from.mockImplementation(()=>{throw new Error("database unavailable");});for(const handler of [compactHandler,operationsHandler])expect((await request(handler,"/api/read")).status).toBe(503);});
 it("recusa escrita, outra origem e períodos inválidos ou excessivos antes da leitura",async()=>{
  for(const handler of [compactHandler,operationsHandler]){expect((await request(handler,"/api/read","POST")).status).toBe(405);expect((await request(handler,"/api/read","GET","https://other.test")).status).toBe(403);expect((await request(handler,"/api/read?start=2026-02-30&end=2026-03-01")).status).toBe(400);expect((await request(handler,"/api/read?start=2024-01-01&end=2026-12-31")).status).toBe(400);}
  expect(mocks.view).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
 });
 it("a leitura compacta mantém a autorização existente e informa a janela",async()=>{mocks.auth.mockResolvedValue({owner:false});const r=await request(compactHandler,"/api/panel-collaboration?start=2026-10-01&end=2026-10-20");expect(r.status).toBe(200);expect(r.result.readWindow).toEqual({start:"2026-10-01",end:"2026-10-20",historyOnDemand:true});expect(mocks.view).toHaveBeenCalledWith(expect.anything(),{owner:false},expect.any(Date),"panel",{start:"2026-10-01",end:"2026-10-20"});expect(r.headers["Cache-Control"]).toContain("no-store");});
 it("revogação entre leitura e entrega bloqueia as duas respostas",async()=>{for(const handler of [compactHandler,operationsHandler]){mocks.auth.mockReset().mockResolvedValueOnce({owner:true,version:"a"}).mockResolvedValueOnce({owner:false,version:"b"});expect((await request(handler,"/api/read?start=2026-10-01&end=2026-10-20")).status).toBe(403);}});
 it("histórico é paginado e só é lido depois da autorização da tarefa",async()=>{
  mocks.can.mockReturnValue(false);expect((await request(compactHandler,"/api/panel-collaboration?task=1")).status).toBe(403);expect(mocks.from).not.toHaveBeenCalledWith("work_task_history");
  mocks.can.mockReturnValue(true);const r=await request(compactHandler,"/api/panel-collaboration?task=1&page=2");expect(r.status).toBe(200);expect(r.result.history).toHaveLength(100);expect(r.result.hasMore).toBe(true);expect(mocks.can).toHaveBeenCalledWith(expect.anything(),{id:1},"trabalho.ver");
  expect((await request(compactHandler,"/api/panel-collaboration?task=1&page=-1")).status).toBe(400);
 });
});
