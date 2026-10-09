import { recentMessages, type Db } from "./store.ts";

// Contexto da conversa: o agente não guarda o histórico entre pedidos, então enviamos junto com o pedido
// as mensagens recentes do dono e da Maia (últimos 30 minutos). Mensagens de terceiros nunca entram aqui.
const WINDOW_MS = 30 * 60 * 1000;
const MAX_LINES = 8;

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
    .map((r) => `${r.author === "owner" ? "Dono" : "Maia"}: ${r.text.trim().slice(0, 400)}`);
  return picked.join("\n");
}

export async function conversationContext(db: Db, current: string): Promise<string> {
  const rows = await recentMessages(db, 30);
  return pickContext(rows, current);
}
