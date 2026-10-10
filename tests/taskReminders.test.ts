import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTaskReminders } from "../server/taskReminders.ts";
import { sendTextChecked, DeliveryError } from "../server/evolutionSend.ts";
import { recordMessage, type Db } from "../server/store.ts";

vi.mock("../server/store.ts", () => ({ recordMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../server/evolutionSend.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("../server/evolutionSend.ts")>()), sendTextChecked: vi.fn() }));

// Regressão (10/10/2026): o lembrete era enviado só pela Evolution, sem registrar na conversa; uma resposta
// livre do owner ("feito, falei com ele") chegava sem contexto de qual tarefa/pessoa/assunto.

interface ReminderRow {
  id: number;
  work_task_id: number;
}

function database(reminder: ReminderRow | null, task: { title: string; responsible: string; due_at: string | null; status: string }) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  const db = {
    rpc: async () => ({ data: reminder ? [reminder] : [], error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: table === "work_tasks" ? task : null, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  } as unknown as Db;
  return { db, updates };
}

describe("lembrete grava a própria mensagem na conversa", () => {
  beforeEach(() => vi.mocked(sendTextChecked).mockResolvedValue("id-aceito"));
  afterEach(() => vi.clearAllMocks());

  it("envio aceito chama recordMessage com o texto que foi enviado (tarefa, responsável, prazo)", async () => {
    process.env.EVOLUTION_OWNER_NUMBER = "5585992494552";
    const { db } = database({ id: 1, work_task_id: 4 }, { title: "Falar com o projeto do Gusta sobre a Mari Ferre", responsible: "Herickson", due_at: null, status: "pendente" });
    await runTaskReminders(db);
    expect(recordMessage).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(recordMessage).mock.calls[0];
    expect(payload).toMatchObject({ channel: "whatsapp", author: "maia" });
    expect(payload.text).toContain("tarefa #4");
    expect(payload.text).toContain("Falar com o projeto do Gusta sobre a Mari Ferre");
    expect(payload.text).toContain("Herickson");
  });

  it("falha no envio não grava nada na conversa (nada foi de fato enviado)", async () => {
    process.env.EVOLUTION_OWNER_NUMBER = "5585992494552";
    vi.mocked(sendTextChecked).mockRejectedValueOnce(new DeliveryError("HTTP 400", false));
    const { db } = database({ id: 2, work_task_id: 5 }, { title: "x", responsible: "y", due_at: null, status: "pendente" });
    await runTaskReminders(db);
    expect(recordMessage).not.toHaveBeenCalled();
  });

  it("sem lembrete vencido, não faz nada", async () => {
    process.env.EVOLUTION_OWNER_NUMBER = "5585992494552";
    const { db } = database(null, { title: "x", responsible: "y", due_at: null, status: "pendente" });
    await runTaskReminders(db);
    expect(sendTextChecked).not.toHaveBeenCalled();
    expect(recordMessage).not.toHaveBeenCalled();
  });
});
