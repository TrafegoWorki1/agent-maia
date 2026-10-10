// Consultas de conversas e contatos da instância Evolution, e marcar mensagem como lida. Nada aqui publica
// conteúdo nem muda quem participa de nada — é leitura e um efeito colateral de ter lido mesmo.

function evoConfig(): { url: string; instance: string; apikey: string } | null {
  const url = process.env.EVOLUTION_API_URL;
  const instance = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY;
  return url && instance && apikey ? { url, instance, apikey } : null;
}

// Marca mensagens como lidas (o "✓✓ azul" para quem mandou). Não é uma ferramenta do agente: é um efeito
// automático de quando a Maia pega uma mensagem para processar de verdade (dono, membro autorizado, grupo
// cadastrado e endereçado). Nunca marca como lida algo que ela não vai processar — seria falso para quem mandou.
// Decisão do owner (10/10/2026). Cosmético: falha aqui nunca impede a resposta (sempre use .catch(() => {})).
export async function markMessagesRead(jid: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const config = evoConfig();
  if (!config) throw new Error("Evolution não configurada no .env");
  const response = await fetch(`${config.url}/chat/markMessageAsRead/${config.instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.apikey },
    body: JSON.stringify({ readMessages: ids.map((id) => ({ remoteJid: jid, fromMe: false, id })) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Evolution respondeu HTTP ${response.status}`);
}

export interface ChatRow {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessageAt: string | null;
}

export async function findChats(limit = 20): Promise<{ ok: true; chats: ChatRow[] } | { ok: false; error: string }> {
  const config = evoConfig();
  if (!config) return { ok: false, error: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${config.url}/chat/findChats/${config.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apikey },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, error: `Evolution respondeu HTTP ${response.status}` };
    const body = (await response.json().catch(() => null)) as unknown[] | null;
    const rows = (body ?? []) as Record<string, unknown>[];
    const chats = rows
      .map((r) => {
        const jid = typeof r.id === "string" ? r.id : typeof r.remoteJid === "string" ? r.remoteJid : "";
        return {
          jid,
          name: typeof r.name === "string" ? r.name : typeof r.pushName === "string" ? r.pushName : jid.split("@")[0],
          isGroup: jid.endsWith("@g.us"),
          lastMessageAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
        };
      })
      .filter((c) => c.jid)
      .slice(0, Math.max(1, Math.min(limit, 50)));
    return { ok: true, chats };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "falha ao consultar conversas" };
  }
}

export interface ContactRow {
  number: string;
  name: string;
}

// Contatos salvos na instância (diferente da agenda da Maia): usa para achar alguém que a Maia ainda não
// tem na própria agenda, antes de dizer que não encontrou.
export async function findInstanceContacts(query: string, limit = 10): Promise<{ ok: true; contacts: ContactRow[] } | { ok: false; error: string }> {
  const config = evoConfig();
  if (!config) return { ok: false, error: "Evolution não configurada no .env" };
  try {
    const response = await fetch(`${config.url}/chat/findContacts/${config.instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.apikey },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, error: `Evolution respondeu HTTP ${response.status}` };
    const body = (await response.json().catch(() => null)) as unknown[] | null;
    const rows = (body ?? []) as Record<string, unknown>[];
    const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const q = norm(query);
    const digits = query.replace(/\D/g, "");
    const contacts = rows
      .map((r) => {
        const jid = typeof r.id === "string" ? r.id : typeof r.remoteJid === "string" ? r.remoteJid : "";
        return { jid, number: jid.split("@")[0], name: typeof r.pushName === "string" ? r.pushName : typeof r.name === "string" ? r.name : "" };
      })
      .filter((c) => c.number && !c.jid.endsWith("@g.us"))
      .filter((c) => (digits.length >= 8 && c.number.includes(digits)) || (q && norm(c.name).includes(q)))
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(({ number, name }) => ({ number, name }));
    return { ok: true, contacts };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "falha ao consultar contatos" };
  }
}
