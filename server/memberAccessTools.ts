import { z } from "zod";
import type { Db } from "./store.ts";
import { resolveRequester } from "./access.ts";
import { canonicalPhone } from "./evolutionWebhook.ts";

const id = z.string().uuid();
const memberId = z.object({ pessoa_id: id });
const change = memberId.extend({ capacidade: z.string().min(1).max(80), modo: z.enum(["permitido", "bloqueado", "aprovacao"]) });
const enforcedCapabilities = new Set(["conversa.maia", "gmail.ler", "meta.ler", "sheets.ler", "sheets.editar", "agenda.ler", "mensagem.enviar", "escrita.pedir", "integracao.usar", "escrita.aprovar", "painel.ver", "trabalho.ver", "trabalho.atualizar", "trabalho.revisar", "trabalho.aprovar", "trabalho.planejar", "trabalho.redistribuir", "tarefas.criar", "indicadores.ver", "financeiro.ver"]);
export function validateMemberAccessChange(code: string, mode: string): void {
  if (!enforcedCapabilities.has(code)) throw new Error(`A capacidade ${code} não tem aplicação efetiva verificada neste fluxo; nenhuma alteração foi feita.`);
  if (mode === "aprovacao" && (["conversa.maia","escrita.aprovar","painel.ver","indicadores.ver","financeiro.ver"].includes(code))) throw new Error(`A capacidade ${code} não admite OK pontual neste fluxo; nenhuma alteração foi feita.`);
}
const normalizedName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

async function find(db: Db, query: string) {
  const { data: people, error } = await db.from("people").select("id,name,role,active").eq("active", true).neq("role", "proprietario");
  if (error) throw new Error(error.message);
  const { data: numbers, error: numberError } = await db.from("person_numbers").select("person_id,number");
  if (numberError) throw new Error(numberError.message);
  const term = normalizedName(query.trim());
  const digits = query.replace(/\D/g, "");
  return (people ?? []).filter((p) => normalizedName(String(p.name)).includes(term) || (digits.length >= 8 && (numbers ?? []).some((n) => n.person_id === p.id && canonicalPhone(String(n.number)) === canonicalPhone(digits)))).map((p) => ({ ...p, numbers: (numbers ?? []).filter((n) => n.person_id === p.id).map((n) => n.number) }));
}

async function details(db: Db, personId: string) {
  const person = await db.from("people").select("id,name,role,active").eq("id", personId).maybeSingle();
  if (person.error || !person.data?.active || person.data.role === "proprietario") throw new Error("Membro não encontrado ou inativo.");
  const [numbers, direct, memberships, groups, catalog, overrides] = await Promise.all([
    db.from("person_numbers").select("number").eq("person_id", personId),
    db.from("person_permissions").select("permission_code").eq("person_id", personId),
    db.from("maia_access_group_members").select("access_group_id").eq("person_id", personId),
    db.from("maia_access_groups").select("id,name,active,client_id"),
    db.from("permission_catalog").select("code,label"),
    db.from("maia_member_access_modes").select("permission_code,mode").eq("person_id", personId),
  ]);
  for (const result of [numbers,direct,memberships,groups,catalog,overrides]) if (result.error) throw new Error(result.error.message);
  const activeGroups = (groups.data ?? []).filter((g) => g.active && (memberships.data ?? []).some((m) => m.access_group_id === g.id));
  const eligible = activeGroups.filter((g) => !g.client_id);
  const grants = activeGroups.length ? await db.from("maia_access_group_permissions").select("access_group_id,permission_code").in("access_group_id", activeGroups.map((g) => g.id)) : { data: [], error: null };
  if (grants.error) throw new Error(grants.error.message);
  return { pessoa: { ...person.data, numeros: (numbers.data ?? []).map((n) => n.number) }, capacidades: (catalog.data ?? []).map((c) => {
    const individual = (overrides.data ?? []).find((o) => o.permission_code === c.code)?.mode ?? null;
    const direto = (direct.data ?? []).some((d) => d.permission_code === c.code);
    const equipes = eligible.filter((g) => (grants.data ?? []).some((p) => p.access_group_id === g.id && p.permission_code === c.code)).map((g) => g.name);
    const equipes_cliente = activeGroups.filter((g) => g.client_id && (grants.data ?? []).some((p) => p.access_group_id === g.id && p.permission_code === c.code)).map((g) => ({ cliente_id: g.client_id, equipe: g.name }));
    return { codigo: c.code, nome: c.label, administravel_pela_maia: enforcedCapabilities.has(c.code), modo_individual: individual, concessao_direta: direto, equipes, equipes_cliente, efetivo: individual === "bloqueado" ? "bloqueado" : individual === "aprovacao" ? "exige_aprovacao" : individual === "permitido" || direto || equipes.length ? "permitido" : "sem_acesso" };
  }) };
}

async function defineAccess(db: Db, args: z.infer<typeof change>, actorNumber: string, taskId?: number) {
  const actor = await resolveRequester(db, actorNumber, "");
  if (actor.role !== "owner") throw new Error("Somente o proprietário autenticado pode alterar acessos.");
  validateMemberAccessChange(args.capacidade, args.modo);
  await details(db, args.pessoa_id);
  const result = await db.rpc("set_maia_member_access_mode", { p_person_id: args.pessoa_id, p_code: args.capacidade, p_mode: args.modo, p_actor_number: actorNumber, p_task_id: taskId ?? null });
  if (result.error) throw new Error(result.error.message);
  const state = await details(db, args.pessoa_id);
  const capability = state.capacidades.find((p) => p.codigo === args.capacidade);
  if (!capability || capability.modo_individual !== args.modo) throw new Error("Mudança registrada, mas não confirmada na leitura. Confira o painel antes de prosseguir.");
  return { pessoa: state.pessoa, capacidade: capability, observacao: "Somente acesso via Maia. Compartilhamentos diretos no Google Drive não foram alterados." };
}

export const memberAccessTools = [
  { name: "membro_acesso_localizar", description: "Localiza membros EXISTENTES por nome ou número cadastrado. Se houver mais de um resultado, peça ao proprietário para escolher a pessoa exata; não altere por nome ambíguo. Apenas proprietário autenticado no privado.", schema: z.object({ busca: z.string().min(2).max(100) }), run: (db: Db, args: { busca: string }) => find(db, args.busca) },
  { name: "membro_acesso_consultar", description: "Consulta permissões diretas, herdadas de equipe e bloqueios individuais de um membro cadastrado. Use pessoa_id obtido pela localização. Não altera compartilhamento direto do Google Drive.", schema: memberId, run: (db: Db, args: { pessoa_id: string }) => details(db, args.pessoa_id) },
  { name: "membro_acesso_definir", description: "Define para um membro existente uma capacidade efetivamente verificada pela Maia como permitido, bloqueado ou aprovacao (OK pontual). Use pessoa_id exato e código administrável da consulta. Entrada conversa.maia e escrita.aprovar não admitem aprovação pontual. Alteração exclusiva do proprietário autenticado no privado. Não modifica compartilhamento direto do Google Drive.", schema: change,
    run: defineAccess },
];

export async function runMemberAccessTool(db: Db, toolName: string, input: unknown, actorNumber: string, taskId?: number) {
  const actor = await resolveRequester(db, actorNumber, "");
  if (actor.role !== "owner") throw new Error("Administração de acesso exclusiva do proprietário autenticado.");
  if (toolName === "membro_acesso_localizar") return find(db, z.object({ busca: z.string().min(2).max(100) }).parse(input).busca);
  if (toolName === "membro_acesso_consultar") return details(db, memberId.parse(input).pessoa_id);
  if (toolName === "membro_acesso_definir") return defineAccess(db, change.parse(input), actorNumber, taskId);
  throw new Error("Ferramenta desconhecida.");
}
