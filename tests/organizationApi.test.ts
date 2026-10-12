import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/organization.ts";
const mocks=vi.hoisted(()=>({ rpc:vi.fn(),service:vi.fn(),handle:vi.fn() }));
vi.mock("@supabase/supabase-js",()=>({ createClient:()=>({ rpc:mocks.rpc }) }));
vi.mock("../server/supabaseClient.ts",()=>({ supabaseFromEnv:mocks.service }));
vi.mock("../server/organizationApi.ts",()=>({ handleOrganization:mocks.handle }));
beforeEach(()=>{ vi.stubEnv("SUPABASE_URL","https://project.example.test");vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY","fixture");mocks.rpc.mockResolvedValue({ data:false,error:null }); });
function request(token?:string) { return Object.assign(Readable.from([]),{ method:"GET",headers:{ ...(token ? { authorization:`Bearer ${token}` } : {}) } }) as IncomingMessage; }
function response() { const res={ statusCode:0,setHeader:vi.fn(),end:vi.fn() };return { res:res as unknown as ServerResponse,body:res }; }
describe("cadastros globais são exclusivos do proprietário",()=>{
  it("sem login retorna 401 sem criar cliente de serviço",async()=>{
    const { res,body }=response();await handler(request(),res);
    expect(body.statusCode).toBe(401);expect(mocks.service).not.toHaveBeenCalled();
  });
  it("login sem papel proprietário retorna 403",async()=>{
    const { res,body }=response();await handler(request("fixture"),res);
    expect(body.statusCode).toBe(403);expect(mocks.handle).not.toHaveBeenCalled();
  });
  it("erro na verificação de papel não libera dados",async()=>{
    mocks.rpc.mockResolvedValue({ data:true,error:{ message:"failed" } });
    const { res,body }=response();await handler(request("fixture"),res);
    expect(body.statusCode).toBe(403);expect(mocks.handle).not.toHaveBeenCalled();
  });
  it("proprietário confirmado chega ao cadastro de serviço",async()=>{
    mocks.rpc.mockResolvedValue({ data:true,error:null });mocks.service.mockReturnValue({ fixture:true });
    const { res }=response();const req=request("fixture");await handler(req,res);
    expect(mocks.handle).toHaveBeenCalledWith(req,res,{ fixture:true });
  });
});
