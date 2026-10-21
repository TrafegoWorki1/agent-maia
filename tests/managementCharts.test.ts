// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,it,expect,vi} from "vitest";
import {ManagementChart} from "../src/components/ManagementCharts";
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let root:Root|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;document.body.innerHTML="";});
it("segmentos empilhados e teclado abrem a população do segmento, preservando totais na tabela",async()=>{
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);const select=vi.fn();
 await act(async()=>root!.render(createElement(ManagementChart,{title:"Áreas",caption:"Estado atual",primaryLabel:"Tarefas",kind:"stacked",rows:[{key:"a",label:"Criação",primary:3,ids:[1,2,3],segments:[{label:"Aberto",value:2,ids:[1,2]},{label:"Concluído",value:1,ids:[3]}]}],onSelect:select})));
 const segment=node.querySelector('rect[aria-label="Criação: Concluído 1"]')!;await act(async()=>segment.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));expect(select).toHaveBeenCalledWith([3]);expect(node.querySelector("table")?.textContent).toContain("Aberto");expect(node.querySelectorAll("tbody td")[0].textContent).toBe("2");
});
it("linha preserva zero verdadeiro e não desenha valor ausente como zero",async()=>{
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(createElement(ManagementChart,{title:"Evolução",caption:"Leitura",primaryLabel:"Carga",secondaryLabel:"Capacidade",kind:"line",rows:[{key:"a",label:"Dia 1",primary:0,secondary:5,ids:[]},{key:"b",label:"Dia 2",primary:2,ids:[]},{key:"c",label:"Dia 3",primary:4,secondary:8,ids:[]}]})));
 expect(node.querySelectorAll("circle")).toHaveLength(5);expect(node.querySelector("tbody")?.textContent).toContain("Indisponível");const paths=node.querySelectorAll("path");expect(paths[1].getAttribute("d")?.match(/M/g)).toHaveLength(2);
});
it("rosca não calcula proporções com total vazio ou negativo e mantém valores em tabela",async()=>{
 const node=document.createElement("div");document.body.append(node);root=createRoot(node);await act(async()=>root!.render(createElement(ManagementChart,{title:"Composição",caption:"Leitura",primaryLabel:"Itens",kind:"donut",rows:[{key:"a",label:"A",primary:-2,ids:[]}]})));expect(node.querySelectorAll("circle")).toHaveLength(0);expect(node.querySelector("table")?.textContent).toContain("-2");
});
