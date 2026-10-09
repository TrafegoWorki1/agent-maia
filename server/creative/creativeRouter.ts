import { sendOwnerImage } from "../evolutionSend.ts";
import { loadRoutingConfig } from "../ai/config.ts";
import { isRoutable, loadHealth, recordProviderEvent } from "../ai/providerHealth.ts";
import { classifyByRules } from "../ai/rulesClassifier.ts";
import { route } from "../ai/router.ts";
import { annotateRun } from "../ai/usageTracker.ts";
import { createImage, type ImageFormat } from "../imagegen.ts";
import { addTaskEvent, createTask, failTask, finishRun, markTaskKind, markTaskReplied, setTaskStatus, startRun, type Db } from "../store.ts";

// Pedido de arte: vai direto ao executor criativo (Codex), sem uma chamada ao Claude só para escolher a ferramenta.
// Cota diária atômica no banco. Falha que não gerou arte devolve a cota. Resultado incerto não é repetido.

export function detectFormat(text: string): ImageFormat {
  const t = text.toLowerCase();
  if (/\b(story|stories|9:16|reels)\b/.test(t)) return "story";
  if (/\b(quadrad[oa]|1:1)\b/.test(t)) return "quadrado";
  return "feed";
}

// Dia da cota no fuso de Fortaleza (UTC-3, sem horário de verão).
export function quotaDay(now = new Date()): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isDirectImageRequest(text: string): boolean {
  return classifyByRules(text).category === "imagem";
}

export interface CreativeDeps {
  db: Db;
  notifyOwner: (text: string) => Promise<void>;
}

// Retorna o número da tarefa criada, ou null quando o pedido foi barrado antes (briefing curto, cota, indisponível).
export async function handleDirectImage(deps: CreativeDeps, text: string): Promise<number | null> {
  const { db, notifyOwner } = deps;
  const cfg = loadRoutingConfig();
  const classification = classifyByRules(text);
  const [claude, codex] = await Promise.all([loadHealth(db, "claude"), loadHealth(db, "codex")]);
  const decision = route({ classification, claude, codex, cfg, now: Date.now() });
  if ("blocked" in decision) {
    await notifyOwner(decision.motivo);
    return null;
  }
  if (!decision.direct || !isRoutable(codex, Date.now())) {
    await notifyOwner("O criador de artes está indisponível agora.");
    return null;
  }
  if (text.trim().length < 25) {
    await notifyOwner("Para criar a arte, me diga o objetivo, o texto que deve aparecer e o formato (feed, story ou quadrado).");
    return null;
  }

  const day = quotaDay();
  const claimed = await db.rpc("claim_image_quota", { p_dia: day, p_limit: cfg.images.dailyLimit });
  if (claimed.error) throw new Error(`cota de imagens: ${claimed.error.message}`);
  if (claimed.data !== true) {
    await notifyOwner(`O limite de ${cfg.images.dailyLimit} artes por dia foi atingido. Posso criar de novo amanhã.`);
    return null;
  }

  const taskId = await createTask(db, { channel: "whatsapp", summary: text });
  await markTaskKind(db, taskId, "operacional");
  await setTaskStatus(db, taskId, "em_andamento");
  await addTaskEvent(db, taskId, "task_started", null, null);
  const runId = await startRun(db, "imagem");
  const t0 = Date.now();
  const format = detectFormat(text);
  const metrics = { provider: "codex", model: cfg.providers.codex.model, categoria: "imagem", complexidade: classification.complexity, motivo: decision.motivo, tokensIn: null, tokensOut: null, fallbackDe: null, tentativas: 1 };

  const result = await createImage({ briefing: text, format, refs: [] });
  if (!result.ok) {
    // Só devolve a cota se nada foi gerado com certeza. Resultado incerto (tempo esgotado) mantém a cota e não repete.
    if (!result.uncertain) await db.rpc("release_image_quota", { p_dia: day });
    await recordProviderEvent(db, "codex", { type: "failure", kind: result.uncertain ? "timeout" : "unknown", retryAfterMs: null, message: result.error }, cfg.health);
    await finishRun(db, runId, "error", null, result.error);
    await annotateRun(db, runId, { ...metrics, durationMs: Date.now() - t0, erroClasse: result.uncertain ? "timeout" : "execucao" });
    await failTask(db, taskId, result.error);
    await addTaskEvent(db, taskId, "task_failed", "gerar_imagem", result.error);
    await notifyOwner(`Não consegui criar a arte: ${result.error}${result.uncertain ? " Não repeti sozinho: confira antes de pedir de novo." : ""}`);
    return taskId;
  }

  await recordProviderEvent(db, "codex", { type: "success" }, cfg.health);
  try {
    const owner = process.env.EVOLUTION_OWNER_NUMBER ?? "";
    const messageId = await sendOwnerImage(owner, result.path, `Arte ${format}`);
    await addTaskEvent(db, taskId, "external_done", "enviar_arte", null);
    // Conferência: o WhatsApp devolveu o id da mensagem. Sem id, a entrega fica sem conferência.
    if (messageId) await addTaskEvent(db, taskId, "task_verified", "enviar_arte", `mensagem ${messageId}`);
    await markTaskReplied(db, taskId);
    await setTaskStatus(db, taskId, "concluida");
    await finishRun(db, runId, "ok", null, null);
    await annotateRun(db, runId, { ...metrics, durationMs: Date.now() - t0, erroClasse: null });
  } catch (error) {
    // A arte existe, mas o envio falhou: não conta como entregue.
    const message = error instanceof Error ? error.message : String(error);
    await failTask(db, taskId, `arte criada, envio falhou: ${message}`);
    await finishRun(db, runId, "error", null, message);
    await annotateRun(db, runId, { ...metrics, durationMs: Date.now() - t0, erroClasse: "entrega" });
    await notifyOwner(`A arte foi criada, mas não consegui enviar pelo WhatsApp: ${message}`);
  }
  return taskId;
}
