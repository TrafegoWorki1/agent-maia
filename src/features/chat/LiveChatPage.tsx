import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader, Panel } from "../../components/ui";

// Conversa com a Maia pelo painel. Usa o mesmo histórico do WhatsApp (texto guardado localmente).
// Pelo painel a Maia só lê: pedidos de escrita são feitos pelo WhatsApp, com aprovação.

interface StoredMessage {
  id: number;
  at: string;
  channel: "whatsapp" | "painel";
  author: "owner" | "approver" | "maia";
  text: string;
}

const authorLabel: Record<StoredMessage["author"], string> = {
  owner: "Você",
  approver: "Aprovador",
  maia: "Maia",
};

const channelLabel: Record<StoredMessage["channel"], string> = {
  whatsapp: "WhatsApp",
  painel: "Painel",
};

const POLL_MS = 10_000;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function LiveChatPage() {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/conversa", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { messages: StoredMessage[] };
      setMessages(data.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar a conversa");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/conversa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error(response.status === 502 ? "A Maia não conseguiu responder agora." : `HTTP ${response.status}`);
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Conversa com Maia"
        subtitle="Mesmo histórico do WhatsApp. Pelo painel a Maia consulta, mas não executa escritas: essas passam pelo WhatsApp e pela aprovação."
      />
      <Panel title="Conversa" caption="Atualiza a cada 10 segundos.">
        <div aria-live="polite" style={{ display: "grid", gap: 10, maxHeight: 480, overflowY: "auto", paddingRight: 4 }}>
          {messages.length === 0 && <p className="empty-note">Nenhuma mensagem ainda. Escreva abaixo ou mande pelo WhatsApp.</p>}
          {messages.map((message) => (
            <article key={message.id} style={{ justifySelf: message.author === "maia" ? "start" : "end", maxWidth: "80%" }}>
              <div className="metric-helper" style={{ marginBottom: 2 }}>
                {authorLabel[message.author]} · {channelLabel[message.channel]} · {timeLabel(message.at)}
              </div>
              <div style={{ whiteSpace: "pre-wrap", padding: "8px 12px", borderRadius: 10, background: message.author === "maia" ? "#f3efe6" : "#e8f0ea" }}>
                {message.text}
              </div>
            </article>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <label htmlFor="maia-draft" className="sr-only">Mensagem para a Maia</label>
          <input
            id="maia-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Escreva para a Maia"
            maxLength={2000}
            style={{ flex: 1, padding: "8px 10px" }}
          />
          <button type="submit" className="button button-dark" disabled={sending || !draft.trim()}>
            {sending ? "Aguardando a Maia…" : "Enviar"}
          </button>
        </form>
        {error && <p role="alert" className="empty-note">{error}</p>}
      </Panel>
    </>
  );
}
