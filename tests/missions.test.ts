import { describe, it, expect } from "vitest";
import { authoritySchema, missionDecisionSchema, slotAllowed, checkMeeting } from "../server/missions.ts";
import { calendarArguments, availableStarts, parseCalendarEvent, parseConnectorResult } from "../server/missionCalendar.ts";
import { decideAccess, ownerRequester } from "../server/access.ts";
import { missionTools } from "../server/missionTools.ts";
import { MAIA_TOOL_NAMES } from "../server/toolPolicy.ts";

const meeting = { calendar: "primary", timezone: "America/Sao_Paulo", durationMinutes: 45, windows: [{ start: "2030-10-22T10:00:00-03:00", end: "2030-10-22T12:00:00-03:00" }], location: "Escritório", inviteByEmail: false };
describe("contrato de autonomia", () => {
  it("recusa ampliação de ferramentas e decisões não previstas", () => {
    expect(authoritySchema.safeParse({ owner: "5585999990000", contact: "5585999990001", contactName: "Teste", conversation: "dm:5585999990001", objective: "Agendar", tools: ["gmail"] }).success).toBe(false);
    expect(missionDecisionSchema.safeParse({ action: "schedule", start: meeting.windows[0].start, calendar: "outro", acceptanceEvent: 1 }).success).toBe(false);
    expect(missionDecisionSchema.safeParse({ action: "publish" }).success).toBe(false);
  });
  it("limita duração, janela e fuso sem usar datas locais implícitas", () => {
    expect(slotAllowed(meeting, "2030-10-22T10:00:00-03:00", 0)).toBe(true);
    expect(slotAllowed(meeting, "2030-10-22T11:30:00-03:00", 0)).toBe(false);
    expect(() => checkMeeting({ ...meeting, timezone: "invalido" })).toThrow();
  });
  it("só oferece intervalos livres e suficientes", () => {
    const slots = availableStarts(meeting, [{ start: "2030-10-22T13:00:00Z", end: "2030-10-22T14:00:00Z" }], 0);
    expect(slots).toEqual(["2030-10-22T14:00:00.000Z", "2030-10-22T14:15:00.000Z"]);
  });
  it("confinamento de ferramentas protege membros, visitantes e grupos", () => {
    for (const t of missionTools) {
      expect(MAIA_TOOL_NAMES.has(t.name)).toBe(true);
      expect(decideAccess(`mcp__maia__${t.name}`, { role: "guest", name: "", number: "", permissions: new Set() }, {}, true).decision).toBe("deny");
      expect(decideAccess(`mcp__maia__${t.name}`, ownerRequester(), {}, false).decision).toBe("allow");
    }
  });
});
describe("ponte confinada da agenda", () => {
  const op = { action: "create" as const, calendar: "primary", title: "Reunião", start: "2030-10-22T13:00:00Z", end: "2030-10-22T13:45:00Z", timezone: "America/Sao_Paulo", location: "Escritório" };
  it("substitui parâmetros propostos por dados do servidor e nega operações extras", () => {
    const args = calendarArguments(op, "mcp__claude_ai_Google_Calendar__create_event", { calendar_id: "outra", summary: "vazamento", start: {}, end: {}, location: "outro" });
    expect(args).toMatchObject({ calendar_id: "primary", summary: "Reunião", start: { dateTime: op.start }, location: "Escritório" });
    expect(calendarArguments(op, "mcp__claude_ai_Google_Calendar__delete_event", {})).toBeNull();
    expect(calendarArguments(op, "mcp__claude_ai_Google_Calendar__create_event", { ...args, recurrence: ["RRULE:FREQ=DAILY"] })).toBeNull();
  });
  it("recusa prova narrativa, evento incompleto e resultado com erro", () => {
    expect(() => parseConnectorResult("Já agendei!")).toThrow();
    expect(() => parseCalendarEvent({ id: "inventado" })).toThrow();
    expect(() => parseConnectorResult({ isError: true })).toThrow();
    expect(parseCalendarEvent({ id: "real", start: { dateTime: op.start }, end: { dateTime: op.end } }).id).toBe("real");
  });
});
