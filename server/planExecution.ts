import type { Db } from "./store.ts";
import type { Plan } from "./plans.ts";

export type ExecutionState = "pending" | "leased" | "running" | "waiting" | "done" | "cancelled" | "uncertain" | "blocked";
export interface PlanStepRuntime { id: number; plan_id: number; step_no: number; text: string; depends_on: number[]; status: ExecutionState; result: string | null; evidence: Record<string, unknown>; blocked_reason: string | null; external_state: "none" | "safe" | "uncertain" | "confirmed"; lease_owner: string | null; lease_until: string | null; attempts: number }

export function validateStepDependencies(steps: Array<{ step_no: number; depends_on: number[] }>): string[] {
  const known = new Set(steps.map((step) => step.step_no));
  const errors: string[] = [];
  for (const step of steps) {
    for (const dep of step.depends_on) if (!known.has(dep) || dep >= step.step_no) errors.push(`etapa ${step.step_no} depende de etapa inválida ${dep}`);
  }
  return errors;
}

export async function seedPlanSteps(db: Db, plan: Plan): Promise<void> {
  const rows = plan.steps.map((step, index) => ({ plan_id: plan.id, step_no: index + 1, text: step.text, depends_on: index ? [index] : [] }));
  if (!rows.length) return;
  const { error } = await db.from("maia_plan_steps").upsert(rows, { onConflict: "plan_id,step_no", ignoreDuplicates: true });
  if (error) throw new Error(`Etapas do plano indisponíveis: ${error.message}`);
}

export async function claimPlanStep(db: Db, planId: number, stepNo: number, leaseOwner: string, leaseSeconds = 300): Promise<PlanStepRuntime | null> {
  const { data, error } = await db.rpc("claim_maia_plan_step", { p_plan_id: planId, p_step_no: stepNo, p_lease_owner: leaseOwner, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(`Não consegui reservar etapa do plano: ${error.message}`);
  return (data as PlanStepRuntime | null) ?? null;
}

export async function finishPlanStep(db: Db, input: { id: number; leaseOwner: string; status: Extract<ExecutionState, "done" | "waiting" | "blocked" | "uncertain" | "cancelled">; result?: string; evidence?: Record<string, unknown>; blockedReason?: string; externalState?: PlanStepRuntime["external_state"] }): Promise<boolean> {
  const { data, error } = await db.from("maia_plan_steps").update({ status: input.status, result: input.result?.slice(0, 12000) ?? null, evidence: input.evidence ?? {}, blocked_reason: input.blockedReason?.slice(0, 1000) ?? null, external_state: input.externalState ?? "none", lease_owner: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", input.id).eq("lease_owner", input.leaseOwner).in("status", ["leased", "running"]).select("id");
  if (error) throw new Error(`Não consegui concluir etapa do plano: ${error.message}`);
  return (data ?? []).length === 1;
}
