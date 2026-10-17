// @vitest-environment jsdom
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,expect,it,vi } from "vitest";
import { TarefasPage } from "../src/features/operacao/TarefasPage";
import { workspaceRequest, retryCreativeSend } from "../src/lib/workspaceApi";

vi.mock("../src/lib/workspaceApi", () => ({ workspaceRequest:vi.fn(), retryCreativeSend:vi.fn() }));
Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); document.body.innerHTML=""; root=undefined; });
describe("painel de tarefas e revisão humana", () => {
  it("encaminha trabalho à Central e preserva falha/incerteza e eficácia técnica", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue({ work:{ limit:200,tasks:[{ id:1,title:"Entregar planejamento",responsible:"Herickson",status:"pendente",due_at:"2026-10-09T12:00:00Z",revision:1,completion_evidence:null,overdue:true,tipo:null }],reminders:[{ id:1,work_task_id:1,run_at:"2026-10-09T12:00:00Z",status:"uncertain",kind:"prazo",message_id:null,error:"tempo limite" }] },effectiveness:{ sample:0,targetSample:20,sufficient:false,relevance:null,resolution:null,partial:0,candidates:[],reviews:[],deliveries:[],sampleScope:"Últimos 7 dias" },memories:[],receipts:[{messageId:"wamid-test",destination:"Contato: Bárbara",status:"read",updatedAt:"2026-10-14T18:00:00Z"}],creativeJobs:[{id:7,title:"Stories Worki",status:"running",created_at:"2026-10-15T12:00:00Z",updated_at:"2026-10-15T12:03:00Z",source_task_id:6,items:[{id:1,seq:1,format:"story",status:"ready_for_review",artifact_name:"story.png",error:null},{id:2,seq:2,format:"story",status:"queued",artifact_name:null,error:null}]}] });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.querySelector('a[href="#trabalho/minha-equipe"]')).not.toBeNull();
    expect(host.textContent).not.toContain("Entregar planejamento");
    expect(host.textContent).toContain("Incerto · não repetido");
    expect(host.textContent).toContain("Relevância: Sem avaliação");
    expect(host.textContent).toContain("0/20 pedidos avaliados");
    expect(host.textContent).toContain("Lida");
    expect(host.textContent).toContain("Contato: Bárbara");
    expect(host.textContent).toContain("wamid-test");
    expect(host.textContent).toContain("Trabalhos criativos retomáveis");
    expect(host.textContent).toContain("#1 (story): Enviado para revisão");
    expect(host.textContent).toContain("#2 (story): Na fila");
    expect([...host.querySelectorAll("button")].some(button=>button.textContent==="Editar")).toBe(false);
    expect(host.textContent).not.toContain("Editar tarefa #1");
  });
  it("erro de permissão aparece como alerta, não dados fictícios", async () => {
    vi.mocked(workspaceRequest).mockRejectedValue(new Error("owner_only"));
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("owner_only");
  });
});

const failedItemData = { work:{ limit:200,tasks:[],reminders:[] },effectiveness:{ sample:0,targetSample:20,sufficient:false,relevance:null,resolution:null,partial:0,candidates:[],reviews:[],deliveries:[],sampleScope:"" },memories:[],receipts:[],creativeJobs:[{id:1,title:"Campanha",status:"partial" as const,created_at:"2026-10-17T10:00:00Z",updated_at:"2026-10-17T10:01:00Z",source_task_id:5,items:[{id:10,seq:1,format:"feed" as const,status:"failed" as const,artifact_name:"arte.png",error:"HTTP 500"}]}] };
const uncertainItemData = { ...failedItemData, creativeJobs:[{id:1,title:"Campanha",status:"uncertain" as const,created_at:"2026-10-17T10:00:00Z",updated_at:"2026-10-17T10:01:00Z",source_task_id:5,items:[{id:10,seq:1,format:"feed" as const,status:"uncertain" as const,artifact_name:"arte.png",error:"Timeout ao enviar"}]}] };

describe("retry de artes criativas", () => {
  it("exibe botão 'Tentar novamente' para item com status failed", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente");
    expect(retryBtn).not.toBeUndefined();
  });

  it("clicar em Tentar novamente para failed aciona retryCreativeSend e mostra estado enviado", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: true, messageId: "msg-ok-123" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    expect(retryCreativeSend).toHaveBeenCalledWith(10, false, expect.any(String));
    expect(host.textContent).toContain("Enviado");
    expect(host.textContent).toContain("msg-ok-123");
  });

  it("item uncertain exige confirmação antes de chamar retryCreativeSend", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(uncertainItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: true, messageId: "msg-confirmed" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    // Primeiro clique: mostra confirmação, NÃO chama retryCreativeSend
    await act(async () => { retryBtn.click(); });
    expect(retryCreativeSend).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Estado incerto");
    // Clicar Confirmar chama com confirmUncertain=true
    const confirmBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Confirmar")!;
    await act(async () => { confirmBtn.click(); });
    expect(retryCreativeSend).toHaveBeenCalledWith(10, true, expect.any(String));
  });

  it("erro de permissão do backend exibe estado de falha inline", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockRejectedValue(new Error("owner_only"));
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    expect(host.textContent).toContain("Falhou");
    expect(host.textContent).toContain("owner_only");
  });

  it("botão fica desabilitado durante o processamento (prevenção de duplo clique)", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    let resolveRetry!: (v: { ok: true; messageId: string }) => void;
    const pending = new Promise<{ ok: true; messageId: string }>((res) => { resolveRetry = res; });
    vi.mocked(retryCreativeSend).mockReturnValue(pending);
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    // While processing, should show "Processando…" and no active retry button for this item
    expect(host.textContent).toContain("Processando");
    expect(retryCreativeSend).toHaveBeenCalledTimes(1);
    // Resolve the pending promise
    await act(async () => { resolveRetry({ ok: true, messageId: "msg-final" }); });
    expect(host.textContent).toContain("Enviado");
  });

  it("resposta uncertain do backend exibe estado incerto inline", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: false, state: "uncertain", message: "Timeout ao enviar para Evolution" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn = [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    expect(host.textContent).toContain("Incerto");
    expect(host.textContent).toContain("Timeout ao enviar");
  });

  it("status local muda para sent imediatamente após sucesso", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: true, messageId: "msg-sent-local" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    expect(host.textContent).toContain("Enviado · aguardando confirmação");
    expect(host.textContent).not.toContain("Falhou");
  });

  it("botão Tentar novamente é removido após sucesso", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: true, messageId: "msg-rm" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    const retryBtnAfter=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente");
    expect(retryBtnAfter).toBeUndefined();
  });

  it("retorno uncertain do backend mantém botão Tentar novamente ativo", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend).mockResolvedValue({ ok: false, state: "uncertain", message: "Timeout" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const retryBtn=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente")!;
    await act(async () => { retryBtn.click(); });
    const retryBtnAfter=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente");
    expect(retryBtnAfter).not.toBeUndefined();
    expect(host.textContent).toContain("Incerto");
  });

  it("polling não sobrescreve estado sent após sucesso", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
      vi.mocked(retryCreativeSend).mockResolvedValue({ ok: true, messageId: "msg-poll" });
      const host=document.createElement("div");document.body.append(host);root=createRoot(host);
      await act(async () => root!.render(createElement(TarefasPage)));
      const retryBtn=[...host.querySelectorAll("button")].find(b=>b.textContent==="Tentar novamente")!;
      await act(async () => { retryBtn.click(); });
      expect(host.textContent).toContain("Enviado · aguardando confirmação");
      // Simulate polling tick — workspaceRequest returns stale data with item still "failed"
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(host.textContent).toContain("Enviado · aguardando confirmação");
      expect(host.textContent).not.toContain("Falhou");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cada clique em Tentar novamente usa retry_key único (UUID diferente por chamada)", async () => {
    vi.mocked(workspaceRequest).mockResolvedValue(failedItemData);
    vi.mocked(retryCreativeSend)
      .mockResolvedValueOnce({ ok: false, state: "failed", message: "HTTP 500" })
      .mockResolvedValueOnce({ ok: true, messageId: "msg-second" });
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async () => root!.render(createElement(TarefasPage)));
    const getRetryBtn = () => [...host.querySelectorAll("button")].find(b => b.textContent === "Tentar novamente")!;
    await act(async () => { getRetryBtn().click(); });
    await act(async () => { getRetryBtn().click(); });
    expect(retryCreativeSend).toHaveBeenCalledTimes(2);
    const [call1, call2] = vi.mocked(retryCreativeSend).mock.calls;
    expect(call1[2]).not.toBe(call2[2]);
    expect(call1[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(call2[2]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
