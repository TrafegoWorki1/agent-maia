import { z } from "zod";
import type { Db } from "./store.ts";

export const scheduleInputSchema = z.object({
  ownerKey: z.string().trim().min(1).max(240), clientId: z.string().uuid().nullable().default(null), instruction: z.string().trim().min(1).max(8000), skills: z.array(z.string()).max(20).default([]), kind: z.enum(["once", "interval", "cron"]), value: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"), destination: z.string().trim().min(1).max(240), limits: z.record(z.string(), z.unknown()).default({}), missedPolicy: z.enum(["skip", "run_once", "catch_up"]).default("skip"), nextRunAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export function nextScheduleAt(kind: ScheduleInput["kind"], value: string, after: Date): Date | null {
  if (kind === "once") { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date > after ? date : null; }
  if (kind === "interval") { const match = value.match(/^(\d+)\s*(s|m|h|d)$/i); if (!match) return null; const ms = Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 } as Record<string, number>)[match[2].toLowerCase()]; return new Date(after.getTime() + ms); }
  return nextCronAt(value, after);
}

function cronField(value: string, min: number, max: number, candidate: number): boolean {
  if (value === "*") return true;
  return value.split(",").some((part) => {
    const stepped = part.match(/^(\*|\d+)-(\d+)\/(\d+)$|^(\*)\/(\d+)$/);
    if (stepped) {
      const start = stepped[1] === "*" || stepped[1] === undefined ? min : Number(stepped[1]);
      const end = stepped[2] === undefined ? max : Number(stepped[2]);
      const step = Number(stepped[3] ?? stepped[5]);
      return step > 0 && candidate >= start && candidate <= end && (candidate - start) % step === 0;
    }
    const range = part.split("-").map(Number); if (range.length === 2) return candidate >= range[0] && candidate <= range[1]; const n = Number(part); return Number.isInteger(n) && n >= min && n <= max && n === candidate;
  });
}

export function nextCronAt(expression: string, after: Date): Date | null {
  const fields = expression.trim().split(/\s+/); if (fields.length !== 5) return null;
  const start = new Date(after.getTime() + 60000); start.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    const value = new Date(start.getTime() + i * 60000);
    if (cronField(fields[0], 0, 59, value.getMinutes()) && cronField(fields[1], 0, 23, value.getHours()) && cronField(fields[2], 1, 31, value.getDate()) && cronField(fields[3], 1, 12, value.getMonth() + 1) && cronField(fields[4], 0, 6, value.getDay())) return value;
  }
  return null;
}

export async function createSchedule(db: Db, input: ScheduleInput): Promise<string> {
  const value = scheduleInputSchema.parse(input);
  const { data, error } = await db.from("maia_schedules").insert({ owner_key: value.ownerKey, client_id: value.clientId, instruction: value.instruction, skills: value.skills, schedule_kind: value.kind, schedule_value: value.value, timezone: value.timezone, destination: value.destination, limits: value.limits, missed_policy: value.missedPolicy, next_run_at: value.nextRunAt }).select("id").single();
  if (error || !data) throw new Error(`Não consegui criar rotina: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}

export async function claimScheduleRun(db: Db, scheduleId: string, runKey: string, leaseOwner: string, leaseSeconds = 300): Promise<boolean> {
  const { data, error } = await db.rpc("claim_maia_schedule_run", { p_schedule_id: scheduleId, p_run_key: runKey, p_lease_owner: leaseOwner, p_lease_seconds: leaseSeconds });
  if (error) throw new Error(`Não consegui reservar rotina: ${error.message}`);
  return Boolean(data);
}

export async function finishScheduleRun(db: Db, scheduleId: string, runKey: string, input: { status: "completed" | "failed" | "uncertain" | "skipped"; deliveryStatus?: "not_attempted" | "pending" | "confirmed" | "failed" | "uncertain"; result?: string; error?: string }): Promise<void> {
  const { error } = await db.from("maia_schedule_runs").update({ status: input.status, delivery_status: input.deliveryStatus ?? "not_attempted", result: input.result?.slice(0, 16000) ?? null, error: input.error?.slice(0, 2000) ?? null, finished_at: new Date().toISOString(), lease_owner: null, lease_until: null }).eq("schedule_id", scheduleId).eq("run_key", runKey).eq("status", "leased");
  if (error) throw new Error(`Não consegui finalizar rotina: ${error.message}`);
}
