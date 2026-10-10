import { addTaskEvent, type Db } from "./store.ts";

// Registra o resultado já obtido, sem executar nem repetir a ação. HTTP aceito sem
// identificador fica sem prova; só um resultado concreto gera task_verified.
export async function recordActionEvidence(db: Db, taskId: number, operation: string, detail: string | null, proof: string | null): Promise<void> {
  if (!taskId) return;
  try {
    await addTaskEvent(db, taskId, "external_done", operation, detail);
    if (proof) await addTaskEvent(db, taskId, "task_verified", operation, proof);
  } catch (error) {
    console.error("[conferencia] falha ao registrar resultado:", error instanceof Error ? error.message : error);
  }
}
