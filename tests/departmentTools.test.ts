import {describe,expect,it,vi} from "vitest";
import {workTools} from "../server/workTasks.ts";
import {issueWorkToolPermit,clearWorkToolPermitsForTests} from "../server/workToolPermit.ts";
import type {Db} from "../server/store.ts";

vi.mock("../server/panelIdentity.ts",async original=>({...await original<typeof import("../server/panelIdentity.ts")>(),identityByNumber:vi.fn(async()=>({personId:"11111111-1111-4111-8111-111111111111",owner:true,directPermissions:new Set(),permissionModes:new Map(),groupPermissions:[],teams:[],roles:[]}))}));

describe("ferramentas departamentais usam o contrato autenticado",()=>{
 it("schema MCP preserva payload, permit é único e chave deriva da execução",async()=>{
  clearWorkToolPermitsForTests();
  const tool=workTools.find(tool=>tool.name==="area_registro_salvar")!;
  const id="11111111-1111-4111-8111-111111111111";
  const args={kind:"cs",reason:"  Retorno combinado  ",payload:{client_id:id,responsible_person_id:id,title:"  Retorno  ",next_action:"  Revisar  ",status:"pending"}};
  expect(tool.schema.parse(args)).toEqual(args);
  const rpc=vi.fn().mockResolvedValue({data:{id:"record",revision:1},error:null});const db={rpc} as unknown as Db;
  await expect(async()=>tool.run(db,args,123,"5511000000000")).rejects.toThrow(/sem autorização/);
  const run=async()=>{issueWorkToolPermit({number:"5511000000000",taskId:123,tool:"mcp__maia__area_registro_salvar",args});return tool.run(db,args,123,"5511000000000");};
  await run();const first=rpc.mock.calls[0][1];
  expect(first).toMatchObject({p_actor:id,p_origin:"whatsapp",p_source_task_id:123});
  expect(first.p_payload.request_key).toMatch(/^department:123:cs:[a-f0-9]{64}$/);
  await run();expect(rpc.mock.calls[1][1].p_payload.request_key).toBe(first.p_payload.request_key);
  await expect(async()=>tool.run(db,args,123,"5511000000000")).rejects.toThrow(/já consumida/);
 });
});
