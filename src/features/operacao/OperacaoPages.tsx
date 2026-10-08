import type { ReactNode } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { MANUAL_SECTIONS } from "../../data/manual";
import { formatMoney, formatWhen, type Snapshot } from "../../lib/snapshotApi";
import { useSnapshot } from "../../lib/useSnapshot";

// Páginas com dados reais da operação. Todas leem o mesmo snapshot do servidor local.
// Sem amostra ou sem fonte, o valor é "sem dado": nunca um número de demonstração.

const DIMENSION_LABELS: Record<string, string> = {
  velocidade: "Velocidade",
  precisaoConferencia: "Precisão e conferência",
  proatividade: "Proatividade",
  gestaoRisco: "Gestão de risco",
  confiabilidadeTecnica: "Confiabilidade técnica",
  comunicacao: "Comunicação",
};

const STATUS_LABELS: Record<string, string> = {
  recebida: "Recebida",
  em_andamento: "Em andamento",
  aguardando_aprovacao: "Aguardando aprovação",
  concluida: "Concluída",
  falhou: "Com erro",
  incerta: "Incerta",
};

const INCIDENT_LABELS: Record<string, string> = {
  falhou: "Tarefa com erro",
  incerta: "Tarefa interrompida",
  access_denied: "Bloqueio de escrita",
  approval_denied: "Aprovação recusada",
  approval_expired: "Aprovação expirou",
  APPROVAL_MISSING: "Escrita sem aprovação",
};

function Kpi({ label, value, helper, status }: { label: string; value: string; helper?: string; status?: "alvo" | "atencao" | "critico" | "sem_dado" }) {
  const tone = status ?? "sem_dado";
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-topline">
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value-row">
        <strong className="metric-value">{value}</strong>
      </div>
      {helper && <p className="metric-helper">{helper}</p>}
    </article>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="empty-note">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loading({ error, snapshot, children }: { error: string | null; snapshot: Snapshot | null; children: (s: Snapshot) => ReactNode }) {
  if (!snapshot) {
    return <p className="empty-note">{error ? `Não foi possível ler o painel: ${error}. Confirme que a Maia está rodando.` : "Carregando…"}</p>;
  }
  return <>{children(snapshot)}</>;
}

function scoreText(value: number | null): string {
  return value === null ? "sem amostra" : value.toFixed(1);
}

export function ResumoPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Resumo" subtitle="Tarefas de hoje, nota da semana e o que pede atenção." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const today = s.tasks.today;
          const q = s.quality.current;
          return (
            <>
              <section className="metrics-grid" aria-label="Números-chave">
                <Kpi label="Tarefas hoje" value={String(today.total)} helper="Pedidos operacionais" status={today.total ? "alvo" : "sem_dado"} />
                <Kpi label="Em andamento" value={String(today.byStatus.em_andamento ?? 0)} status={today.byStatus.em_andamento ? "atencao" : "sem_dado"} />
                <Kpi label="Concluídas" value={String(today.byStatus.concluida ?? 0)} status={today.byStatus.concluida ? "alvo" : "sem_dado"} />
                <Kpi label="Com erro" value={String((today.byStatus.falhou ?? 0) + (today.byStatus.incerta ?? 0))} status={(today.byStatus.falhou ?? 0) + (today.byStatus.incerta ?? 0) ? "critico" : "alvo"} helper="Com erro ou incertas" />
                <Kpi label="Aguardando aprovação" value={String(s.approvals.length)} status={s.approvals.length ? "atencao" : "alvo"} />
              </section>

              <Panel title="Qualidade operacional" caption={`Semana ${q.week}. Mesmos pesos e regras do Bryan. Sem amostra mínima, não há nota.`}>
                <section className="metrics-grid" aria-label="Nota da semana">
                  <Kpi
                    label="Nota da semana"
                    value={q.overall !== null ? `${q.overall.toFixed(1)} / 10` : "dados insuficientes"}
                    helper={`Semana anterior: ${s.quality.previous.overall !== null ? `${s.quality.previous.overall.toFixed(1)} / 10` : "sem nota"}`}
                    status={q.overall === null ? "sem_dado" : q.overall >= 7 ? "alvo" : "atencao"}
                  />
                  <Kpi label="Teto por incidente" value={`${q.criticalCap} / 10`} helper={q.incidents.length ? `${q.incidents.length} incidente(s) crítico(s)` : "Nenhum incidente crítico"} status={q.incidents.length ? "critico" : "alvo"} />
                  <Kpi label="Respondidas" value={`${q.counts.replied} de ${q.counts.tasks}`} helper="Tarefas operacionais da semana" />
                </section>
                <Table
                  head={["Dimensão", "Peso", "Nota"]}
                  rows={Object.keys(DIMENSION_LABELS).map((key) => [
                    DIMENSION_LABELS[key],
                    `${Math.round((q.weights[key] ?? 0) * 100)}%`,
                    scoreText(q.dimensions[key as keyof typeof q.dimensions]),
                  ])}
                  empty="Sem dimensões."
                />
              </Panel>

              <Panel title="Tarefas recentes" caption="Texto limitado a 40 caracteres. A conversa completa fica em Conversa com Maia.">
                <Table
                  head={["Quando", "Canal", "Pedido", "Tipo", "Situação", "Respondida"]}
                  rows={s.tasks.recent.map((t) => [
                    formatWhen(t.created_at),
                    t.channel === "painel" ? "Painel" : "WhatsApp",
                    t.summary.slice(0, 40),
                    t.kind === "operacional" ? "Operacional" : "Conversa",
                    STATUS_LABELS[t.status] ?? t.status,
                    t.replied_at ? formatWhen(t.replied_at) : "—",
                  ])}
                  empty="Nenhuma tarefa ainda. Quando você pedir algo à Maia, ela aparece aqui."
                />
              </Panel>
            </>
          );
        }}
      </Loading>
    </>
  );
}

export function IndicadoresPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Indicadores" subtitle="Só indicadores com fonte real. Sem fonte, aparece 'sem dado'." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const gmail = s.sources.gmail;
          const meta = s.sources.meta;
          const sheets = s.sources.sheets;
          const spend = meta?.status === "ok" && meta.data ? meta.data.accounts.reduce((sum, a) => sum + a.spend_7d, 0) : null;
          const currency = meta?.status === "ok" && meta.data?.accounts[0]?.currency ? meta.data.accounts[0].currency : "BRL";
          return (
            <section className="metrics-grid" aria-label="Indicadores">
              <Kpi
                label="Investimento em mídia · 7 dias"
                value={spend !== null ? formatMoney(spend, currency) : "sem dado"}
                helper={meta?.status === "error" ? meta.error ?? "Erro no Meta Ads" : meta?.fetched_at ? `Atualizado ${formatWhen(meta.fetched_at)}` : "Ainda não consultado"}
                status={meta?.status === "error" ? "critico" : spend !== null ? "alvo" : "sem_dado"}
              />
              <Kpi
                label="E-mails não lidos"
                value={gmail?.status === "ok" && gmail.data ? String(gmail.data.unread_count) : "sem dado"}
                helper={gmail?.status === "ok" && gmail.data ? `${gmail.data.unread_last_24h} nas últimas 24 h` : gmail?.error ?? "Ainda não consultado"}
                status={gmail?.status === "error" ? "critico" : gmail?.status === "ok" ? "alvo" : "sem_dado"}
              />
              <Kpi
                label="Planilhas recentes"
                value={sheets?.status === "ok" && sheets.data ? String(sheets.data.sheets.length) : "sem dado"}
                helper={sheets?.status === "ok" ? "Modificadas recentemente" : sheets?.error ?? "Ainda não consultado"}
                status={sheets?.status === "error" ? "critico" : sheets?.status === "ok" ? "alvo" : "sem_dado"}
              />
              <Kpi label="Pedidos da semana" value={String(s.quality.current.counts.tasks)} helper="Tarefas operacionais" />
              <Kpi
                label="Taxa de resposta"
                value={s.quality.current.counts.tasks ? `${Math.round((s.quality.current.counts.replied / s.quality.current.counts.tasks) * 100)}%` : "sem dado"}
                helper="Pedidos operacionais respondidos"
              />
            </section>
          );
        }}
      </Loading>
    </>
  );
}

export function CampanhasPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Campanhas" subtitle="Contas e gasto do Meta Ads, pelo conector do claude.ai." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const meta = s.sources.meta;
          if (meta?.status === "error") {
            return <p role="alert" className="empty-note">Meta Ads com erro: {meta.error}. Reconecte o conector no claude.ai e clique em Atualizar fontes.</p>;
          }
          return (
            <Panel title="Contas de anúncio · últimos 7 dias" caption="Gasto total por conta. Detalhe por campanha ainda não é coletado.">
              <Table
                head={["Conta", "Gasto 7 dias", "Moeda"]}
                rows={(meta?.data?.accounts ?? []).map((a) => [a.name, formatMoney(a.spend_7d, a.currency), a.currency])}
                empty={meta?.status === "ok" ? "Nenhuma conta encontrada." : "Ainda não consultado. Clique em Atualizar fontes em Conexões e dados."}
              />
            </Panel>
          );
        }}
      </Loading>
    </>
  );
}

export function VendasPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Vendas e comunidade" subtitle="A fonte de vendas precisa ser definida antes de aparecer aqui." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => (
          <Panel title="Fonte de vendas" caption="Como conectar">
            <p className="empty-note">
              Nenhuma planilha de vendas configurada. Para ligar: crie (ou escolha) uma planilha no Google Sheets com as vendas, compartilhe com a
              conta conectada ao claude.ai e envie o link para a Maia no WhatsApp ou na Conversa com Maia. Depois disso, esta página mostra os totais.
            </p>
            <p className="empty-note">Planilhas recentes detectadas: {s.sources.sheets?.status === "ok" ? s.sources.sheets.data?.sheets.length ?? 0 : "sem dado"}.</p>
          </Panel>
        )}
      </Loading>
    </>
  );
}

export function InsightsPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Customer insights" subtitle="Padrões das suas conversas com a Maia, nos últimos 7 dias. Sem conteúdo pessoal." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const c = s.conversation;
          const days = Object.entries(c.perDay).sort(([a], [b]) => a.localeCompare(b));
          return (
            <>
              <section className="metrics-grid" aria-label="Conversas">
                <Kpi label="Mensagens · 7 dias" value={String(c.total7d)} status={c.total7d ? "alvo" : "sem_dado"} />
                <Kpi label="Média de palavras" value={c.averageWords !== null ? String(c.averageWords) : "sem dado"} />
                <Kpi label="Mensagens com pergunta" value={c.questionShare !== null ? `${c.questionShare}%` : "sem dado"} />
              </section>
              <Panel title="Mensagens por dia" caption="Quantidade de mensagens enviadas por você.">
                <Table head={["Dia", "Mensagens"]} rows={days.map(([day, n]) => [day, String(n)])} empty="Nenhuma mensagem nos últimos 7 dias." />
              </Panel>
              <Panel title="Horário das mensagens" caption="Em Brasília, por hora do dia.">
                <Table
                  head={["Hora", "Mensagens"]}
                  rows={c.perHourBrt.map((n, h) => [`${String(h).padStart(2, "0")}h`, String(n)]).filter(([, n]) => n !== "0")}
                  empty="Sem mensagens no período."
                />
              </Panel>
            </>
          );
        }}
      </Loading>
    </>
  );
}

export function TomPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Tom de voz" subtitle="Medido pelo estilo das suas mensagens. Análise de conteúdo por IA ainda não está ativa." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => (
          <section className="metrics-grid" aria-label="Tom">
            <Kpi label="Tamanho médio" value={s.conversation.averageWords !== null ? `${s.conversation.averageWords} palavras` : "sem dado"} helper="Por mensagem" />
            <Kpi label="Perguntas" value={s.conversation.questionShare !== null ? `${s.conversation.questionShare}%` : "sem dado"} helper="Das mensagens" />
            <Kpi label="Canal principal" value={Object.entries(s.conversation.perChannel).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "sem dado"} helper="Onde você mais escreve" />
          </section>
        )}
      </Loading>
    </>
  );
}

export function OcorrenciasPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Ocorrências" subtitle="Erros, bloqueios e aprovações não decididas dos últimos 7 dias." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => (
          <Panel title="Ocorrências" caption="Mais recentes primeiro. Tarefa e tipo; sem o texto das mensagens.">
            <Table
              head={["Quando", "Tipo", "Tarefa", "Detalhe"]}
              rows={s.incidents.map((i) => [
                formatWhen(i.at),
                INCIDENT_LABELS[i.kind] ?? i.kind,
                i.taskId !== null ? `#${i.taskId}` : "—",
                i.summary || "—",
              ])}
              empty="Nenhuma ocorrência nos últimos 7 dias."
            />
          </Panel>
        )}
      </Loading>
    </>
  );
}

export function ManualOperadorPanel() {
  return (
    <Panel title="Quem assume a operação da Maia" caption="Manual do operador, para quando a Maia parar ou precisar de revisão.">
      <div style={{ display: "grid", gap: 14 }}>
        {MANUAL_SECTIONS.map((section) => (
          <details key={section.title} open={section.title === "Se a Maia parar"}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>{section.title}</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </Panel>
  );
}
