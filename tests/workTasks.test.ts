import { describe,it,expect } from "vitest";
import { createWorkSchema, updateWorkSchema, reminderSchema, editReminderSchema, isOverdue, requestKey, workTools } from "../server/workTasks.ts";
import { evaluationSchema, evaluationSummary } from "../server/effectiveness.ts";
import { decideAccess,ownerRequester } from "../server/access.ts";

describe("tarefas reais e avaliação humana", () => {
  it("só admite os três estados e exige evidência para concluir", () => {
    expect(updateWorkSchema.safeParse({ id:1,revisao:1,status:"atrasada" }).success).toBe(false);
    expect(updateWorkSchema.safeParse({ id:1,revisao:1,status:"concluida" }).success).toBe(false);
    expect(updateWorkSchema.safeParse({ id:1,revisao:1,status:"concluida",evidencia:"Arquivo entregue" }).success).toBe(true);
  });
  it("prazo tem fuso explícito e responsável não é inventado", () => {
    expect(createWorkSchema.safeParse({ titulo:"Planejamento",responsavel:"Herickson",prazo:"2026-10-11T09:00:00-03:00" }).success).toBe(true);
    expect(createWorkSchema.safeParse({ titulo:"Planejamento",prazo:"2026-10-11T09:00" }).success).toBe(false);
    expect(reminderSchema.safeParse({ tarefa_id:1,horario:"2026-10-11T09:00" }).success).toBe(false);
    expect(editReminderSchema.safeParse({ id:1 }).success).toBe(false);
  });
  it("atraso não vira estado manual nem afeta concluídas", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(isOverdue({ status:"pendente",due_at:"2026-10-10T11:00:00Z" },now)).toBe(true);
    expect(isOverdue({ status:"concluida",due_at:"2026-10-10T11:00:00Z" },now)).toBe(false);
    expect(isOverdue({ status:"pendente",due_at:null },now)).toBe(false);
  });
  it("repetir a mesma chamada na execução mantém a chave", () => {
    expect(requestKey("exec:1",{ titulo:"A" })).toBe(requestKey("exec:1",{ titulo:"A" }));
    expect(requestKey("exec:1",{ titulo:"A" })).not.toBe(requestKey("exec:2",{ titulo:"A" }));
  });
  it("dados e escrita de trabalho não são liberados automaticamente a membros", () => {
    for (const t of workTools) {
      expect(decideAccess(`mcp__maia__${t.name}`,ownerRequester(),{},t.name === "tarefas_listar").decision).toBe("allow");
      expect(decideAccess(`mcp__maia__${t.name}`,{ role:"guest",name:"X",number:"",permissions:new Set() },{},t.name === "tarefas_listar").decision).toBe("approve");
    }
  });
  it("sem avaliação é sem nota, parcial não é resolvido", () => {
    expect(evaluationSummary([])).toMatchObject({ sample:0,relevance:null,resolution:null,sufficient:false });
    expect(evaluationSummary([{ task_id:1,relevant:true,resolution:"parcial",reviewed_at:"",expected:"A",evidence:"B" }])).toMatchObject({ relevance:100,resolution:0,partial:1,sufficient:false });
    expect(evaluationSchema.safeParse({ task_id:1,relevant:true,resolution:"resolvido",expected:"A",evidence:"" }).success).toBe(false);
  });
});
