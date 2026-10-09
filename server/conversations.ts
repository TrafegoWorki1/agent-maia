import type { Db } from "./store.ts";

// Memória das conversas atendidas pela Maia: grupos cadastrados e respostas de contatos (conv = "dm:<número>").
// Guarda quem disse o quê, por 7 dias (purge_group_messages). Serve de contexto e nunca é tratada como instrução.

export interface ConvMessage {
  participant: string;
  name: string;
  text: string;
  fromMaia: boolean;
  at: string;
}

export async function recordConvMessage(
  db: Db,
  input: { conv: string; participant?: string; name?: string; text: string; fromMaia?: boolean; keyId?: string | null; at?: Date },
): Promise<void> {
  const row = {
    conv: input.conv,
    participant: input.participant ?? "",
    name: (input.name ?? "").slice(0, 60),
    text: input.text.slice(0, 2000),
    from_maia: input.fromMaia ?? false,
    key_id: input.keyId ?? null,
    at: (input.at ?? new Date()).toISOString(),
  };
  const { error } = await db.from("group_messages").insert(row);
  // Reenvio da mesma mensagem (índice único): não é erro.
  if (error && error.code !== "23505") throw new Error(`conversa: ${error.message}`);
}

export async function convMessages(db: Db, conv: string, limit = 12, sinceMs = 6 * 3600_000): Promise<ConvMessage[]> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { data, error } = await db.from("group_messages").select("participant, name, text, from_maia, at").eq("conv", conv).gte("at", since).order("at", { ascending: false }).limit(limit);
  if (error) throw new Error(`conversa: ${error.message}`);
  return (data ?? []).reverse().map((r) => ({ participant: String(r.participant), name: String(r.name), text: String(r.text), fromMaia: Boolean(r.from_maia), at: String(r.at) }));
}

// "10:05 Jéssica: texto" (hora de Brasília), uma linha por fala.
export function formatConv(messages: ConvMessage[]): string {
  return messages
    .map((m) => {
      const hour = new Date(new Date(m.at).getTime() - 3 * 3600_000).toISOString().slice(11, 16);
      const who = m.fromMaia ? "Maia" : m.name || (m.participant ? `+${m.participant}` : "Alguém");
      return `${hour} ${who}: ${m.text.replace(/\s+/g, " ").slice(0, 400)}`;
    })
    .join("\n");
}

// Falas recentes de todos os grupos e contatos, para o contexto do privado com o dono.
export async function recentConversations(db: Db, limit = 20, sinceMs = 3 * 3600_000): Promise<string> {
  const since = new Date(Date.now() - sinceMs).toISOString();
  const { data } = await db.from("group_messages").select("conv, participant, name, text, from_maia, at").gte("at", since).order("at", { ascending: false }).limit(limit);
  if (!data || data.length === 0) return "";
  const names = await groupNames(db, [...new Set(data.map((r) => String(r.conv)))]);
  const byConv = new Map<string, ConvMessage[]>();
  for (const r of [...data].reverse()) {
    const key = String(r.conv);
    byConv.set(key, [...(byConv.get(key) ?? []), { participant: String(r.participant), name: String(r.name), text: String(r.text), fromMaia: Boolean(r.from_maia), at: String(r.at) }]);
  }
  return [...byConv.entries()].map(([conv, msgs]) => `[${names.get(conv) ?? (conv.startsWith("dm:") ? `conversa privada com ${msgs.find((m) => !m.fromMaia)?.name || conv.slice(3)}` : conv)}]\n${formatConv(msgs)}`).join("\n\n");
}

async function groupNames(db: Db, convs: string[]): Promise<Map<string, string>> {
  const jids = convs.filter((c) => c.endsWith("@g.us"));
  if (jids.length === 0) return new Map();
  const { data } = await db.from("maia_groups").select("jid, name").in("jid", jids);
  return new Map((data ?? []).map((r) => [String(r.jid), `grupo ${r.name}`]));
}
