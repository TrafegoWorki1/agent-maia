import { describe,it,expect,vi } from "vitest";
import { runCodexText } from "../server/ai/providers/codex.ts";
import { ownerRequester } from "../server/access.ts";
import { requiresApproval } from "../server/approvalPolicy.ts";
const spies=vi.hoisted(()=>({ config:vi.fn(),thread:vi.fn() }));
vi.mock("@openai/codex-sdk",()=>({ Codex:class {
  constructor(options:unknown) { spies.config(options); }
  startThread(options:unknown) {
    spies.thread(options);
    return { runStreamed:async()=>({ events:(async function*() {
      yield { type:"item.completed",item:{ type:"mcp_tool_call",tool:"tarefas_listar",status:"failed",error:{ message:"policy" } } };
      yield { type:"item.completed",item:{ type:"agent_message",text:"Consulta bloqueada; resultado não confirmado." } };
    })() }) };
  }
} }));
describe("SDK delega autorização somente à ponte Maia",()=>{
  it("não exige segundo OK interativo, preserva sandbox e evidencia erro de ferramenta",async()=>{
    const onToolUse=vi.fn().mockResolvedValue(undefined);
    const result=await runCodexText({ prompt:"Consulta",timeoutMs:1000,model:null,mcp:{ taskId:0,channel:"painel",requester:ownerRequester(),inGroup:false,onToolUse } });
    expect(result.ok).toBe(true);
    expect(spies.config).toHaveBeenCalledWith(expect.objectContaining({ config:{ mcp_servers:{ maia:expect.objectContaining({ default_tools_approval_mode:"approve",required:true }) } } }));
    expect(spies.thread).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode:"read-only",networkAccessEnabled:false,approvalPolicy:"never" }));
    expect(onToolUse).toHaveBeenCalledWith("mcp__maia__tarefas_listar",true);
    expect(requiresApproval("mcp__maia__instagram_publicar")).toBe(true);
  });
});
