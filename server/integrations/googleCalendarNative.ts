// Cliente da Google Calendar API v3 via REST direto (sem SDK), igual ao padrão do Google Drive.
// Auth: mesmo OAuth2 do Drive (server/integrations/googleDrive.ts), com o escopo calendar ampliado no
// mesmo refresh token. Existe porque o conector `mcp__claude_ai_Google_Calendar__*` só roda dentro da
// sessão do Claude; esta integração própria funciona também sob o Codex quando o Claude está indisponível.
//
// Leitura: listar calendários e consultar disponibilidade (freeBusy). Escrita: criar evento, sempre com
// aprovação do owner (decidido em server/approvalPolicy.ts, não aqui). Nunca aceita o texto do modelo como
// prova de que o evento existe: toda criação exige ID bruto, início/fim válidos e link do domínio do Google,
// no mesmo molde de server/missionCalendar.ts.

import { getAccessToken } from "./googleDrive.ts";

const BASE = "https://www.googleapis.com/calendar/v3";
const MAX_WINDOW_DAYS = 60;

export class CalendarError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function describeFailure(status: number, body: unknown): string {
  if (status === 401 || status === 403) return "a Google Agenda recusou a autenticação (token sem o escopo calendar ou expirado)";
  if (status === 404) return "a Google Agenda não encontrou o calendário ou o evento";
  if (status === 429) return "a Google Agenda limitou as chamadas (muitas requisições)";
  if (status >= 500) return "a Google Agenda está indisponível no momento";
  const detail = body && typeof body === "object" ? String((body as { error?: { message?: unknown } }).error?.message ?? "") : "";
  return `a Google Agenda recusou o pedido (HTTP ${status})${detail ? `: ${detail.slice(0, 160)}` : ""}`;
}

async function request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 20_000): Promise<{ status: number; json: unknown }> {
  const token = await getAccessToken();
  const response = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
}

export async function listCalendars(): Promise<CalendarInfo[]> {
  const { status, json } = await request("GET", "/users/me/calendarList?minAccessRole=writer");
  if (!ok(status)) throw new CalendarError(describeFailure(status, json), status);
  const items = ((json as { items?: unknown[] })?.items ?? []) as Record<string, unknown>[];
  return items.map((c) => ({ id: String(c.id ?? ""), name: String(c.summary ?? c.id ?? "sem nome"), primary: c.primary === true })).filter((c) => c.id);
}

// Validação pura, sem rede: janela de consulta não pode ser invertida, vazia ou maior que o limite.
export function buildFreeBusyWindow(startIso: string, endIso: string, now = Date.now()): { ok: true; body: { timeMin: string; timeMax: string } } | { ok: false; error: string } {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "datas inválidas; use ISO 8601 com fuso (ex.: 2026-10-23T09:00:00-03:00)" };
  if (end <= start) return { ok: false, error: "o fim precisa ser depois do início" };
  if (end - start > MAX_WINDOW_DAYS * 86_400_000) return { ok: false, error: `janela maior que ${MAX_WINDOW_DAYS} dias` };
  if (end < now) return { ok: false, error: "a janela já terminou no passado" };
  return { ok: true, body: { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() } };
}

export interface BusyWindow {
  start: string;
  end: string;
}

export async function checkFreeBusy(calendarId: string, startIso: string, endIso: string): Promise<BusyWindow[]> {
  const window = buildFreeBusyWindow(startIso, endIso);
  if (!window.ok) throw new CalendarError(window.error, 0);
  const { status, json } = await request("POST", "/freeBusy", { ...window.body, items: [{ id: calendarId }] });
  if (!ok(status)) throw new CalendarError(describeFailure(status, json), status);
  const calendars = (json as { calendars?: Record<string, { busy?: unknown[]; errors?: unknown[] }> })?.calendars ?? {};
  const entry = calendars[calendarId];
  if (!entry) throw new CalendarError("a Google Agenda não devolveu dados para esse calendário", 0);
  if (entry.errors?.length) throw new CalendarError(describeFailure(404, entry), 404);
  return ((entry.busy ?? []) as Record<string, unknown>[]).map((b) => ({ start: String(b.start ?? ""), end: String(b.end ?? "") })).filter((b) => b.start && b.end);
}

export interface CreateEventInput {
  calendarId: string;
  summary: string;
  startIso: string;
  endIso: string;
  timezone: string;
  location?: string;
  attendeeEmails?: string[];
  requestMeet?: boolean;
  description?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validação pura: monta o corpo do evento ou devolve o motivo da recusa, sem tocar a rede.
export function buildEventPayload(input: CreateEventInput, now = Date.now()): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const summary = input.summary.trim();
  if (!summary) return { ok: false, error: "informe um título para o evento" };
  const start = Date.parse(input.startIso);
  const end = Date.parse(input.endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "datas inválidas; use ISO 8601 com fuso" };
  if (end <= start) return { ok: false, error: "o fim precisa ser depois do início" };
  if (start < now) return { ok: false, error: "o evento precisa começar no futuro" };
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone }).format();
  } catch {
    return { ok: false, error: "fuso horário inválido" };
  }
  const emails = input.attendeeEmails ?? [];
  if (emails.some((e) => !EMAIL.test(e))) return { ok: false, error: "um dos e-mails de convidado é inválido" };
  if (emails.length > 20) return { ok: false, error: "no máximo 20 convidados" };

  const body: Record<string, unknown> = {
    summary,
    start: { dateTime: new Date(start).toISOString(), timeZone: input.timezone },
    end: { dateTime: new Date(end).toISOString(), timeZone: input.timezone },
  };
  if (input.description) body.description = input.description.slice(0, 2000);
  if (input.location) body.location = input.location.slice(0, 300);
  if (emails.length) body.attendees = emails.map((email) => ({ email }));
  if (input.requestMeet) {
    body.conferenceData = { createRequest: { requestId: `maia-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return { ok: true, body };
}

export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
  link: string | null;
  meetLink: string | null;
  location: string | null;
}

// Nunca aceita o relato do modelo como prova: exige ID, início/fim válidos, status ativo e link do domínio
// do Google quando houver (mesmo contrato de server/missionCalendar.ts, aplicado à resposta HTTP direta).
export function parseEvent(raw: unknown): CalendarEvent {
  const e = raw as Record<string, unknown>;
  const id = typeof e?.id === "string" ? e.id : "";
  if (!id) throw new CalendarError("a Google Agenda não devolveu o ID do evento; não confirme a criação", 0);
  const start = String((e.start as Record<string, unknown> | undefined)?.dateTime ?? (e.start as Record<string, unknown> | undefined)?.date ?? "");
  const end = String((e.end as Record<string, unknown> | undefined)?.dateTime ?? (e.end as Record<string, unknown> | undefined)?.date ?? "");
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) {
    throw new CalendarError("a Google Agenda devolveu início/fim inválidos para o evento criado", 0);
  }
  if (e.status === "cancelled") throw new CalendarError("a Google Agenda marcou o evento como cancelado", 0);
  const link = typeof e.htmlLink === "string" ? e.htmlLink : null;
  if (link && !/^https:\/\/(calendar|meet)\.google\.com\//.test(link)) throw new CalendarError("link do evento fora do domínio do Google; não confirme a criação", 0);
  const conference = e.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined;
  const meetLink = conference?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
  return { id, start, end, link, meetLink, location: typeof e.location === "string" ? e.location : null };
}

export async function createEvent(input: CreateEventInput): Promise<CalendarEvent> {
  const built = buildEventPayload(input);
  if (!built.ok) throw new CalendarError(built.error, 0);
  const path = `/calendars/${encodeURIComponent(input.calendarId)}/events${input.requestMeet ? "?conferenceDataVersion=1" : ""}`;
  const { status, json } = await request("POST", path, built.body);
  if (!ok(status)) throw new CalendarError(describeFailure(status, json), status);
  return parseEvent(json);
}
