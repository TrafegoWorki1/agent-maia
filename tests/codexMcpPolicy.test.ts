import { describe,it,expect,vi } from "vitest";
import { buildCodexPrompt, runCodexText, clientCodexEnvironment } from "../server/ai/providers/codex.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  it("instrui o Codex a enfileirar geração de imagem e a não bloquear pela geração longa",()=>{
    const prompt=buildCodexPrompt({ rules:"Regras",context:"",request:"Crie cinco Stories" });
    expect(prompt).toContain("trabalho_arte_enfileirar");
    expect(prompt).toContain("não chame gerar_imagem para cada item");
    expect(prompt).toContain("nunca publica automaticamente");
  });
  it("o ambiente do cliente copia somente login e elimina a herança de conectores e memória",()=>{
    const folder = mkdtempSync(join(tmpdir(),"maia-codex-test-"));
    const source=join(folder,"source"),run=join(folder,"run");mkdirSync(source);mkdirSync(run);
    writeFileSync(join(source,"auth.json"),'{"fixture":true}');
    writeFileSync(join(source,"config.toml"),'[mcp_servers.private]\ncommand="fixture"');
    try {
      const env=clientCodexEnvironment(run,{ CODEX_HOME:source,PATH:"fixture" });
      expect(readFileSync(join(env.CODEX_HOME,"auth.json"),"utf8")).toBe('{"fixture":true}');
      expect(existsSync(join(env.CODEX_HOME,"config.toml"))).toBe(false);
      expect(env.CODEX_HOME).not.toBe(source);
    } finally {
      if (resolve(folder).startsWith(resolve(tmpdir()) + "\\") || resolve(folder).startsWith(resolve(tmpdir()) + "/")) rmSync(folder,{ recursive:true,force:true });
    }
  });
  it("grupo de cliente desliga ferramentas locais, conectores, memória e delegação",async()=>{
    const who = { ...ownerRequester(), groupScope: { jid:"50@g.us",name:"Cliente",clientId:"client",clientName:"Cliente",accessGroupId:null } };
    await runCodexText({ prompt:"Grupo",timeoutMs:1000,model:null,mcp:{ taskId:0,channel:"whatsapp",requester:who,inGroup:true } });
    expect(spies.config).toHaveBeenLastCalledWith(expect.objectContaining({ config:expect.objectContaining({
      features:expect.objectContaining({ shell_tool:false,apps:false,memories:false,multi_agent:false,remote_plugin:false,hooks:false }),tools:{ view_image:false },
      mcp_servers:{ maia:expect.objectContaining({ env:expect.objectContaining({ MAIA_CODEX_REQUESTER:expect.stringContaining('"clientId":"client"') }) }) },
    }) }));
  });
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
