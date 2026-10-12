// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GruposPage } from "../src/features/operacao/GruposPage";
import { AccessGroupsPage } from "../src/features/organization/AccessGroupsPage";
import { ClientsPage } from "../src/features/organization/ClientsPage";
import type { OrganizationData } from "../shared/organization";
const fixture = vi.hoisted(() => ({ data:null as OrganizationData | null,error:null as string | null,save:vi.fn(),reload:vi.fn() }));
vi.mock("../src/lib/organizationApi", () => ({ useOrganization:()=>({ ...fixture,busy:false,notice:null }) }));
vi.mock("../src/lib/useSnapshot", () => ({ useSnapshot:()=>({ error:null,snapshot:{ groups:{ error:null,groups:[{ jid:"50@g.us",subject:"Grupo Cliente A",size:3,messages7d:7,lastActivity:null },{ jid:"60@g.us",subject:"Grupo Novo",size:2,messages7d:0,lastActivity:null }] } } }) }));
Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT:true });
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  fixture.data = { clients:[{ id:"a",name:"Cliente A",active:true,revision:1 }],accessGroups:[{ id:"team",name:"Equipe A",client_id:"a",active:true,revision:2,members:["p"],permissions:["conversa.maia"] }],
    groups:[{ jid:"50@g.us",name:"Grupo Cliente A",source:"cadastrado",active:true,kind:"cliente",client_id:"a",access_group_id:"team",revision:3 }],
    people:[{ id:"p",name:"Pessoa A",active:true,role:"equipe" }],permissions:[{ code:"conversa.maia",label:"Conversar com a Maia",description:"Conversas" },{ code:"escrita.aprovar",label:"Aprovar ações",description:"Aprovação individual" }] };
  fixture.error = null; fixture.save.mockResolvedValue(true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{ await act(async()=>root.unmount());document.body.innerHTML=""; });
const render = async(Component:()=>React.ReactNode)=>act(async()=>root.render(createElement(Component)));
const click = async(el:HTMLElement)=>act(async()=>el.click());
const select = async(el:HTMLSelectElement,value:string)=>act(async()=>{ el.value=value;el.dispatchEvent(new Event("change",{ bubbles:true })); });
const button = (text:string)=>[...host.querySelectorAll("button")].find((b)=>b.textContent?.trim()===text)!;
describe("cadastros reais no painel",()=>{
  it("lista cliente e acesso do grupo e filtra grupos ainda não cadastrados",async()=>{
    await render(GruposPage);
    expect(host.textContent).toContain("Acesso: Equipe A");
    const filters=host.querySelectorAll("select");
    await select(filters[0],"pendentes");
    expect(host.querySelector("tbody")?.textContent).toContain("Grupo Novo");
    expect(host.querySelector("tbody")?.textContent).not.toContain("Grupo Cliente A");
    await click(button("Organizar"));
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenCalledWith("group_save",expect.objectContaining({ jid:"60@g.us",kind:"interno",active:false }));
  });
  it("edita a classificação com cliente, acesso e revisão",async()=>{
    await render(GruposPage);
    await click([...host.querySelectorAll("button")].filter((b)=>b.textContent==="Organizar")[0]);
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenCalledWith("group_save",expect.objectContaining({ jid:"50@g.us",client_id:"a",access_group_id:"team",revision:3,active:true }));
  });
  it("grupos de acesso mostram pessoas e direitos compartilhados sem conceder aprovação em lote",async()=>{
    await render(AccessGroupsPage);
    await click(host.querySelector<HTMLButtonElement>(".organization-directory button")!);
    expect(host.textContent).toContain("Pessoa A");
    expect(host.querySelector("form")!.textContent).not.toContain("Aprovar ações");
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenCalledWith("access_group_save",expect.objectContaining({ id:"team",revision:2,members:["p"],permissions:["conversa.maia"] }));
  });
  it("cliente pode ser pausado sem excluir seus grupos",async()=>{
    await render(ClientsPage);
    await click(host.querySelector<HTMLButtonElement>(".organization-directory button")!);
    await click(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenCalledWith("client_save",{ id:"a",revision:1,name:"Cliente A",active:false });
  });
  it("banco ainda não atualizado mostra erro e bloqueia criação",async()=>{
    fixture.data=null;fixture.error="Cadastro aguarda atualização do banco.";
    await render(AccessGroupsPage);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("atualização");
    expect(button("Novo grupo de acesso").disabled).toBe(true);
  });
  it.each([
    { Component:ClientsPage, action:"client_save", revision:1 },
    { Component:AccessGroupsPage, action:"access_group_save", revision:2 },
    { Component:GruposPage, action:"group_save", revision:3 },
  ])("recarrega o formulário de $action após conflito de edição",async({ Component,action,revision })=>{
    fixture.save.mockResolvedValue(false);
    await render(Component);
    await click(Component === GruposPage ? button("Organizar") : host.querySelector<HTMLButtonElement>(".organization-directory button")!);
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenLastCalledWith(action,expect.objectContaining({ revision }));
    fixture.data = { ...fixture.data!,
      clients:fixture.data!.clients.map((c)=>({ ...c,revision:10,name:"Cliente atualizado" })),
      accessGroups:fixture.data!.accessGroups.map((g)=>({ ...g,revision:10,name:"Equipe atualizada" })),
      groups:fixture.data!.groups.map((g)=>({ ...g,revision:10,active:false })),
    };
    await render(Component);
    if (Component === GruposPage) expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    else expect(host.querySelector<HTMLInputElement>('form input')!.value).toBe(Component === ClientsPage ? "Cliente atualizado" : "Equipe atualizada");
    await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles:true,cancelable:true })));
    expect(fixture.save).toHaveBeenLastCalledWith(action,expect.objectContaining({ revision:10 }));
  });
});
