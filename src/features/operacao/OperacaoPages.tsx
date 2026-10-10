import type { ReactNode } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { MANUAL_SECTIONS } from "../../data/manual";
import { formatMoney, formatWhen, type Snapshot } from "../../lib/snapshotApi";
import { useSnapshot } from "../../lib/useSnapshot";
import { JevPanel } from "./JevPanel";

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
    return <p className="empty-note">{error ? "Ainda sem dados para esta tela. As informações da Maia chegam só pelo computador dela." : "Carregando…"}</p>;
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
      <PageHeader eyebrow="Operação" title="Resumo" subtitle="Execuções de hoje, nota da semana e o que pede atenção. Trabalho e prazos estão em Tarefas e eficácia." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const today = s.tasks.today;
          const q = s.quality.current;
          return (
            <>
              <section className="metrics-grid" aria-label="Números-chave">
                <Kpi label="Execuções hoje" value={String(today.total)} helper="Pedidos operacionais à IA; não tarefas de trabalho" status={today.total ? "alvo" : "sem_dado"} />
                <Kpi label="Em andamento" value={String(today.byStatus.em_andamento ?? 0)} status={today.byStatus.em_andamento ? "atencao" : "sem_dado"} />
                <Kpi label="Concluídas" value={String(today.byStatus.concluida ?? 0)} status={today.byStatus.concluida ? "alvo" : "sem_dado"} />
                <Kpi label="Com erro" value={String((today.byStatus.falhou ?? 0) + (today.byStatus.incerta ?? 0))} status={(today.byStatus.falhou ?? 0) + (today.byStatus.incerta ?? 0) ? "critico" : "alvo"} helper="Com erro ou incertas" />
                <Kpi label="Aguardando aprovação" value={String(s.approvals.length)} status={s.approvals.length ? "atencao" : "alvo"} />
              </section>

              <Panel title="Qualidade operacional" caption={`Semana ${q.week} · eventos registrados. A nota mede a operação; a relevância das respostas ainda precisa de avaliação própria.`}>
                <section className="metrics-grid" aria-label="Nota da semana">
                  <Kpi
                    label="Nota da semana"
                    value={q.overall !== null ? `${q.overall.toFixed(1)} / 10` : "dados insuficientes"}
                    helper={`Semana anterior: ${s.quality.previous.overall !== null ? `${s.quality.previous.overall.toFixed(1)} / 10` : "sem nota"}`}
                    status={q.overall === null ? "sem_dado" : q.overall >= 7 ? "alvo" : "atencao"}
                  />
                  <Kpi label="Teto por incidente" value={q.incidents.length ? `${q.criticalCap} / 10` : "Não aplicado"} helper={q.incidents.length ? `${q.incidents.length} ação(ões) externa(s) sem aprovação válida` : "Nenhum incidente crítico comprovado nos registros"} status={q.incidents.length ? "critico" : "alvo"} />
                  <Kpi label="Respondidas" value={`${q.counts.replied} de ${q.counts.tasks}`} helper="Execuções operacionais da semana" />
                </section>
                <Table
                  head={["Dimensão", "Peso", "Nota", "Amostra"]}
                  rows={Object.keys(DIMENSION_LABELS).map((key) => [
                    DIMENSION_LABELS[key],
                    `${Math.round((q.weights[key] ?? 0) * 100)}%`,
                    scoreText(q.dimensions[key as keyof typeof q.dimensions]),
                    q.samples?.[key as keyof typeof q.dimensions] ? `${q.samples[key as keyof typeof q.dimensions].passed} de ${q.samples[key as keyof typeof q.dimensions].total}` : "Não informada",
                  ])}
                  empty="Sem dimensões."
                />
                <p className="empty-note">Precisão exige uma conferência da mesma ação. Gestão de risco conta aprovações válidas antes da execução e recusas ou expirações respeitadas. Comunicação mede resposta registrada, ainda não a resolução do pedido.</p>
              </Panel>

              {!!q.priorities?.length && <Panel title="O que melhorar primeiro" caption="Prioridades calculadas a partir das falhas e das provas que faltam nesta semana.">
                <Table
                  head={["Prioridade", "Melhoria", "Evidência", "Próxima ação"]}
                  rows={q.priorities.map((p) => [p.priority === "critica" ? "Crítica" : p.priority === "alta" ? "Alta" : "Média", p.title, p.evidence, p.action])}
                  empty="Nenhuma prioridade registrada."
                />
              </Panel>}

              <Panel title="Execuções recentes" caption="Pedidos à IA, não tarefas de trabalho. Texto limitado a 40 caracteres. A conversa completa fica em Conversa com Maia.">
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
              <JevPanel data={s.jev} />
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
      <PageHeader eyebrow="Desempenho" title="Indicadores" subtitle="Resultados da operação da Maia e investimento em mídia, com período e fonte identificados." />
      <Loading snapshot={snapshot} error={error}>
        {(s) => {
          const meta = s.sources.meta;
          const q = s.quality.current;
          const counts = q.counts;
          const completed = counts.terminal - counts.failures - counts.uncertain;
          const spendByCurrency = new Map<string, number>();
          if (meta?.status === "ok" && meta.data) {
            for (const account of meta.data.accounts) spendByCurrency.set(account.currency, (spendByCurrency.get(account.currency) ?? 0) + account.spend_7d);
          }
          return (
            <>
              <Panel title="Entrega operacional" caption={`Semana ${q.week} · execuções operacionais registradas. Conversas simples não entram nesta amostra.`}>
                <section className="metrics-grid" aria-label="Desempenho operacional">
                  <Kpi label="Pedidos operacionais" value={String(counts.tasks)} helper="Total da semana" />
                  <Kpi label="Taxa de resposta" value={counts.tasks ? `${Math.round(counts.replied / counts.tasks * 100)}%` : "sem dado"} helper={`${counts.replied} de ${counts.tasks} pedidos com resposta registrada`} />
                  <Kpi label="Execuções sem erro ou interrupção" value={counts.terminal ? `${Math.round(completed / counts.terminal * 100)}%` : "sem dado"} helper={`${completed} de ${counts.terminal} encerradas; não comprova a resolução de todo pedido`} />
                  <Kpi label="Falhas" value={String(counts.failures)} helper="Execuções encerradas com erro" status={counts.failures ? "critico" : "sem_dado"} />
                  <Kpi label="Resultados incertos" value={String(counts.uncertain)} helper="Execuções que precisam de conferência" status={counts.uncertain ? "atencao" : "sem_dado"} />
                  <Kpi label="Pedidos sem resposta" value={String(counts.tasks - counts.replied)} helper="Pedidos operacionais da semana" status={counts.tasks > counts.replied ? "atencao" : "alvo"} />
                  <Kpi label="Falhas de envio" value={counts.deliveryFailures === undefined ? "sem dado" : String(counts.deliveryFailures)} helper="Erros de envio registrados pela Evolution" status={counts.deliveryFailures ? "critico" : "sem_dado"} />
                  <Kpi label="Erros de ferramenta" value={counts.toolFailures === undefined ? "sem dado" : String(counts.toolFailures)} helper="Erros registrados; podem ocorrer mesmo com resposta da IA" status={counts.toolFailures ? "atencao" : "sem_dado"} />
                  <Kpi label="Falhas em todos os registros" value={counts.allFailures === undefined ? "sem dado" : String(counts.allFailures)} helper={`${counts.allTasks ?? "—"} registros; inclui conversas simples e avisos`} status={counts.allFailures ? "atencao" : "sem_dado"} />
                  <Kpi label="Aprovações pendentes agora" value={String(s.approvals.length)} helper="Total atual, independente da semana" status={s.approvals.length ? "atencao" : "sem_dado"} />
                </section>
              </Panel>
              <Panel title="Qualidade da entrega" caption={`Semana ${q.week} · avaliação baseada nos eventos registrados.`}>
                <section className="metrics-grid" aria-label="Qualidade operacional">
                  <Kpi label="Nota operacional" value={q.overall === null ? "sem amostra suficiente" : `${q.overall.toFixed(1)} / 10`} helper={`Semana anterior: ${scoreText(s.quality.previous.overall)}`} />
                  <Kpi label="Ações conferidas" value={counts.externalActions === undefined ? String(counts.verified) : `${counts.verified} de ${counts.externalActions}`} helper="Conferência ligada à mesma tarefa e operação" />
                  <Kpi label="Ações sem prova" value={String(counts.withoutEvidence)} helper="Resultado externo registrado sem conferência correspondente" status={counts.withoutEvidence ? "atencao" : "alvo"} />
                  <Kpi label="Respostas em até 2 minutos" value={q.dimensions.velocidade === null ? "sem dado" : `${Math.round(q.dimensions.velocidade * 10)}%`} helper="Entre pedidos operacionais respondidos; inclui espera por aprovação" />
                  <Kpi label="Tempo mediano de resposta" value={q.responseTime?.medianMs == null ? "sem dado" : `${Math.round(q.responseTime.medianMs / 1000)} s`} helper="Pedido recebido até resposta registrada; inclui fila e aprovação" />
                  <Kpi label="Tempo de resposta · p95" value={q.responseTime?.p95Ms == null ? "sem dado" : `${Math.round(q.responseTime.p95Ms / 1000)} s`} helper="95% das respostas registradas chegaram até esse tempo" />
                </section>
              </Panel>
              <Panel title="Investimento em mídia" caption="Meta Ads · gasto dos 7 dias cobertos pela última coleta disponível. Valores separados por moeda.">
                {meta?.status === "error" && <p className="empty-note">A última coleta falhou. Confira o diagnóstico em Conexões e dados.</p>}
                {spendByCurrency.size ? <section className="metrics-grid" aria-label="Investimento em mídia">
                  {[...spendByCurrency].map(([currency, spend]) => <Kpi key={currency} label={`Investimento · ${currency}`} value={formatMoney(spend, currency)} helper={`Coletado em ${formatWhen(meta?.fetched_at)}`} />)}
                </section> : <p className="empty-note">Ainda sem investimento disponível para este período.</p>}
                <p className="empty-note">CTR, CPC, leads, CPA e ROAS dependem de ampliar a coleta e definir a fonte de conversões e receita.</p>
              </Panel>
            </>
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
