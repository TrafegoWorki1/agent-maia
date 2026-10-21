import {describe,it,expect} from "vitest";
import {parsePanelRows,validatePanelSource} from "../server/panelSources";
import {summarizePanelSource,type PanelSourceView} from "../src/lib/panelSourceModel";
import {mergePanelGroups} from "../server/panelGroups";
const mapping={key:"id",date:"data",value:"valor"};
const config=()=>({name:"Recebimentos",metric_code:"finance.received",source_ref:"sheet_12345678",range_ref:"Dados!A1:F5001",mapping,unit:"BRL",basis:"Caixa",coverage:"Pagamentos da agência",active:true});
describe("Fontes de leitura",()=>{
 it("valida intervalo limitado e não aceita URL como destino de requisição",()=>{expect(validatePanelSource({...config(),source_ref:"https://docs.google.com/spreadsheets/d/sheet_12345678/edit"}).source_ref).toBe("sheet_12345678");expect(()=>validatePanelSource({...config(),source_ref:"https://outro.test"})).toThrow();for(const range of ["A:F","Dados!A1:F999999","Dados!F20:A1","Dados!A1:ZZ5001"])expect(()=>validatePanelSource({...config(),range_ref:range})).toThrow();});
 it("aceita números nativos e datas brasileiras sem somar valores ambíguos",()=>{expect(parsePanelRows([["id","data","valor"],["x","20/10/2026",123.45],["","",""],["y","2026-10-21",0]],mapping)).toEqual([{key:"x",date:"2026-10-20",value:123.45},{key:"y",date:"2026-10-21",value:0}]);expect(()=>parsePanelRows([["id","data","valor"],["x","2026-10-20","1.200,00"]],mapping)).toThrow(/numérico/);});
 it("rejeita duplicidade, cabeçalho repetido, IDs e datas inválidas",()=>{
 for(const rows of [[["id","data","valor"],["a","2026-10-20",1],["a","2026-10-21",2]],[["id","data","valor","valor"]],[["id","data","valor"],["","2026-10-20",1]],[["id","data","valor"],["a","2026-02-30",1]]])expect(()=>parsePanelRows(rows,mapping)).toThrow();
 });
 it("saldo vencido usa a última fotografia e não acumula o saldo de vários dias",()=>{
 const s={metric_code:"finance.overdue",success:{observations:[{key:"a",date:"2026-10-19",value:100},{key:"b",date:"2026-10-20",value:80}]}} as PanelSourceView;
 expect(summarizePanelSource(s,"2026-10-19","2026-10-25")).toMatchObject({value:80,asOf:"2026-10-20"});
 expect(summarizePanelSource(s,"2026-10-21","2026-10-25").value).toBeNull();
 });
 it("distingue fonte sem coleta de lote vazio confirmado",()=>{const s={metric_code:"finance.received",success:null} as PanelSourceView;expect(summarizePanelSource(s,"2026-10-19","2026-10-25").value).toBeNull();expect(summarizePanelSource({...s,success:{observations:[]} as any},"2026-10-19","2026-10-25").value).toBe(0);});
 it("preserva cadastro e atividade se a Evolution não retornar a lista",()=>{
 const rows=mergePanelGroups([],[{jid:"a@g.us",name:"Cliente A"}],[{jid:"b@g.us",messages:217,last_at:"2026-10-20T12:00:00Z"},{jid:"privado@s.whatsapp.net",messages:1,last_at:"2026-10-20T12:00:00Z"}]);
 expect(rows).toHaveLength(2);expect(rows.find(r=>r.jid==="a@g.us")).toMatchObject({recordedMessages:null,messages7d:null});expect(rows.find(r=>r.jid==="b@g.us")).toMatchObject({recordedMessages:217,messages7d:null});
 });
});
