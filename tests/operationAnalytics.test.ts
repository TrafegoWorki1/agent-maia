import {it,expect} from "vitest";
import {summarizeOperations,type OperationReading} from "../src/lib/operationAnalytics";
it("mantém custo desconhecido fora da média, separa recibos e usa o dia do encerramento da falha",()=>{
 const d={runs:[{id:1,started_at:"2026-10-20T01:00:00Z",cost_usd:.3},{id:2,started_at:"2026-10-20T12:00:00Z",cost_usd:null},{id:3,started_at:"2026-10-20T13:00:00Z",cost_usd:0}],failures:[{id:8,finished_at:"2026-10-20T01:00:00Z"}],receipts:[{message_id:"a",status:"accepted"},{message_id:"b",status:"read"}],approvals:[{id:1,status:"pending"},{id:2,status:"approved"}]} as OperationReading;
 const a=summarizeOperations(d);expect(a).toMatchObject({cost:.3,costPerRun:.15,known:2,missing:1,pending:1});expect(a.failures.find(r=>r.key==="2026-10-19")?.primary).toBe(1);expect(a.receipts.find(r=>r.key==="accepted")?.primary).toBe(1);expect(a.receipts.find(r=>r.key==="delivered")?.primary).toBe(0);expect(a.receipts.find(r=>r.key==="read")?.primary).toBe(1);
});
