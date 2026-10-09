import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { sendOwnerText } from "./evolutionSend.ts";
import { createImageServer, IMAGE_TOOL, isLocalSafeTool, KNOWLEDGE_TOOL } from "./maiaImageTool.ts";
import { agreement, recordJev, triageText, type JevResult } from "./jev.ts";
import { approverNumbers, createApproval, openApprovals, waitApproval } from "./approvals.ts";
import { buildSystemPrompt } from "./rules.ts";
import { requiresApproval } from "./approvalPolicy.ts";
import { conversationContext } from "./context.ts";
import { loadRoutingConfig } from "./ai/config.ts";
import { classifyByRules } from "./ai/rulesClassifier.ts";
import { route } from "./ai/router.ts";
import { isRoutable, loadHealth, recordProviderEvent } from "./ai/providerHealth.ts";
import { classifyError } from "./ai/errorClassifier.ts";
import { decideFallback, effectFromTools } from "./ai/fallback.ts";
import { annotateRun } from "./ai/usageTracker.ts";
import { budgetFor, claudeModelFor } from "./ai/providers/claude.ts";
import { buildCodexPrompt, runCodexText } from "./ai/providers/codex.ts";
import type { RoutingConfig } from "./ai/types.ts";
import {
  addTaskEvent,
  createTask,
  failTask,
  finishRun,
  getDb,
  markTaskKind,
  markTaskReplied,
  recordMessage,
  resolveApproval,
  setTaskStatus,
  startApproval,
  startRun,
  toolsUsed,
  type Db,
} from "./store.ts";

// Só o número da conversa (EVOLUTION_OWNER_NUMBER) chega a handleOwnerMessage, e só o número
// aprovador (EVOLUTION_APPROVER_NUMBER) chega a decideFromText (approvals.ts), pelo roteamento do webhook ou do worker.
// A Maia usa as conexões MCP desta conta (Gmail, Meta Ads, Drive/Sheets). Leituras rodam direto;
// qualquer escrita espera um SIM ou NÃO do aprovador, válido só para aquela chamada.
// Cada pedido vira uma tarefa (tabela tasks) com os eventos da execução (tabela task_events).

const READ_TOOL = /^mcp__claude_ai_[A-Za-z_]+__(get|list|search|read|download|suggest|ads_get|ads_insights|ads_library|ads_experiment_(list|get|check)|ads_account_get)/;
const MAX_PREVIEW = 300;

let queue: Promise<void> = Promise.resolve();

export function isReadTool(toolName: string): boolean {
  return READ_TOOL.test(toolName);
}

function preview(input: Record<string, unknown>): string {
  const raw = JSON.stringify(input);
  return raw.length > MAX_PREVIEW ? `${raw.slice(0, MAX_PREVIEW)}…` : raw;
}

// Permissão do WhatsApp: leitura direta; escrita espera SIM <número> ou NÃO <número> do aprovador.
// O pedido fica no banco, com prazo: a resposta pode chegar por outro processo.
function makeWhatsAppPermission(taskId: number, requester?: string): CanUseTool {
  return async (toolName, input) => {
    if (isReadTool(toolName) || isLocalSafeTool(toolName)) return { behavior: "allow", updatedInput: input };
    // Só publicar, enviar mensagem e subir anúncio pedem aprovação. O resto roda direto, registrado na tarefa.
    if (!requiresApproval(toolName)) return { behavior: "allow", updatedInput: input };
    const db = getDb();
    if ((await openApprovals(db)).some((r) => r.kind === "ferramenta")) {
      await addTaskEvent(db, taskId, "access_denied", toolName, "outra aprovação já pendente");
      return { behavior: "deny", message: "Já existe outra ação aguardando aprovação do dono." };
    }

    const approval = await createApproval(db, { kind: "ferramenta", toolName, summary: preview(input), taskId });
    await setTaskStatus(db, taskId, "aguardando_aprovacao");
    await addTaskEvent(db, taskId, "approval_requested", toolName, null);
    const request = `Pedido de ação de escrita (#${approval.id})${requester ? ` feito por ${requester} no grupo` : ""}:
${toolName}
${preview(input)}

Responda OK para aprovar só esta ação ou NÃO para recusar. Sem resposta em 10 minutos, é recusada.`;
    await recordMessage(db, { channel: "whatsapp", author: "maia", text: request });
    for (const to of await approverNumbers(db)) {
      sendOwnerText(to, request).catch((error) => console.error("[maia] falha ao pedir aprovação:", error instanceof Error ? error.message : error));
    }

    const outcome = await waitApproval(db, approval.id, approval.expiresAt);
    await setTaskStatus(db, taskId, "em_andamento");
    const eventType = outcome === "approved" ? "approval_approved" : outcome === "denied" ? "approval_denied" : "approval_expired";
    await addTaskEvent(db, taskId, eventType, toolName, null);
    return outcome === "approved"
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Ação recusada ou sem aprovação do dono." };
  };
}


// Conversa do painel: só leitura. Escrita é feita pelo WhatsApp, onde passa pela aprovação do aprovador.
function makePanelPermission(taskId: number): CanUseTool {
  return async (toolName, input) => {
    if (isReadTool(toolName) || isLocalSafeTool(toolName)) return { behavior: "allow", updatedInput: input };
    await addTaskEvent(getDb(), taskId, "access_denied", toolName, "escrita pelo painel não permitida");
    return { behavior: "deny", message: "Ações de escrita são feitas pelo WhatsApp, com aprovação do aprovador." };
  };
}

interface ClaudeRun {
  reply: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

// Uma execução no Claude. Registra o uso de ferramentas e devolve a resposta. Erros sobem com o texto do SDK,
// para o classificador separar limite de uso de erro de tarefa.
async function runClaudeOnce(
  text: string,
  taskId: number,
  permission: CanUseTool,
  channel: "whatsapp" | "painel",
  opts: { model: string | undefined; maxBudgetUsd: number; timeoutMs: number },
): Promise<ClaudeRun> {
  const db = getDb();
  // Contexto recente: o agente não guarda o histórico entre pedidos.
  const history = await conversationContext(db, text);
  const prompt = history ? `Conversa recente (para entender o pedido atual, não repita):\n${history}\n\nPedido atual:\n${text}` : text;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const run = query({
      prompt,
      options: {
        systemPrompt: await buildSystemPrompt(db),
        ...(opts.model ? { model: opts.model } : {}),
        abortController: controller,
        maxTurns: 12,
        maxBudgetUsd: opts.maxBudgetUsd,
        persistSession: false,
        canUseTool: permission,
        // Ferramenta de arte (Codex, em processo separado). Só o dono chega aqui.
        mcpServers: { maia: createImageServer(channel, taskId) },
        // Só os conectores do claude.ai: sem configurações locais, sem servidores MCP do computador.
        settingSources: [],
        disallowedTools: ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "NotebookEdit"],
        cwd: process.cwd(),
        env: { ...process.env },
      },
    });
    let usedTool = false;
    for await (const message of run) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type !== "tool_use") continue;
          if (!usedTool) {
            usedTool = true;
            await markTaskKind(db, taskId, "operacional");
          }
          await addTaskEvent(db, taskId, "tool_use", block.name, null);
        }
      }
      if (message.type === "result") {
        const info = message as { total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number }; result?: string };
        if (message.is_error || message.subtype !== "success") {
          const detail = typeof info.result === "string" && info.result ? `: ${info.result.slice(0, 300)}` : "";
          throw new Error(`Agent SDK falhou (${message.subtype})${detail}`);
        }
        return {
          reply: message.result.trim() || "Não consegui gerar uma resposta.",
          costUsd: info.total_cost_usd ?? null,
          tokensIn: info.usage?.input_tokens ?? null,
          tokensOut: info.usage?.output_tokens ?? null,
        };
      }
    }
    throw new Error("Agent SDK encerrou sem resultado");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("tempo esgotado no Claude");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Resposta de texto pelo Codex. Só para tarefas compatíveis, sem ferramentas e sem efeito externo.
async function runCodexReply(text: string, db: Db, cfg: RoutingConfig): Promise<{ text: string; durationMs: number }> {
  const prompt = buildCodexPrompt({ rules: await buildSystemPrompt(db), context: await conversationContext(db, text), request: text });
  const result = await runCodexText({ prompt, timeoutMs: cfg.timeoutMs.codex, model: cfg.providers.codex.model });
  if (!result.ok) {
    const err = classifyError(result.error);
    await recordProviderEvent(db, "codex", { type: "failure", kind: err.kind, retryAfterMs: err.retryAfterMs, message: err.message }, cfg.health);
    throw new Error(result.error);
  }
  await recordProviderEvent(db, "codex", { type: "success" }, cfg.health);
  return { text: result.text, durationMs: result.durationMs };
}

// Executa a Maia para uma tarefa: classifica, roteia, executa no provedor escolhido e, se for seguro,
// tenta o outro provedor. Registra provedor, modelo, duração e motivo de cada execução.
async function runAgent(text: string, taskId: number, permission: CanUseTool, channel: "whatsapp" | "painel"): Promise<string> {
  const db = getDb();
  const cfg = loadRoutingConfig();
  const classification = classifyByRules(text);
  const [claudeHealth, codexHealth] = await Promise.all([loadHealth(db, "claude"), loadHealth(db, "codex")]);
  const decision = route({ classification, claude: claudeHealth, codex: codexHealth, cfg, now: Date.now() });
  const runId = await startRun(db, "chat");
  const t0 = Date.now();
  const base = { categoria: classification.category, complexidade: classification.complexity, tokensIn: null, tokensOut: null, fallbackDe: null, erroClasse: null, tentativas: 1 };

  if ("blocked" in decision) {
    await finishRun(db, runId, "error", null, decision.motivo);
    await annotateRun(db, runId, { ...base, provider: "nenhum", model: null, motivo: decision.motivo, durationMs: Date.now() - t0, erroClasse: "bloqueado" });
    return decision.motivo;
  }
  // Arte direta é tratada antes, no roteador do WhatsApp. Aqui (painel), a arte segue pelo Claude, que tem a ferramenta.
  const target = decision.direct
    ? { ...decision, provider: "claude" as const, tier: "principal" as const, model: cfg.providers.claude.models.principal, direct: null }
    : decision;

  if (target.provider === "codex") {
    try {
      const out = await runCodexReply(text, db, cfg);
      await finishRun(db, runId, "ok", null, null);
      await annotateRun(db, runId, { ...base, provider: "codex", model: cfg.providers.codex.model, motivo: target.motivo, durationMs: out.durationMs, fallbackDe: "claude" });
      return out.text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun(db, runId, "error", null, message).catch(() => {});
      await annotateRun(db, runId, { ...base, provider: "codex", model: cfg.providers.codex.model, motivo: target.motivo, durationMs: Date.now() - t0, fallbackDe: "claude", erroClasse: classifyError(message).kind });
      throw error;
    }
  }

  try {
    const out = await runClaudeOnce(text, taskId, permission, channel, { model: claudeModelFor(target), maxBudgetUsd: budgetFor(target.category, cfg), timeoutMs: cfg.timeoutMs.claude });
    await recordProviderEvent(db, "claude", { type: "success" }, cfg.health);
    await finishRun(db, runId, "ok", out.costUsd, null);
    await annotateRun(db, runId, { ...base, provider: "claude", model: target.model, motivo: target.motivo, durationMs: Date.now() - t0, tokensIn: out.tokensIn, tokensOut: out.tokensOut });
    return out.reply;
  } catch (error) {
    const err = classifyError(error);
    await recordProviderEvent(db, "claude", { type: "failure", kind: err.kind, retryAfterMs: err.retryAfterMs, message: err.message }, cfg.health);
    const tools = await toolsUsed(db, taskId);
    const effect = effectFromTools(tools.map(toolCategory));
    const codexNow = await loadHealth(db, "codex");
    const fb = decideFallback({ fallbackAllowed: err.fallbackAllowed, errorKind: err.kind, category: target.category, effect, codexRoutable: isRoutable(codexNow, Date.now()), cfg });
    await addTaskEvent(db, taskId, fb.allowed ? "fallback_codex" : "fallback_negado", err.kind, fb.reason).catch(() => {});
    if (fb.allowed) {
      try {
        const out = await runCodexReply(text, db, cfg);
        await finishRun(db, runId, "ok", null, null);
        await annotateRun(db, runId, { ...base, provider: "codex", model: cfg.providers.codex.model, motivo: `fallback: ${fb.reason}`, durationMs: Date.now() - t0, fallbackDe: "claude", erroClasse: err.kind, tentativas: 2 });
        return out.text;
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        await finishRun(db, runId, "error", null, message).catch(() => {});
        await annotateRun(db, runId, { ...base, provider: "codex", model: cfg.providers.codex.model, motivo: `fallback falhou: ${message}`.slice(0, 280), durationMs: Date.now() - t0, fallbackDe: "claude", erroClasse: err.kind, tentativas: 2 });
        throw fallbackError;
      }
    }
    await finishRun(db, runId, "error", null, err.message).catch(() => {});
    await annotateRun(db, runId, { ...base, provider: "claude", model: target.model, motivo: `${target.motivo}; sem fallback: ${fb.reason}`.slice(0, 280), durationMs: Date.now() - t0, erroClasse: err.kind });
    throw error;
  }
}

// Jev em modo sombra: a triagem começa junto com a tarefa e é registrada depois da resposta.
// Nunca bloqueia nem altera o que a Maia responde.
type JevShadow = Promise<{ jev: JevResult | null; erro: string | null }>;

function startJevShadow(text: string): JevShadow {
  return triageText(text).then(
    (jev) => ({ jev, erro: null }),
    (error) => ({ jev: null, erro: error instanceof Error ? error.message : String(error) }),
  );
}

function toolCategory(name: string): string {
  if (name === IMAGE_TOOL) return "arte";
  if (name === KNOWLEDGE_TOOL || name.startsWith("mcp__maia__instagram_desempenho") || name === "mcp__maia__artes_recentes" || isReadTool(name)) return "consulta";
  return "escrita";
}

function recordJevShadow(db: ReturnType<typeof getDb>, taskId: number, channel: "whatsapp" | "painel", pending: JevShadow): void {
  void (async () => {
    const { jev, erro } = await pending;
    const tools = await toolsUsed(db, taskId);
    await recordJev(db, { channel, taskId, jev, erro, ferramentas: tools, concordou: agreement(jev, tools.map(toolCategory)) });
  })().catch((error) => console.error("[jev] falha ao registrar:", error instanceof Error ? error.message : error));
}

// Processa uma mensagem do dono por vez, na ordem em que chegaram.
export async function handleOwnerMessage(text: string): Promise<number> {
  const owner = process.env.EVOLUTION_OWNER_NUMBER!;
  const db = getDb();
  const taskId = await createTask(db, { channel: "whatsapp", summary: text });
  const jevPending = startJevShadow(text);
  queue = queue
    .then(async () => {
      await setTaskStatus(db, taskId, "em_andamento");
      await addTaskEvent(db, taskId, "task_started", null, null);
      const reply = await runAgent(text, taskId, makeWhatsAppPermission(taskId), "whatsapp");
      recordJevShadow(db, taskId, "whatsapp", jevPending);
      await sendOwnerText(owner, reply);
      await recordMessage(db, { channel: "whatsapp", author: "maia", text: reply });
      await markTaskReplied(db, taskId);
      await addTaskEvent(db, taskId, "replied", null, null);
      await setTaskStatus(db, taskId, "concluida");
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[maia] erro ao responder:", message);
      recordJevShadow(db, taskId, "whatsapp", jevPending);
      await failTask(db, taskId, message).catch(() => {});
      await addTaskEvent(db, taskId, "task_failed", null, message).catch(() => {});
      const fallback = "Não consegui concluir agora. Tente de novo em instantes.";
      await sendOwnerText(owner, fallback).catch(() => {});
      await recordMessage(db, { channel: "whatsapp", author: "maia", text: fallback }).catch(() => {});
    });
  await queue;
  return taskId;
}

// Pedido feito no grupo operacional. Consulta roda direto; ação que altera algo pede OK do owner no privado, com o
// nome de quem pediu. A resposta sai no grupo e sempre começa pelo nome de quem pediu.
export interface GroupRequest {
  jid: string;
  participant: string;
  name: string;
  text: string;
}

export function startWithName(name: string, reply: string): string {
  const clean = reply.trim();
  if (!name) return clean;
  return clean.toLowerCase().startsWith(name.toLowerCase()) ? clean : `${name}, ${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
}

export async function handleGroupMessage(request: GroupRequest): Promise<number> {
  const db = getDb();
  const requester = request.name || (request.participant ? `+${request.participant}` : "Alguém");
  const prompt = `[Grupo operacional Worki Digital] ${requester} escreveu: "${request.text}"
Responda no grupo, curto, começando pelo nome de quem pediu (${requester}). Consultas você faz direto. Se for ação que altera algo, a aprovação é pedida ao owner no privado, então diga que está aguardando o OK dele. Se a mensagem for um relato e não um pedido, reconheça em uma frase e pergunte o que fazer com a informação, sem inventar nada. Não revele dados pessoais de terceiros no grupo.`;
  const taskId = await createTask(db, { channel: "whatsapp", summary: `grupo: ${request.text}`.slice(0, 200) });
  queue = queue
    .then(async () => {
      await setTaskStatus(db, taskId, "em_andamento");
      await addTaskEvent(db, taskId, "task_started", null, null);
      const reply = startWithName(requester, await runAgent(prompt, taskId, makeWhatsAppPermission(taskId, requester), "whatsapp"));
      await sendOwnerText(request.jid, reply);
      await markTaskReplied(db, taskId);
      await addTaskEvent(db, taskId, "replied", null, null);
      await setTaskStatus(db, taskId, "concluida");
    })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[maia] erro no grupo:", message);
      await failTask(db, taskId, message).catch(() => {});
      await addTaskEvent(db, taskId, "task_failed", null, message).catch(() => {});
      await sendOwnerText(request.jid, `${requester}, não consegui concluir agora. Tente de novo em instantes.`).catch(() => {});
    });
  await queue;
  return taskId;
}

// Mensagem enviada pelo painel. Grava os dois lados no mesmo histórico do WhatsApp.
export async function answerFromPanel(text: string): Promise<string> {
  const db: Db = getDb();
  await recordMessage(db, { channel: "painel", author: "owner", text });
  const taskId = await createTask(db, { channel: "painel", summary: text });
  const jevPending = startJevShadow(text);
  await setTaskStatus(db, taskId, "em_andamento");
  await addTaskEvent(db, taskId, "task_started", null, null);
  try {
    const reply = await runAgent(text, taskId, makePanelPermission(taskId), "painel");
    recordJevShadow(db, taskId, "painel", jevPending);
    await recordMessage(db, { channel: "painel", author: "maia", text: reply });
    await markTaskReplied(db, taskId);
    await addTaskEvent(db, taskId, "replied", null, null);
    await setTaskStatus(db, taskId, "concluida");
    return reply;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failTask(db, taskId, message).catch(() => {});
    await addTaskEvent(db, taskId, "task_failed", null, message).catch(() => {});
    recordJevShadow(db, taskId, "painel", jevPending);
    throw error;
  }
}
