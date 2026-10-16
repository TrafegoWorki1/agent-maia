import { afterEach,describe,expect,it } from "vitest";
import { clearWorkToolPermitsForTests,consumeWorkToolPermit,issueWorkToolPermit } from "../server/workToolPermit.ts";
import { workTools } from "../server/workTasks.ts";
import type { Db } from "../server/store.ts";

afterEach(()=>clearWorkToolPermitsForTests());

describe("autorização de ferramenta colaborativa",()=>{
  const binding={number:"5511990000000",taskId:71,tool:"mcp__maia__tarefa_atualizar",args:{id:12,revisao:4,estado:"completed"}};
  it("vincula permit ao solicitante, tarefa, ferramenta e argumentos e consome uma única vez",()=>{
    issueWorkToolPermit({...binding,oneTimeApproval:true,now:100});
    expect(consumeWorkToolPermit({...binding,number:"5511888888888",now:101})).toBeNull();
    expect(consumeWorkToolPermit({...binding,taskId:72,now:101})).toBeNull();
    expect(consumeWorkToolPermit({...binding,args:{...binding.args,estado:"cancelled"},now:101})).toBeNull();
    expect(consumeWorkToolPermit({...binding,now:101})).toEqual({oneTimeApproval:true});
    expect(consumeWorkToolPermit({...binding,now:102})).toBeNull();
  });
  it("expira a autorização antes da execução e não expõe fallback sem identidade",async()=>{
    issueWorkToolPermit({...binding,now:100});
    expect(consumeWorkToolPermit({...binding,now:30_101})).toBeNull();
    await expect(workTools[0].run({} as Db,{},71,"5511990000000")).rejects.toThrow("sem autorização vigente");
    await expect(workTools[0].run({} as Db,{},71,undefined)).rejects.toThrow("Identidade autenticada");
  });
});
