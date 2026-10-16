import { z } from "zod";
import type { Db } from "./store.ts";

export const scheduleInputSchema = z.object({
  ownerKey: z.string().trim().min(1).max(240), clientId: z.string().uuid().nullable().default(null), instruction: z.string().trim().min(1).max(8000), skills: z.array(z.string()).max(20).default([]), kind: z.enum(["once", "interval", "cron"]), value: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(80).default("America/Sao_Paulo"), destination: z.string().trim().min(1).max(240), limits: z.record(z.string(), z.unknown()).default({}), missedPolicy: z.enum(["skip", "run_once", "catch_up"]).default("skip"), nextRunAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export function nextScheduleAt(kind: ScheduleInput["kind"], value: string, after: Date, timezone = "America/Sao_Paulo"): Date | null {
  if (kind === "once") { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date > after ? date : null; }
  if (kind === "interval") { const match = value.match(/^(\d+)\s*(s|m|h|d)$/i); if (!match) return null; const ms = Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 } as Record<string, number>)[match[2].toLowerCase()]; return new Date(after.getTime() + ms); }
  return nextCronAt(value, after, timezone);
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

export function nextCronAt(expression: string, after: Date, timezone = "America/Sao_Paulo"): Date | null {
  const fields = expression.trim().split(/\s+/); if (fields.length !== 5) return null;
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return null; }
  const start = new Date(after.getTime() + 60000); start.setSeconds(0, 0);
  for (let i = 0; i < 366 * 24 * 60; i += 1) {
    const value = new Date(start.getTime() + i * 60000);
    const parts = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const dateMatches = cronField(fields[2], 1, 31, day);
    const weekMatches = cronField(fields[4], 0, 6, dayOfWeek);
    const dayMatches = fields[2] === "*" ? weekMatches : fields[4] === "*" ? dateMatches : dateMatches || weekMatches;
    if (cronField(fields[0], 0, 59, Number(parts.minute)) && cronField(fields[1], 0, 23, Number(parts.hour)) && dayMatches && cronField(fields[3], 1, 12, month)) return value;
  }
  return null;
}

export async function createSchedule(db: Db, input: ScheduleInput): Promise<string> {
  const value = scheduleInputSchema.parse(input);
  const next = value.nextRunAt ? new Date(value.nextRunAt) : nextScheduleAt(value.kind, value.value, new Date(), value.timezone);
  if (!next || Number.isNaN(next.getTime())) throw new Error("Agenda ou fuso inválido; não foi criada rotina.");
  const { data, error } = await db.from("maia_schedules").insert({ owner_key: value.ownerKey, client_id: value.clientId, instruction: value.instruction, skills: value.skills, schedule_kind: value.kind, schedule_value: value.value, timezone: value.timezone, destination: value.destination, limits: value.limits, missed_policy: value.missedPolicy, next_run_at: next.toISOString() }).select("id").single();
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

export async function setScheduleStatus(db: Db, id: string, status: "active" | "paused" | "cancelled", ownerKey: string): Promise<boolean> {
  if (status === "active") {
    const current = await db.from("maia_schedules").select("next_run_at").eq("id", id).eq("owner_key", ownerKey).eq("status", "paused").maybeSingle();
    if (current.error || !current.data?.next_run_at) return false;
    const previous = await db.from("maia_schedule_runs").select("id").eq("schedule_id", id).eq("run_key", current.data.next_run_at).limit(1);
    if (previous.error || previous.data?.length) return false; // Resultado incerto/concluído não recebe replay.
  }
  const { data, error } = await db.from("maia_schedules").update({ status, updated_at: new Date().toISOString() }).eq("id", id).eq("owner_key", ownerKey).neq("status", "cancelled").select("id");
  if (error) throw new Error(`Não consegui alterar rotina: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function editSchedule(db: Db, id: string, ownerKey: string, patch: { instruction: string; kind: ScheduleInput["kind"]; value: string; timezone: string }): Promise<boolean> {
  const values = z.object({ instruction: z.string().trim().min(1).max(8000), kind: z.enum(["once", "interval", "cron"]), value: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(80) }).parse(patch);
  const next = nextScheduleAt(values.kind, values.value, new Date(), values.timezone);
  if (!next) throw new Error("Agenda inválida ou horário único já passou.");
  const { data, error } = await db.from("maia_schedules").update({ instruction: values.instruction, schedule_kind: values.kind, schedule_value: values.value, timezone: values.timezone, next_run_at: next.toISOString(), updated_at: new Date().toISOString() }).eq("id", id).eq("owner_key", ownerKey).eq("status", "paused").select("id");
  if (error) throw new Error(`Não consegui editar rotina: ${error.message}`);
  return (data ?? []).length === 1;
}

export interface DueSchedule {
  id: string; owner_key: string; client_id: string | null; instruction: string; skills: string[];
  schedule_kind: ScheduleInput["kind"]; schedule_value: string; timezone: string; destination: string;
  missed_policy: ScheduleInput["missedPolicy"]; next_run_at: string; limits: Record<string, unknown>;
}

export async function recoverStaleScheduleRuns(db: Db, now = new Date()): Promise<number> {
  const { data, error } = await db.from("maia_schedule_runs").update({ status: "uncertain", delivery_status: "uncertain", error: "worker interrompido; revisar efeito antes de nova execução", finished_at: now.toISOString(), lease_owner: null, lease_until: null }).eq("status", "leased").lt("lease_until", now.toISOString()).select("schedule_id");
  if (error) throw new Error(`Recuperação de rotinas indisponível: ${error.message}`);
  for (const row of data ?? []) await db.from("maia_schedules").update({ status: "paused", updated_at: now.toISOString() }).eq("id", row.schedule_id).eq("status", "active");
  return (data ?? []).length;
}

// A execução e a entrega são resultados separados; falha incerta nunca dispara replay.
export async function runDueSchedules(db: Db, deps: {
  execute: (schedule: DueSchedule) => Promise<string>;
  deliver: (schedule: DueSchedule, result: string) => Promise<"pending" | "confirmed">;
  authorize: (schedule: DueSchedule) => Promise<boolean>;
}, now = new Date()): Promise<number> {
  const { data, error } = await db.from("maia_schedules").select("id,owner_key,client_id,instruction,skills,schedule_kind,schedule_value,timezone,destination,missed_policy,next_run_at,limits").eq("status", "active").lte("next_run_at", now.toISOString()).order("next_run_at").limit(5);
  if (error) throw new Error(`Consulta de rotinas indisponível: ${error.message}`);
  let processed = 0;
  for (const schedule of (data ?? []) as DueSchedule[]) {
    if (!(await claimScheduleRun(db, schedule.id, schedule.next_run_at, "worker", 600))) continue;
    processed += 1;
    let result: string | undefined;
    try {
      const missed = now.getTime() - Date.parse(schedule.next_run_at) > 60000;
      if (missed && schedule.missed_policy === "skip") {
        await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: "skipped", error: "horário perdido durante indisponibilidade" });
        const next = nextScheduleAt(schedule.schedule_kind, schedule.schedule_value, now, schedule.timezone);
        await db.from("maia_schedules").update({ next_run_at: next?.toISOString() ?? null, status: next ? "active" : "paused" }).eq("id", schedule.id).eq("next_run_at", schedule.next_run_at);
        continue;
      }
      const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
      const runs = await db.from("maia_schedule_runs").select("id", { count: "exact", head: true }).eq("schedule_id", schedule.id).gte("created_at", today.toISOString());
      if (runs.error) throw new Error(runs.error.message);
      const maxRuns = Math.max(1, Math.min(Number(schedule.limits.max_runs_per_day) || 5, 100));
      if ((runs.count ?? 0) > maxRuns) {
        await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: "skipped", error: "limite diário da rotina" });
        await setScheduleStatus(db, schedule.id, "paused", schedule.owner_key);
        continue;
      }
      if (!(await deps.authorize(schedule))) {
        await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: "skipped", error: "acesso ou integração revogada" });
        await setScheduleStatus(db, schedule.id, "paused", schedule.owner_key);
        continue;
      }
      result = await deps.execute(schedule);
      const current = await db.from("maia_schedules").select("status").eq("id", schedule.id).maybeSingle();
      if (current.error || current.data?.status !== "active" || !(await deps.authorize(schedule))) {
        await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: "skipped", result, error: "rotina cancelada ou acesso revogado antes da entrega" });
        continue;
      }
      const deliveryStatus = await deps.deliver(schedule, result);
      await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: "completed", deliveryStatus, result });
      const next = nextScheduleAt(schedule.schedule_kind, schedule.schedule_value, schedule.missed_policy === "catch_up" ? new Date(schedule.next_run_at) : now, schedule.timezone);
      await db.from("maia_schedules").update({ next_run_at: next?.toISOString() ?? null, status: next ? "active" : "paused", updated_at: new Date().toISOString() }).eq("id", schedule.id).eq("status", "active").eq("next_run_at", schedule.next_run_at);
    } catch (cause) {
      await finishScheduleRun(db, schedule.id, schedule.next_run_at, { status: result === undefined ? "failed" : "uncertain", deliveryStatus: result === undefined ? "not_attempted" : "uncertain", result, error: cause instanceof Error ? cause.message : String(cause) });
      await setScheduleStatus(db, schedule.id, "paused", schedule.owner_key);
    }
  }
  return processed;
}
