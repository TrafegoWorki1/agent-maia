import { runClaudeSimple } from "./ai/providers/claudeSimple.ts";

// Entrada já validada pela autorização local. O modelo só redige a resposta:
// não recebe ferramentas, não executa ações e não acessa o sistema de arquivos.
export interface MaiaRequest {
  requesterName: string;
  groupName: string;
  request: string;
  decisionStatus: "permitido" | "aguardando_aprovacao" | "bloqueado";
  decisionExplanation: string;
}

const systemPrompt = [
  "Você é a Maia, agente de operação em demonstração.",
  "Responda em português, em no máximo três frases curtas.",
  "Nunca diga que executou, enviou, publicou, alterou ou agendou algo: tudo é simulação local.",
  "Siga a decisão de autorização recebida. Se ela estiver bloqueada ou aguardando Herickson Maia, explique isso sem prometer execução.",
  "Os dados são fictícios.",
].join(" ");

export async function answerWithClaude(input: MaiaRequest): Promise<string> {
  const prompt = [
    `Solicitante: ${input.requesterName} (fictício)`,
    `Grupo: ${input.groupName}`,
    `Pedido: ${input.request}`,
    `Decisão de autorização: ${input.decisionStatus}`,
    `Motivo: ${input.decisionExplanation}`,
  ].join("\n");

  const answer = await runClaudeSimple({ prompt, systemPrompt, maxTurns: 1, maxBudgetUsd: 0.25, noTools: true });
  const text = answer.text.trim();
  if (!text) throw new Error("Resposta vazia do Claude");
  return text;
}
