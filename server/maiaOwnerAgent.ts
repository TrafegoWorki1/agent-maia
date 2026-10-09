import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { sendOwnerText } from "./evolutionSend.ts";
import { createImageServer, IMAGE_TOOL, KNOWLEDGE_TOOL } from "./maiaImageTool.ts";
import { agreement, recordJev, triageText, type JevResult } from "./jev.ts";
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
// aprovador (EVOLUTION_APPROVER_NUMBER) chega a resolveApprovalFromText (roteamento em webhookServer.ts).
// A Maia usa as conexões MCP desta conta (Gmail, Meta Ads, Drive/Sheets). Leituras rodam direto;
// qualquer escrita espera um SIM ou NÃO do aprovador, válido só para aquela chamada.
// Cada pedido vira uma tarefa (tabela tasks) com os eventos da execução (tabela task_events).

const READ_TOOL = /^mcp__claude_ai_[A-Za-z_]+__(get|list|search|read|download|suggest|ads_get|ads_insights|ads_library|ads_experiment_(list|get|check)|ads_account_get)/;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PREVIEW = 300;

interface PendingApproval {
  toolName: string;
  resolve: (approved: boolean) => void;
}

let pending: PendingApproval | null = null;
let queue: Promise<void> = Promise.resolve();

export function isReadTool(toolName: string): boolean {
  return READ_TOOL.test(toolName);
}

// Resposta "sim"/"não" do dono para a aprovação pendente. Retorna true se consumiu a mensagem.
export function resolveApprovalFromText(text: string): boolean {
  if (!pending) return false;
  const answer = text.trim().toLowerCase();
  if (answer !== "sim" && answer !== "não" && answer !== "nao") return false;
  const current = pending;
  pending = null;
  current.resolve(answer === "sim");
  return true;
}

function preview(input: Record<string, unknown>): string {
  const raw = JSON.stringify(input);
  return raw.length > MAX_PREVIEW ? `${raw.slice(0, MAX_PREVIEW)}…` : raw;
}

// Falha de registro não pode derrubar a Maia: o erro vai para o log e a conversa segue.
function record(promise: PromiseLike<unknown>): void {
  void Promise.resolve(promise).catch((error) => console.error("[maia] falha ao gravar:", error instanceof Error ? error.message : error));
}

// Permissão do WhatsApp: leitura direta; escrita espera SIM/NÃO do aprovador. Cada evento vai para a tarefa.
function makeWhatsAppPermission(taskId: number): CanUseTool {
  return async (toolName, input) => {
    if (isReadTool(toolName) || toolName === IMAGE_TOOL || toolName === KNOWLEDGE_TOOL) return { behavior: "allow", updatedInput: input };
    const db = getDb();
    if (pending) {
      await addTaskEvent(db, taskId, "access_denied", toolName, "outra aprovação já pendente");
      return { behavior: "deny", message: "Já existe outra ação aguardando aprovação do dono." };
    }

    const approver = process.env.EVOLUTION_APPROVER_NUMBER!;
    const approvalId = await startApproval(db, toolName);
    await setTaskStatus(db, taskId, "aguardando_aprovacao");
    await addTaskEvent(db, taskId, "approval_requested", toolName, null);
    const approved = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (pending?.toolName === toolName) pending = null;
        record(resolveApproval(db, approvalId, "expired"));
        record(addTaskEvent(db, taskId, "approval_expired", toolName, null));
        record(setTaskStatus(db, taskId, "em_andamento"));
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      pending = {
        toolName,
        resolve: (answer) => {
          clearTimeout(timer);
          record(resolveApproval(db, approvalId, answer ? "approved" : "denied"));
          record(addTaskEvent(db, taskId, answer ? "approval_approved" : "approval_denied", toolName, null));
          record(setTaskStatus(db, taskId, "em_andamento"));
          resolve(answer);
        },
      };
      const request = `Pedido de ação de escrita:\n${toolName}\n${preview(input)}\n\nResponda SIM para aprovar só esta ação ou NÃO para recusar. Sem resposta em 10 minutos, é recusada.`;
      record(recordMessage(db, { channel: "whatsapp", author: "maia", text: request }));
      sendOwnerText(approver, request).catch((error) => console.error("[maia] falha ao pedir aprovação:", error instanceof Error ? error.message : error));
    });

    return approved
      ? { behavior: "allow", updatedInput: input }
      : { behavior: "deny", message: "Ação recusada ou sem aprovação do dono." };
  };
}

const systemPrompt = [
  "Você é a Maia, assistente operacional do Herickson Maia, que é o único que fala com você.",
  "Responda em português, de forma objetiva, pelo WhatsApp.",
  "Use as ferramentas de Gmail, Meta Ads e Google Drive/Sheets quando precisar de dados reais.",
  "Para ações de escrita (enviar, editar, mudar orçamento, alterar planilha), descreva o que vai fazer; o sistema pede aprovação ao dono antes de executar.",
  "Nunca invente dados: se uma consulta falhar, diga que falhou.",
  "Não exponha dados pessoais de terceiros além do necessário para a resposta.",
  "Você cria artes com a ferramenta gerar_imagem (formatos feed, story ou quadrado) quando o dono pedir. Se o briefing estiver incompleto, pergunte antes de criar.",
  "Para regras, decisões e histórico do projeto, use buscar_conhecimento e diga de qual documento veio a informação. Para números atuais, use os conectores.",
].join(" ");

// Conversa do painel: só leitura. Escrita é feita pelo WhatsApp, onde passa pela aprovação do aprovador.
function makePanelPermission(taskId: number): CanUseTool {
  return async (toolName, input) => {
    if (isReadTool(toolName) || toolName === IMAGE_TOOL || toolName === KNOWLEDGE_TOOL) return { behavior: "allow", updatedInput: input };
    await addTaskEvent(getDb(), taskId, "access_denied", toolName, "escrita pelo painel não permitida");
    return { behavior: "deny", message: "Ações de escrita são feitas pelo WhatsApp, com aprovação do aprovador." };
  };
}

// Executa a Maia para uma tarefa. Registra o uso de ferramentas e devolve a resposta.
async function runAgent(text: string, taskId: number, permission: CanUseTool, channel: "whatsapp" | "painel"): Promise<string> {
  const db = getDb();
  const runId = await startRun(db, "chat");
  let costUsd: number | null = null;
  try {
    const run = query({
      prompt: text,
      options: {
        systemPrompt,
        maxTurns: 12,
        maxBudgetUsd: 1,
        persistSession: false,
        canUseTool: permission,
        // Ferramenta de arte (Codex, em processo separado). Só o dono chega aqui.
        mcpServers: { maia: createImageServer(channel) },
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
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? null;
        if (message.is_error || message.subtype !== "success") throw new Error(`Agent SDK falhou (${message.subtype})`);
        const reply = message.result.trim() || "Não consegui gerar uma resposta.";
        await finishRun(db, runId, "ok", costUsd, null);
        return reply;
      }
    }
    throw new Error("Agent SDK encerrou sem resultado");
  } catch (error) {
    await finishRun(db, runId, "error", costUsd, error instanceof Error ? error.message : String(error)).catch(() => {});
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
  if (name === KNOWLEDGE_TOOL || isReadTool(name)) return "consulta";
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
