import { resolveGroup } from "./groupTools.ts";
import { activePlans, createPlan, describeWaiting, formatSteps, updatePlan, type PlanPatch, type Waiting } from "./plans.ts";
import type { Db } from "./store.ts";

// Lógica das ferramentas plano_criar, plano_atualizar e planos_ativos, compartilhada pelos dois executores (Claude e Codex).

export const PLAN_CREATE_DESCRIPTION =
  "Grava o plano de um pedido do dono com VÁRIAS etapas (ex.: criar grupo, mandar o link, dar boas-vindas quando alguém entrar, ler um arquivo). Use quando o dono descrever uma sequência; escreva as etapas com as palavras dele, sem inventar etapas. Devolve o número do plano: passe-o em `plano` ao pedir a criação de grupo (grupo_criar) para a etapa seguinte retomar sozinha depois do OK. Pedido de uma etapa só não precisa de plano.";

export const PLAN_UPDATE_DESCRIPTION =
  "Atualiza um plano de etapas: aprovação de grupo, entrada/arquivo no grupo ou horário ISO futuro (até sete dias). Para conversar e continuar com um contato, agendar reunião ou esperar mensagem de grupo use missao_criar; controle essas missões por missao_controlar. Cancelar impede etapas futuras sem desfazer efeitos realizados.";

export async function runPlanCreate(db: Db, args: { titulo: string; pedido?: string; etapas: string[] }, taskId?: number): Promise<string> {
  const id = await createPlan(db, { title: args.titulo, request: args.pedido ?? "", steps: args.etapas, taskId: taskId ?? null });
  return `Plano #${id} gravado com ${args.etapas.length} etapa(s). Para o OK da criação de grupo retomar o plano sozinho, passe plano=${id} em grupo_criar.`;
}

export interface PlanUpdateArgs {
  plano: number;
  etapas_concluidas?: number[];
  esperar?: { tipo: "entrada_no_grupo" | "arquivo_no_grupo"; grupo: string; numero?: string } | { tipo: "horario"; instante: string };
  limpar_espera?: boolean;
  nota?: string;
  concluir?: boolean;
  cancelar?: boolean;
}

export async function runPlanUpdate(db: Db, args: PlanUpdateArgs): Promise<{ ok: boolean; text: string }> {
  const patch: PlanPatch = { doneSteps: args.etapas_concluidas, note: args.nota };
  if (args.cancelar) patch.status = "cancelled";
  else if (args.concluir) patch.status = "done";
  if (args.esperar) {
    if (args.esperar.tipo === "horario") {
      const at = new Date(args.esperar.instante);
      if (!Number.isFinite(at.getTime()) || at <= new Date() || at.getTime() > Date.now() + 7 * 24 * 3600_000) return { ok: false, text: "Não atualizei: informe um horário ISO futuro, dentro dos próximos sete dias." };
      patch.waiting = { type: "time", at: at.toISOString() };
    } else {
      const group = await resolveGroup(args.esperar.grupo);
      if (!group.ok) return { ok: false, text: `Não atualizei: ${group.error}.` };
      const number = args.esperar.numero?.replace(/\D/g, "");
      if (number && (number.length < 12 || number.length > 13)) return { ok: false, text: "Não atualizei: número inválido (use DDI+DDD+número)." };
      const waiting: Waiting = { type: args.esperar.tipo === "arquivo_no_grupo" ? "file_received" : "member_joined", jid: group.group.jid, ...(number ? { number } : {}) };
      patch.waiting = waiting;
    }
  } else if (args.limpar_espera) {
    patch.waiting = null;
  }
  const result = await updatePlan(db, args.plano, patch);
  if (!result.ok) return { ok: false, text: `Não atualizei: ${result.error}.` };
  const plan = result.plan;
  const state = plan.status === "active" ? `Espera: ${describeWaiting(plan.waiting)}.` : plan.status === "done" ? "Plano concluído." : "Plano cancelado.";
  return { ok: true, text: `Plano #${plan.id} "${plan.title}" atualizado.\n${formatSteps(plan.steps)}\n${state}` };
}

export async function runPlansList(db: Db): Promise<string> {
  const plans = await activePlans(db);
  if (plans.length === 0) return "Nenhum plano ativo.";
  return plans.map((p) => `Plano #${p.id} "${p.title}" (desde ${p.created_at.slice(0, 16).replace("T", " ")} UTC)\n${formatSteps(p.steps)}\nEspera: ${describeWaiting(p.waiting)}.`).join("\n\n");
}
