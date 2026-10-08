import { useCallback, useEffect, useState } from "react";
import { PageHeader, Panel, StatusPill } from "../../components/ui";
import { fetchSnapshot, formatMoney, formatWhen, requestRefresh, type Snapshot } from "../../lib/snapshotApi";

const POLL_MS = 30_000;
const REFRESH_POLL_MS = 5_000;

const eventLabels: Record<string, string> = {
  connection: "Conexão",
  message: "Mensagens de texto",
  poll_vote: "Votos de enquete",
  unknown: "Sem tratamento",
};

// Mesma estrutura do MetricCard do projeto. A etiqueta de status diz se a conexão está ativa.
function Card({ label, value, helper, tone = "neutral" }: { label: string; value: string; helper?: string; tone?: "neutral" | "good" | "bad" }) {
  const status = tone === "good" ? "alvo" : tone === "bad" ? "critico" : "sem_dado";
  const statusLabel = tone === "good" ? "Ativo" : tone === "bad" ? "Com erro" : "Não verificado";
  return (
    <article className={`metric-card metric-${status}`}>
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
        <StatusPill status={status} label={statusLabel} />
      </div>
      <div className="metric-value-row">
        <strong className="metric-value">{value}</strong>
      </div>
      {helper && <p className="metric-helper">{helper}</p>}
    </article>
  );
}

export function ConnectionsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Falha ao carregar o painel");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Atualiza a cada 30 segundos; enquanto uma consulta roda, acompanha a cada 5 segundos.
  const refreshing = snapshot?.refreshing ?? false;
  useEffect(() => {
    const timer = setInterval(() => void load(), refreshing ? REFRESH_POLL_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [load, refreshing]);

  async function refreshNow() {
    try {
      const started = await requestRefresh();
      setNotice(started ? "Consultando Gmail, Meta Ads e Sheets. Pode levar alguns minutos." : "Já existe uma atualização em andamento.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar");
    }
  }

  const sources = snapshot?.sources ?? {};
  const gmail = sources.gmail;
  const meta = sources.meta;
  const sheets = sources.sheets;
  const calendar = sources.calendar;
  const totalEvents = Object.values(snapshot?.events24h ?? {}).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Conexões e dados"
        subtitle="Painel local, atualizado a cada 30 segundos. Só o seu computador acessa estes dados."
        action={
          <button type="button" className="button button-outline" onClick={refreshNow} disabled={refreshing}>
            {refreshing ? "Atualizando…" : "Atualizar fontes"}
          </button>
        }
      />

      {loadError && <p role="alert" className="empty-note">Não foi possível ler o painel: {loadError}. Confirme que o `pnpm start` está rodando.</p>}
      {notice && <p role="status" className="empty-note">{notice}</p>}

      {snapshot && (
        <>
          <section className="metrics-grid" aria-label="Conexões">
            <Card
              label="WhatsApp (Evolution)"
              value={snapshot.whatsapp.state ?? "indisponível"}
              helper={snapshot.whatsapp.error ?? "Estado consultado agora"}
              tone={snapshot.whatsapp.state === "open" ? "good" : snapshot.whatsapp.error ? "bad" : "neutral"}
            />
            <Card label="Webhook" value={snapshot.webhook.host ? "recebendo" : "sem endereço"} helper={`Último evento: ${formatWhen(snapshot.webhook.lastEventAt)}`} tone={snapshot.webhook.host ? "good" : "neutral"} />
            <Card
              label="Agente da Maia"
              value={snapshot.chat ? (snapshot.chat.status === "ok" ? "respondendo" : "com erro") : "sem uso ainda"}
              helper={snapshot.chat?.error ?? `Última resposta: ${formatWhen(snapshot.chat?.started_at)}`}
              tone={snapshot.chat?.status === "error" ? "bad" : "good"}
            />
            <Card label="Aprovações pendentes" value={String(snapshot.approvals.length)} helper="Pedidos de escrita aguardando o aprovador" tone="good" />
          </section>

          <Panel title="Fontes consultadas pela Maia" caption="Leitura somente. Atualização automática a cada 30 minutos.">
            <section className="metrics-grid" aria-label="Fontes">
              <Card
                label="Gmail"
                value={gmail?.status === "ok" && gmail.data ? `${gmail.data.unread_count} não lidas` : "sem dado"}
                helper={
                  gmail?.status === "ok" && gmail.data
                    ? `${gmail.data.unread_last_24h} nas últimas 24 h · ${formatWhen(gmail.fetched_at)}`
                    : gmail?.error ?? "Ainda não consultado"
                }
                tone={gmail?.status === "error" ? "bad" : gmail?.status === "ok" ? "good" : "neutral"}
              />
              <Card
                label="Meta Ads · 7 dias"
                value={meta?.status === "ok" && meta.data ? `${meta.data.accounts.length} conta(s)` : "sem dado"}
                helper={
                  meta?.status === "ok" && meta.data
                    ? meta.data.accounts.map((a) => `${a.name}: ${formatMoney(a.spend_7d, a.currency)}`).join(" · ") || "Nenhuma conta encontrada"
                    : meta?.error ?? "Ainda não consultado"
                }
                tone={meta?.status === "error" ? "bad" : meta?.status === "ok" ? "good" : "neutral"}
              />
              <Card
                label="Google Sheets"
                value={sheets?.status === "ok" && sheets.data ? `${sheets.data.sheets.length} recente(s)` : "sem dado"}
                helper={
                  sheets?.status === "ok" && sheets.data
                    ? sheets.data.sheets.map((s) => s.name).join(" · ") || "Nenhuma planilha encontrada"
                    : sheets?.error ?? "Ainda não consultado"
                }
                tone={sheets?.status === "error" ? "bad" : sheets?.status === "ok" ? "good" : "neutral"}
              />
              <Card
                label="Google Agenda"
                value={calendar?.status === "ok" && calendar.data ? `${calendar.data.calendars.length} calendário(s)` : "sem dado"}
                helper={
                  calendar?.status === "ok" && calendar.data
                    ? calendar.data.calendars.map((c) => c.name).join(" · ") || "Nenhum calendário encontrado"
                    : calendar?.error ?? "Ainda não consultado"
                }
                tone={calendar?.status === "error" ? "bad" : calendar?.status === "ok" ? "good" : "neutral"}
              />
            </section>
          </Panel>

          <Panel title="Eventos das últimas 24 horas" caption="Contagem de eventos recebidos pelo webhook. O conteúdo das mensagens não é guardado.">
            {totalEvents === 0 ? (
              <p className="empty-note">Nenhum evento nas últimas 24 horas.</p>
            ) : (
              <ul>
                {Object.entries(snapshot.events24h).map(([kind, count]) => (
                  <li key={kind}>
                    {eventLabels[kind] ?? kind}: {count}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
