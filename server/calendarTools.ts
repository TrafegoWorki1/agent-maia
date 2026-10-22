import { z } from "zod";
import type { Db } from "./store.ts";
import { buildFreeBusyWindow, checkFreeBusy, createEvent, listCalendars, suggestMeetingSlots } from "./integrations/googleCalendarNative.ts";

// Ferramentas de agenda nativas (Google Calendar via REST direto), compartilhadas pelos dois executores
// (Claude e Codex), no mesmo molde de `sheetsTools`. Existem para que o owner não perca a agenda quando o
// Claude estiver indisponível e o Codex assumir: o conector `mcp__claude_ai_Google_Calendar__*` só existe
// dentro da sessão do Claude. Mesmo token OAuth do Drive/Sheets, com o escopo calendar ampliado.
// Leitura livre; criar evento sempre pede OK do owner (server/approvalPolicy.ts).

export interface CalendarTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (db: Db, input: unknown) => Promise<unknown>;
}

function define<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (db: Db, input: z.infer<z.ZodObject<S>>) => Promise<unknown>): CalendarTool {
  const schema = z.object(shape);
  return { name, description, schema: schema as unknown as z.ZodObject<z.ZodRawShape>, run: async (db, input) => run(db, schema.parse(input)) };
}

const calendario = z.string().min(1).max(200).describe("ID do calendário (use agenda_calendarios para descobrir) ou 'primary' para a agenda principal do owner.");
const inicio = z.string().datetime({ offset: true }).describe("Início, ISO 8601 com fuso, ex.: 2026-10-23T09:00:00-03:00.");
const fim = z.string().datetime({ offset: true }).describe("Fim, ISO 8601 com fuso.");

export const calendarTools: CalendarTool[] = [
  define("agenda_calendarios", "Lista os calendários acessíveis pela conta do owner (ID e nome). Só leitura.",
    {},
    async () => listCalendars()),

  define("agenda_disponibilidade", "Consulta os horários ocupados de um calendário numa janela de até 60 dias. Só leitura; não confirma disponibilidade de terceiros fora deste calendário.",
    { calendario, inicio, fim },
    async (_db, i) => {
      const window = buildFreeBusyWindow(i.inicio, i.fim);
      if (!window.ok) throw new Error(window.error);
      const busy = await checkFreeBusy(i.calendario, i.inicio, i.fim);
      return { calendario: i.calendario, janela: window.body, ocupado: busy };
    }),

  define("agenda_sugerir_horarios", "Encontra automaticamente até 3 horários livres nos próximos dias úteis, entre 9h e 18h, usando o fuso e a duração padrão da Google Agenda. Use para marcar reunião sem perguntar data, horário ou duração. Se informar e-mail do convidado, tenta consultar a disponibilidade compartilhada dele; sem acesso, o estado fica desconhecido.",
    { calendario: calendario.optional().default("primary"), convidado_email: z.string().email().optional(), dias: z.number().int().min(1).max(14).optional().default(7) },
    async (_db, i) => suggestMeetingSlots(i.calendario, i.convidado_email, i.dias)),

  define("agenda_criar_evento", "Cria um evento na agenda com Google Meet por padrão e envia o convite aos convidados. Use o horário, fuso e duração de agenda_sugerir_horarios quando o usuário não definir. Sempre pede OK do owner antes de rodar.",
    {
      calendario,
      titulo: z.string().min(1).max(200),
      inicio,
      fim,
      fuso: z.string().min(1).max(80).describe("Fuso horário IANA, ex.: America/Sao_Paulo."),
      local: z.string().max(300).optional(),
      descricao: z.string().max(2000).optional(),
      convidados: z.array(z.string().email()).max(20).optional().describe("E-mails dos convidados; a Google Agenda envia o convite."),
      com_meet: z.boolean().optional().default(true).describe("Google Meet por padrão; false se o usuário pedir encontro presencial ou sem videoconferência."),
    },
    async (_db, i) => createEvent({
      calendarId: i.calendario,
      summary: i.titulo,
      startIso: i.inicio,
      endIso: i.fim,
      timezone: i.fuso,
      location: i.local,
      description: i.descricao,
      attendeeEmails: i.convidados,
      requestMeet: i.com_meet,
    })),
];
