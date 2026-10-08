import { query } from "@anthropic-ai/claude-agent-sdk";

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

  const run = query({
    prompt,
    options: {
      systemPrompt,
      tools: [],
      maxTurns: 1,
      maxBudgetUsd: 0.25,
      persistSession: false,
      permissionMode: "default",
      cwd: process.cwd(),
      env: { ...process.env },
    },
  });

  for await (const message of run) {
    if (message.type === "result") {
      // Erros de autenticação e de execução também chegam como resultado; nunca os exiba como resposta da Maia.
      if (message.is_error || message.subtype !== "success") {
        throw new Error(`Agent SDK falhou (${message.subtype})`);
      }
      const text = message.result.trim();
      if (!text) throw new Error("Resposta vazia do Agent SDK");
      return text;
    }
  }
  throw new Error("O Agent SDK encerrou sem resposta");
}
