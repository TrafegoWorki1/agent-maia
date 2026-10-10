import { describe,it,expect,vi } from "vitest";
import type { IncomingMessage,ServerResponse } from "node:http";
import handler from "../api/workspace.ts";
import { handleWorkspace } from "../server/workspaceApi.ts";
import type { Db } from "../server/store.ts";

function response() {
  const res = { statusCode:0,setHeader:vi.fn(),end:vi.fn() };
  return { raw:res,typed:res as unknown as ServerResponse };
}
describe("API de trabalho protegida", () => {
  it("produção sem JWT não toca o banco", async () => {
    const r=response();
    await handler({ headers:{},method:"POST" } as IncomingMessage,r.typed);
    expect(r.raw.statusCode).toBe(401);
    expect(r.raw.end).toHaveBeenCalledWith('{"error":"login_required"}');
  });
  it("escrita rejeita origem de terceiro", async () => {
    const r=response(),db={ from:vi.fn() };
    await handleWorkspace({ method:"POST",headers:{ host:"localhost:3000",origin:"https://third.example","content-type":"application/json" } } as IncomingMessage,r.typed,db as unknown as Db,"owner-test");
    expect(r.raw.statusCode).toBe(403); expect(db.from).not.toHaveBeenCalled();
  });
  it("escrita não aceita formulário CSRF sem JSON", async () => {
    const r=response(),db={ from:vi.fn() };
    await handleWorkspace({ method:"POST",headers:{ host:"localhost:3000","content-type":"application/x-www-form-urlencoded" } } as IncomingMessage,r.typed,db as unknown as Db,"owner-test");
    expect(r.raw.statusCode).toBe(415); expect(db.from).not.toHaveBeenCalled();
  });
});
