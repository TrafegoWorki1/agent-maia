export interface MaiaAgentInput {
  requesterName: string;
  groupName: string;
  request: string;
  decisionStatus: "permitido" | "aguardando_aprovacao" | "bloqueado";
  decisionExplanation: string;
}

// Chama a rota de desenvolvimento do Agent SDK. Retorna null quando indisponível,
// para que o chat local continue funcionando sem a API.
export async function askMaiaAgent(input: MaiaAgentInput): Promise<string | null> {
  try {
    const response = await fetch("/api/maia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { reply?: unknown };
    return typeof data.reply === "string" ? data.reply : null;
  } catch {
    return null;
  }
}
