import { z } from "zod";
import { canonicalPhone, samePhone } from "./evolutionWebhook.ts";
import { resolveContact } from "./contacts.ts";
import { pickGroup, resolveMentions } from "./groupTools.ts";
import { resolveRequester } from "./access.ts";
import { authoritySchema, checkMeeting, controlMission, meetingSchema, type Authority } from "./missions.ts";
import type { Db } from "./store.ts";
import type { LiveGroup } from "./groups.ts";

export const createMissionSchema = z.object({
  titulo: z.string().trim().min(3).max(120), objetivo: z.string().trim().min(3).max(2000),
  tipo: z.enum(["conversation", "meeting", "group_action"]), contato: z.string().min(1).max(150),
  reuniao: meetingSchema.optional(),
  grupo_origem: z.string().max(120).optional(),
  aviso_grupo: z.object({ grupo: z.string().min(1).max(120), texto: z.string().min(1).max(2500), mencionar: z.array(z.string().min(1)).max(20).default([]), mencionar_todos: z.boolean().default(false) }).strict().optional(),
  validade_horas: z.number().int().min(1).max(168).default(168), max_interacoes: z.number().int().min(1).max(30).default(8),
}).strict();
export const controlMissionSchema = z.object({ missao: z.number().int().positive(), revisao: z.number().int().positive(), acao: z.enum(["pause", "resume", "cancel", "correct"]), correcao: z.string().max(2000).default("") }).strict();

export async function runMissionTool(db: Db, name: string, args: unknown, owner: string, taskId?: number, originalRequest = "") {
  const actor = await resolveRequester(db, owner, "");
  if (actor.role !== "owner" || !samePhone(owner, process.env.EVOLUTION_OWNER_NUMBER)) throw new Error("Missões são exclusivas do proprietário no privado");
  if (name === "missoes_listar") {
    const result = await db.from("maia_plans").select("id,title,kind,status,mission_state,revision,expires_at,interaction_count,max_interactions,context,mission_notice").neq("kind", "general").order("updated_at", { ascending: false }).limit(30);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  if (name === "missao_controlar") {
    const input = controlMissionSchema.parse(args);
    return controlMission(db, input.missao, input.revisao, input.acao, input.correcao);
  }
  if (name !== "missao_criar" || !taskId || !originalRequest.trim()) throw new Error("Falta pedido original autenticado para a delegação");
  const input = createMissionSchema.parse(args);
  const contact = await resolveContact(db, input.contato);
  if (!contact.ok) throw new Error(contact.error);
  if (samePhone(contact.contact.number, owner)) throw new Error("Escolha o contato externo desta missão");
  if (input.tipo === "meeting" && !input.reuniao) throw new Error("Informe calendário, duração, fuso, janelas e local/formato acordados");
  if (input.tipo !== "meeting" && input.reuniao) throw new Error("Agenda só é permitida na missão de reunião");
  if (input.tipo === "group_action" && !input.aviso_grupo) throw new Error("Defina o aviso no grupo");
  if (input.grupo_origem && input.tipo !== "group_action") throw new Error("Negociações de reunião/conversa ocorrem no privado do contato");
  checkMeeting(input.reuniao);
  const groups = await db.from("maia_groups").select("jid,name").eq("active", true);
  if (groups.error) throw new Error(groups.error.message);
  const registered = (groups.data ?? []).map(g => ({ jid: g.jid, subject: g.name, size: null }) as LiveGroup);
  let group: Authority["group"];
  if (input.aviso_grupo) {
    const found = pickGroup(registered, input.aviso_grupo.grupo);
    if (!found.ok) throw new Error(`${found.error}. Missões aceitam somente grupos cadastrados; grupo avulso segue aprovação pelo fluxo existente.`);
    const mentions = await resolveMentions(db, input.aviso_grupo.mencionar);
    if (!mentions.ok) throw new Error(mentions.error);
    if (input.aviso_grupo.mencionar_todos && !/\b(todos|todas|todo mundo)\b/i.test(originalRequest)) throw new Error("Mencionar todos exige pedido explícito do owner");
    group = { jid: found.group.jid, name: found.group.subject, text: input.aviso_grupo.texto, mentions: mentions.numbers, everyone: input.aviso_grupo.mencionar_todos };
  }
  let conversation = `dm:${canonicalPhone(contact.contact.number)}`;
  if (input.grupo_origem) {
    const found = pickGroup(registered, input.grupo_origem);
    if (!found.ok) throw new Error(found.error);
    conversation = found.group.jid;
  }
  const authority = authoritySchema.parse({ owner: owner.replace(/\D/g, ""), contact: contact.contact.number, contactName: contact.contact.name, conversation, objective: input.objetivo, ...(input.reuniao ? { meeting: input.reuniao } : {}), ...(group ? { group } : {}) });
  const existing = await db.from("maia_plans").select("id,authority").eq("status", "active").neq("kind", "general");
  if (existing.error) throw new Error(existing.error.message);
  const conflict = existing.data?.find(p => p.authority.conversation === conversation);
  if (conflict) throw new Error(`A conversa já pertence à missão #${conflict.id}. Consulte/corrija essa missão para juntar objetivos; não inicie duas negociações concorrentes.`);
  const created = await db.from("maia_plans").insert({ title: input.titulo, request: originalRequest.slice(0, 8000), task_id: taskId, steps: [], kind: input.tipo, authority, mission_state: input.tipo === "group_action" ? "waiting_external" : "working", expires_at: new Date(Date.now() + input.validade_horas * 3600_000).toISOString(), max_interactions: input.max_interacoes }).select("id").single();
  if (created.error || !created.data) throw new Error(created.error?.message ?? "Não foi possível gravar a missão");
  return { id: created.data.id, state: input.tipo === "group_action" ? "waiting_external" : "working", message: "Missão persistida. O worker continuará a conversa e trará o resultado; consulte o mesmo andamento em Núcleo no painel." };
}

export const missionTools = [
  { name: "missao_criar", description: "Delega um objetivo do owner para continuar em mensagens futuras: conversar/coletar informações, negociar e agendar reunião, ou aviso condicional em grupo cadastrado. Persiste antes de qualquer envio. O pedido original é guardado pelo servidor. Para reunião, use preferências conhecidas ou pergunte o essencial (calendário, duração, janelas ISO, fuso, local/Meet e convite por e-mail); não invente preferências. Não use para prospecção em massa. Mencionar todos só quando pedido. Envio imediato no grupo usa grupo_enviar_texto.", schema: createMissionSchema },
  { name: "missao_controlar", description: "Pausa, cancela, retoma ou corrige uma missão do proprietário. Consulte missoes_listar para ID e revisão atuais. Correção orienta o objetivo sem ampliar contatos/calendário/grupo/janelas delegados. Cancelamento impede próximos efeitos e não desfaz agendamentos. Efeitos incertos exigem conferência.", schema: controlMissionSchema },
  { name: "missoes_listar", description: "Consulta andamento, revisão, limites e evidências das missões. Compartilha os registros com o painel Núcleo.", schema: z.object({}).strict() },
];
