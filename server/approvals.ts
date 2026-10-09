import type { Db } from "./store.ts";

// Aprovações persistidas no banco. Cada pedido tem número (SIM 12 / NÃO 12), prazo e o processo que o espera.
// Um SIM ou NÃO sem número só vale quando há exatamente um pedido aberto.
// Se o processo que esperava a aprovação já não existe (a Maia reiniciou), o pedido não é executado.

export const APPROVAL_TTL_MS = 10 * 60 * 1000;
const POLL_MS = 1_500;

// Quem recebe os pedidos de aprovação e pode responder: o dono e o aprovador (sem repetição).
export function approvalRecipients(): string[] {
  return [...new Set([process.env.EVOLUTION_OWNER_NUMBER, process.env.EVOLUTION_APPROVER_NUMBER].filter((n): n is string => Boolean(n)))];
}

export type ApprovalKind = "ferramenta" | "grupo";

export interface ApprovalRow {
  id: number;
  kind: ApprovalKind;
  tool_name: string;
  summary: string | null;
  payload: unknown;
  task_id: number | null;
  status: string;
  expires_at: string;
  process_id: number | null;
}

// "sim", "não", "nao", com número opcional. Qualquer outra coisa não é uma resposta de aprovação.
export function parseDecision(text: string): { approved: boolean; id: number | null } | null {
  const match = /^\s*(sim|não|nao)\s*(\d{1,9})?\s*$/i.exec(text);
  if (!match) return null;
  return { approved: match[1].toLowerCase() === "sim", id: match[2] ? Number(match[2]) : null };
}

// Processo vivo na mesma máquina? Usado para não executar ação de quem já não está esperando.
export function processAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function createApproval(
  db: Db,
  input: { kind: ApprovalKind; toolName: string; summary: string; payload?: unknown; taskId?: number | null; now?: Date },
): Promise<{ id: number; expiresAt: string }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS).toISOString();
  const { data, error } = await db
    .from("approvals")
    .insert({
      requested_at: now.toISOString(),
      tool_name: input.toolName,
      status: "pending",
      kind: input.kind,
      summary: input.summary.slice(0, 500),
      payload: input.payload ?? null,
      task_id: input.taskId ?? null,
      expires_at: expiresAt,
      process_id: process.pid,
    })
    .select("id, expires_at")
    .single();
  if (error || !data) throw new Error(`aprovação: ${error?.message ?? "sem resposta"}`);
  return { id: (data as { id: number }).id, expiresAt: (data as { expires_at: string }).expires_at };
}

export async function openApprovals(db: Db, now = new Date()): Promise<ApprovalRow[]> {
  const { data, error } = await db
    .from("approvals")
    .select("id, kind, tool_name, summary, payload, task_id, status, expires_at, process_id")
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("id", { ascending: true });
  if (error) throw new Error(`aprovações abertas: ${error.message}`);
  return (data ?? []) as ApprovalRow[];
}

// Espera a decisão lendo o banco (funciona mesmo se a resposta chegar por outro processo).
export async function waitApproval(db: Db, id: number, expiresAtIso: string): Promise<"approved" | "denied" | "expired"> {
  for (;;) {
    const { data, error } = await db.from("approvals").select("status").eq("id", id).single();
    if (error) throw new Error(`ler aprovação: ${error.message}`);
    const status = (data as { status: string }).status;
    if (status === "approved") return "approved";
    if (status === "denied") return "denied";
    if (status !== "pending") return "expired";
    if (Date.now() >= Date.parse(expiresAtIso)) {
      await db.from("approvals").update({ status: "expired", resolved_at: new Date().toISOString() }).eq("id", id).eq("status", "pending");
      return "expired";
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export interface Decision {
  handled: boolean;
  reply?: string;
  approved?: boolean;
  row?: ApprovalRow;
}

// Aplica um SIM ou NÃO vindo do aprovador. Não decide nada se a mensagem não for uma resposta de aprovação.
export async function decideFromText(db: Db, text: string, now = new Date()): Promise<Decision> {
  const parsed = parseDecision(text);
  if (!parsed) return { handled: false };

  const open = await openApprovals(db, now);
  let row: ApprovalRow | undefined;
  if (parsed.id !== null) {
    row = open.find((r) => r.id === parsed.id);
    if (!row) return { handled: true, reply: `O pedido #${parsed.id} já foi respondido, expirou ou não existe.` };
  } else {
    if (open.length === 0) return { handled: false };
    if (open.length > 1) {
      const lista = open.map((r) => `#${r.id}`).join(", ");
      return { handled: true, reply: `Há mais de um pedido aberto (${lista}). Responda com o número: SIM <número> ou NÃO <número>.` };
    }
    row = open[0];
  }

  // Ação de ferramenta só é executada por um processo vivo que está esperando a resposta.
  if (row.kind === "ferramenta" && !processAlive(row.process_id)) {
    await db.from("approvals").update({ status: "expired", resolved_at: now.toISOString() }).eq("id", row.id).eq("status", "pending");
    return { handled: true, reply: `O pedido #${row.id} perdeu o processo que o executava (a Maia reiniciou). Não foi feito nada. Peça de novo.` };
  }

  const status = parsed.approved ? "approved" : "denied";
  const updated = await db
    .from("approvals")
    .update({ status, resolved_at: now.toISOString(), decided_by: "aprovador" })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");
  if (updated.error) throw new Error(`decidir aprovação: ${updated.error.message}`);
  if (!updated.data || updated.data.length === 0) return { handled: true, reply: `O pedido #${row.id} já foi respondido.` };
  return { handled: true, approved: parsed.approved, row };
}
