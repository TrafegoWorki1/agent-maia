import { recentMessages, type Db } from "./store.ts";

// Contexto da conversa: o agente não guarda o histórico entre pedidos, então enviamos junto com o pedido
// as mensagens recentes do dono e da Maia. Mensagens de terceiros nunca entram aqui.
// Decisão do owner (10/10/2026): limites antigos (30 min, 8 linhas, 400 caracteres por linha) cortavam a
// própria resposta da Maia no meio — um "Ok"/"Aprovado" do dono confirmava um rascunho que ela não via mais
// inteiro. Autodiagnóstico da própria Maia (sem acesso de escrita), aplicado aqui.
const WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_LINES = 14;
const MAX_CHARS_PER_LINE = 4000;

export interface ContextRow {
  at: string;
  author: string;
  text: string;
}

// Função pura: escolhe as linhas de contexto. Não inclui o que já faz parte do pedido atual.
export function pickContext(rows: ContextRow[], current: string, now = Date.now()): string {
  const cur = current.trim();
  const picked = rows
    .filter((r) => (r.author === "owner" || r.author === "maia") && now - Date.parse(r.at) <= WINDOW_MS)
    .filter((r) => !cur.includes(r.text.trim()))
    .slice(-MAX_LINES)
    .map((r) => `${r.author === "owner" ? "Dono" : "Maia"}: ${r.text.trim().slice(0, MAX_CHARS_PER_LINE)}`);
  return picked.join("\n");
}

export async function conversationContext(db: Db, current: string): Promise<string> {
  // 60, não 30: com a janela maior (2h) e mais linhas (14), 30 linhas cruas podia não bastar pra
  // preencher as 14 depois de filtrar por autor/janela, numa conversa com bastante troca de mensagem.
  const rows = await recentMessages(db, 60);
  return pickContext(rows, current);
}
