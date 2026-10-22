import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideAccess, type Requester } from "../server/access.ts";
import { requiresApproval, isReadTool } from "../server/approvalPolicy.ts";
import { isKnownMcpTool } from "../server/toolPolicy.ts";
import { describeAction } from "../server/actionDescriptions.ts";
import { calendarTools } from "../server/calendarTools.ts";
import { buildEventPayload, buildFreeBusyWindow, CalendarError, checkFreeBusy, createEvent, findMeetingSlots, getCalendarPreferences, listCalendars, parseEvent, type CreateEventInput } from "../server/integrations/googleCalendarNative.ts";

const owner: Requester = { role: "owner", name: "Herickson", number: "5511988886666", permissions: new Set() };
const member = (...perms: string[]): Requester => ({ role: "member", personId: "p1", name: "Jéssica", number: "5585911112222", permissions: new Set(perms) });
const TOOLS = calendarTools.map((t) => t.name);
const NOW = new Date("2026-10-22T12:00:00Z").getTime();
const TOKEN = "ya29.token-de-teste-agenda";

describe("política das ferramentas de agenda nativa", () => {
  it("todas estão no inventário", () => {
    for (const name of TOOLS) expect(isKnownMcpTool(`mcp__maia__${name}`), name).toBe(true);
  });
  it("leitura é consulta; criar evento não é", () => {
    expect(isReadTool("mcp__maia__agenda_calendarios")).toBe(true);
    expect(isReadTool("mcp__maia__agenda_disponibilidade")).toBe(true);
    expect(isReadTool("mcp__maia__agenda_sugerir_horarios")).toBe(true);
    expect(isReadTool("mcp__maia__agenda_criar_evento")).toBe(false);
  });
  it("criar evento pede OK, inclusive do owner", () => {
    expect(requiresApproval("mcp__maia__agenda_criar_evento")).toBe(true);
    expect(decideAccess("mcp__maia__agenda_criar_evento", owner, {}, false).decision).toBe("approve");
  });
  it("listar/consultar ficam livres para o owner", () => {
    for (const name of ["agenda_calendarios", "agenda_disponibilidade", "agenda_sugerir_horarios"]) {
      expect(decideAccess(`mcp__maia__${name}`, owner, {}, true).decision, name).toBe("allow");
    }
  });
  it("membro consulta com agenda.ler; sem a permissão, pede aprovação", () => {
    expect(decideAccess("mcp__maia__agenda_disponibilidade", member("agenda.ler"), {}, true).decision).toBe("allow");
    expect(decideAccess("mcp__maia__agenda_disponibilidade", member(), {}, true).decision).toBe("approve");
  });
  it("membro bloqueado não consulta, mesmo com a permissão", () => {
    const blocked = { ...member("agenda.ler"), blockedPermissions: new Set(["agenda.ler"]) };
    expect(decideAccess("mcp__maia__agenda_disponibilidade", blocked, {}, true).decision).toBe("deny");
  });
  it("descreve a criação de evento em português, sem nome de ferramenta", () => {
    const label = describeAction("mcp__maia__agenda_criar_evento", { titulo: "Reunião com a Ana", inicio: "2026-10-23T09:00:00-03:00", com_meet: true });
    expect(label).toContain("Reunião com a Ana");
    expect(label).toContain("Meet");
  });
});

describe("validação pura (sem rede)", () => {
  it("janela de disponibilidade recusa invertida, vazia, passada ou maior que 60 dias", () => {
    expect(buildFreeBusyWindow("2026-10-23T10:00:00Z", "2026-10-23T09:00:00Z", NOW).ok).toBe(false);
    expect(buildFreeBusyWindow("x", "2026-10-23T09:00:00Z", NOW).ok).toBe(false);
    expect(buildFreeBusyWindow("2026-10-01T09:00:00Z", "2026-10-01T10:00:00Z", NOW).ok).toBe(false);
    expect(buildFreeBusyWindow("2026-10-23T09:00:00Z", "2027-02-01T09:00:00Z", NOW).ok).toBe(false);
    expect(buildFreeBusyWindow("2026-10-23T09:00:00Z", "2026-10-23T10:00:00Z", NOW).ok).toBe(true);
  });

  const base: CreateEventInput = { calendarId: "primary", summary: "Reunião", startIso: "2026-10-23T09:00:00-03:00", endIso: "2026-10-23T10:00:00-03:00", timezone: "America/Sao_Paulo" };

  it("recusa título vazio, datas inválidas, fim antes do início e evento no passado", () => {
    expect(buildEventPayload({ ...base, summary: "   " }, NOW).ok).toBe(false);
    expect(buildEventPayload({ ...base, startIso: "não é data" }, NOW).ok).toBe(false);
    expect(buildEventPayload({ ...base, endIso: base.startIso }, NOW).ok).toBe(false);
    expect(buildEventPayload({ ...base, startIso: "2026-01-01T09:00:00-03:00", endIso: "2026-01-01T10:00:00-03:00" }, NOW).ok).toBe(false);
  });

  it("recusa fuso inválido e e-mail de convidado inválido", () => {
    expect(buildEventPayload({ ...base, timezone: "Nao/Existe" }, NOW).ok).toBe(false);
    expect(buildEventPayload({ ...base, attendeeEmails: ["nao-e-email"] }, NOW).ok).toBe(false);
  });

  it("monta o corpo com convidados e pedido de Meet", () => {
    const built = buildEventPayload({ ...base, attendeeEmails: ["ana@exemplo.com"], requestMeet: true }, NOW);
    expect(built.ok && built.body).toMatchObject({ summary: "Reunião", attendees: [{ email: "ana@exemplo.com" }] });
    expect(built.ok && (built.body as Record<string, unknown>).conferenceData).toBeDefined();
  });

  it("propõe horário útil sem conflito, com duração da conta e disponibilidade compartilhada", () => {
    const now = Date.parse("2026-10-22T11:00:00Z"); // quinta-feira, 08h em São Paulo
    const preferences = { timezone: "America/Sao_Paulo", defaultEventMinutes: 60 };
    const busy = [{ start: "2026-10-22T12:00:00Z", end: "2026-10-22T13:00:00Z" }];
    const guestBusy = [{ start: "2026-10-22T13:00:00Z", end: "2026-10-22T14:00:00Z" }];
    const slots = findMeetingSlots(busy, preferences, now, 7, guestBusy);
    expect(slots[0]).toEqual({ start: "2026-10-22T14:00:00.000Z", end: "2026-10-22T15:00:00.000Z", guestAvailability: "free" });
    expect(findMeetingSlots(busy, preferences, now, 7)[0].guestAvailability).toBe("unknown");
  });

  it("nunca aceita o relato do modelo como prova: exige ID, início/fim válidos e link do Google", () => {
    expect(() => parseEvent({})).toThrow(/ID/);
    expect(() => parseEvent({ id: "e1", start: { dateTime: "2026-10-23T09:00:00Z" }, end: { dateTime: "2026-10-23T08:00:00Z" } })).toThrow(CalendarError);
    expect(() => parseEvent({ id: "e1", start: { dateTime: "2026-10-23T09:00:00Z" }, end: { dateTime: "2026-10-23T10:00:00Z" }, status: "cancelled" })).toThrow(/cancelado/);
    expect(() => parseEvent({ id: "e1", start: { dateTime: "2026-10-23T09:00:00Z" }, end: { dateTime: "2026-10-23T10:00:00Z" }, htmlLink: "https://evil.example/e1" })).toThrow(/domínio/);
    const ok = parseEvent({ id: "e1", start: { dateTime: "2026-10-23T09:00:00Z" }, end: { dateTime: "2026-10-23T10:00:00Z" }, htmlLink: "https://calendar.google.com/calendar/event?eid=e1" });
    expect(ok).toEqual({ id: "e1", start: "2026-10-23T09:00:00Z", end: "2026-10-23T10:00:00Z", link: "https://calendar.google.com/calendar/event?eid=e1", meetLink: null, location: null });
    expect(parseEvent({ id: "e2", start: { dateTime: "2026-10-23T09:00:00Z" }, end: { dateTime: "2026-10-23T10:00:00Z" }, hangoutLink: "https://meet.google.com/abc-defg-hij" }).meetLink).toBe("https://meet.google.com/abc-defg-hij");
  });
});

describe("cliente da Google Calendar API (rede mockada)", () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  let responder: (url: string, method: string) => { status?: number; body: unknown };

  beforeEach(() => {
    calls.length = 0;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN = "rtoken";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: TOKEN, expires_in: 3600 }), { status: 200 });
      calls.push({ url, method: String(init.method ?? "GET"), body: init.body ? JSON.parse(String(init.body)) : null });
      const { status = 200, body } = responder(url, String(init.method ?? "GET"));
      return new Response(JSON.stringify(body), { status });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  });

  it("lista calendários com nome e marca o principal", async () => {
    responder = () => ({ body: { items: [{ id: "primary", summary: "Herickson", primary: true }, { id: "c2@group.calendar.google.com", summary: "Equipe" }] } });
    await expect(listCalendars()).resolves.toEqual([{ id: "primary", name: "Herickson", primary: true }, { id: "c2@group.calendar.google.com", name: "Equipe", primary: false }]);
  });

  it("lê duração e fuso das preferências do Google; valores omitidos usam defaults da API", async () => {
    responder = () => ({ body: { items: [{ id: "defaultEventLength", value: "45" }, { id: "timezone", value: "America/Sao_Paulo" }] } });
    await expect(getCalendarPreferences()).resolves.toEqual({ timezone: "America/Sao_Paulo", defaultEventMinutes: 45 });
    responder = () => ({ body: { items: [] } });
    await expect(getCalendarPreferences()).resolves.toEqual({ timezone: "Etc/GMT", defaultEventMinutes: 60 });
  });

  it("disponibilidade devolve os horários ocupados do calendário pedido", async () => {
    responder = () => ({ body: { calendars: { primary: { busy: [{ start: "2026-10-23T09:00:00Z", end: "2026-10-23T10:00:00Z" }] } } } });
    await expect(checkFreeBusy("primary", "2026-10-23T08:00:00Z", "2026-10-23T18:00:00Z")).resolves.toEqual([{ start: "2026-10-23T09:00:00Z", end: "2026-10-23T10:00:00Z" }]);
    expect(calls[0].body).toMatchObject({ items: [{ id: "primary" }] });
  });

  it("calendário sem permissão/inexistente na resposta do freeBusy vira erro claro", async () => {
    responder = () => ({ body: { calendars: { primary: { errors: [{ reason: "notFound" }] } } } });
    await expect(checkFreeBusy("primary", "2026-10-23T08:00:00Z", "2026-10-23T18:00:00Z")).rejects.toThrow(CalendarError);
  });

  it("criação recusada (401) nunca expõe o token", async () => {
    responder = () => ({ status: 401, body: { error: { message: "Invalid Credentials" } } });
    const error = await createEvent({ calendarId: "primary", summary: "Reunião", startIso: "2026-10-23T09:00:00-03:00", endIso: "2026-10-23T10:00:00-03:00", timezone: "America/Sao_Paulo" }).catch((e) => e);
    expect(error).toBeInstanceOf(CalendarError);
    expect((error as CalendarError).message).toContain("recusou a autenticação");
    expect((error as CalendarError).message).not.toContain(TOKEN);
  });

  it("criação com sucesso devolve ID, horário e link do Meet", async () => {
    responder = () => ({
      status: 200,
      body: { id: "evt1", start: { dateTime: "2026-10-23T12:00:00Z" }, end: { dateTime: "2026-10-23T13:00:00Z" }, htmlLink: "https://calendar.google.com/calendar/event?eid=evt1", conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } },
    });
    const event = await createEvent({ calendarId: "primary", summary: "Reunião", startIso: "2026-10-23T09:00:00-03:00", endIso: "2026-10-23T10:00:00-03:00", timezone: "America/Sao_Paulo", requestMeet: true });
    expect(event).toMatchObject({ id: "evt1", meetLink: "https://meet.google.com/abc-defg-hij" });
    expect(calls[0].url).toContain("conferenceDataVersion=1");
  });

  it("envia os convites aos convidados quando cria evento", async () => {
    responder = () => ({ body: { id: "evt3", start: { dateTime: "2026-10-23T12:00:00Z" }, end: { dateTime: "2026-10-23T13:00:00Z" } } });
    await createEvent({ calendarId: "primary", summary: "Reunião", startIso: "2026-10-23T09:00:00-03:00", endIso: "2026-10-23T10:00:00-03:00", timezone: "America/Sao_Paulo", attendeeEmails: ["ana@exemplo.com"] });
    expect(calls[0].url).toContain("sendUpdates=all");
  });

  it("ferramenta agenda_criar_evento chama a API real através do wrapper", async () => {
    responder = () => ({ body: { id: "evt2", start: { dateTime: "2026-10-23T12:00:00Z" }, end: { dateTime: "2026-10-23T13:00:00Z" } } });
    const tool = calendarTools.find((t) => t.name === "agenda_criar_evento")!;
    const db = {} as never;
    const result = await tool.run(db, { calendario: "primary", titulo: "Reunião", inicio: "2026-10-23T09:00:00-03:00", fim: "2026-10-23T10:00:00-03:00", fuso: "America/Sao_Paulo" });
    expect(result).toMatchObject({ id: "evt2" });
    expect(calls[0].url).toContain("conferenceDataVersion=1");
  });
});
