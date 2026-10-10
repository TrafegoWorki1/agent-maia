import { beforeEach,describe,it,expect,vi } from "vitest";
import { runResponseDeliveries } from "../server/responseDelivery.ts";
import { DeliveryError,sendTextChecked } from "../server/evolutionSend.ts";
import { recordMessage,markTaskReplied,type Db } from "../server/store.ts";
vi.mock("../server/store.ts",()=>({ addTaskEvent:vi.fn().mockResolvedValue(undefined),markTaskReplied:vi.fn().mockResolvedValue(undefined),recordMessage:vi.fn().mockResolvedValue(undefined),setTaskStatus:vi.fn().mockResolvedValue(undefined) }));
vi.mock("../server/conversations.ts",()=>({ recordConvMessage:vi.fn() }));
vi.mock("../server/evolutionSend.ts",async(importOriginal)=>({ ...await importOriginal<typeof import("../server/evolutionSend.ts")>(),sendTextChecked:vi.fn() }));
interface Part { id:number;task_id:number;part:number;recipient:string;text:string;status:string;message_id?:string }
function database(rows: Part[]): Db {
  return {
    rpc:async()=>{
      const item=rows.find((r)=>r.status === "pending" && !rows.some((p)=>p.task_id===r.task_id && (p.status === "sending" || p.status === "failed" || p.status === "uncertain" || (p.part<r.part && p.status!=="sent"))));
      if(item)item.status="sending";
      return {data:item?[{...item}]:[],error:null};
    },
    from:()=>{
      let patch:Partial<Part>|undefined,head=false;
      const filters:((r:Part)=>boolean)[]=[];
      const builder={
        update:(p:Partial<Part>)=>{patch=p;return builder;},
        select:(_cols:string,options?:{head?:boolean})=>{head=options?.head??false;return builder;},
        eq:(key:keyof Part,value:unknown)=>{filters.push(r=>r[key]===value);return builder;},
        neq:(key:keyof Part,value:unknown)=>{filters.push(r=>r[key]!==value);return builder;},
        order:()=>builder,
        then:(resolve:(v:unknown)=>unknown)=>{
          const found=rows.filter(r=>filters.every(f=>f(r)));
          if(patch)for(const r of found)Object.assign(r,patch);
          return Promise.resolve({data:head?null:found.map(r=>({...r})),count:found.length,error:null}).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as Db;
}
function parts():Part[]{return [0,1].map(i=>({id:i+1,task_id:8,part:i,recipient:"5511999999999",text:i?"mundo":"Olá ",status:"pending"}));}
describe("outbox preserva entrega e contexto sem repetir trabalho",()=>{
  beforeEach(()=>vi.mocked(sendTextChecked).mockResolvedValue("id-confirmado"));
  it("só conclui e registra contexto após todas as partes aceitas",async()=>{
    const rows=parts();await runResponseDeliveries(database(rows));
    expect(rows.map(r=>r.status)).toEqual(["sent","sent"]);
    expect(recordMessage).toHaveBeenCalledTimes(1);
    expect(recordMessage).toHaveBeenCalledWith(expect.anything(),{channel:"whatsapp",author:"maia",text:"Olá mundo"});
    expect(markTaskReplied).toHaveBeenCalledTimes(1);
  });
  it("retoma apenas parte pendente e recompõe resposta completa para ambos os modelos",async()=>{
    const rows=parts();rows[0].status="sent";rows[0].message_id="aceita-antes-reinicio";
    await runResponseDeliveries(database(rows));
    expect(sendTextChecked).toHaveBeenCalledTimes(1);
    expect(sendTextChecked).toHaveBeenCalledWith("5511999999999","mundo");
    expect(recordMessage).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({text:"Olá mundo"}));
  });
  it("timeout bloqueia as partes seguintes e uma nova rodada não repete",async()=>{
    const rows=parts(),db=database(rows);
    vi.mocked(sendTextChecked).mockRejectedValueOnce(new DeliveryError("tempo limite",true));
    await runResponseDeliveries(db);await runResponseDeliveries(db);
    expect(rows.map(r=>r.status)).toEqual(["uncertain","pending"]);
    expect(sendTextChecked).toHaveBeenCalledTimes(1);
    expect(recordMessage).not.toHaveBeenCalled();expect(markTaskReplied).not.toHaveBeenCalled();
  });
  it("rejeição definitiva não conclui nem refaz o pedido",async()=>{
    const rows=parts();vi.mocked(sendTextChecked).mockRejectedValueOnce(new DeliveryError("HTTP 400",false));
    await expect(runResponseDeliveries(database(rows),8)).rejects.toMatchObject({uncertain:false});
    expect(rows[0].status).toBe("failed");expect(recordMessage).not.toHaveBeenCalled();
  });
});
