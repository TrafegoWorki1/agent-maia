import { useEffect, useState } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { nucleusRequest, type NucleusData } from "../../lib/nucleusApi";

export function NucleoPage() {
  const [data, setData] = useState<NucleusData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void nucleusRequest().then((value) => { setData(value); setError(""); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Núcleo indisponível")); }, []);
  return <>
    <PageHeader eyebrow="NÚCLEO DA MAIA" title="Continuidade e automações" subtitle="Sessões, planos, skills, subagentes, rotinas e MCP vêm do banco compartilhado. Esta tela é somente leitura." />
    {error && <p role="status">{error}</p>}
    {!data ? !error && <p>Carregando estado do núcleo…</p> : <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Sessões" caption="Escopo, canal e última atividade; o conteúdo do histórico não é exposto nesta visão.">{data.sessions.length ? data.sessions.slice(0, 10).map((row) => <p key={row.id}><strong>{row.title || row.conversation_key}</strong> · {row.scope_kind} · {row.status} · {new Date(row.updated_at).toLocaleString("pt-BR")}</p>) : <p>Nenhuma sessão persistente registrada.</p>}</Panel>
      <Panel title="Skills ativas e propostas" caption="Propostas continuam separadas até aprovação do owner.">{data.skills.length ? data.skills.map((row) => <p key={row.id}><strong>{row.slug}</strong> v{row.version} · {row.status} · {row.description}</p>) : <p>Nenhuma skill registrada.</p>}</Panel>
      <Panel title="Planos e subagentes" caption="Estados incertos não são apresentados como concluídos."><p>{data.plans.length} plano(s) persistente(s) · {data.subagents.length} subagente(s) registrado(s).</p>{data.subagents.slice(0, 5).map((row) => <p key={row.id}><strong>{row.status}</strong> · {row.objective}</p>)}</Panel>
      <Panel title="Rotinas e MCP" caption="Agendamento não concede autorização permanente; MCP usa allowlist explícita."><p>{data.schedules.length} rotina(s) · {data.mcp.length} servidor(es) MCP configurado(s).</p>{data.schedules.slice(0, 5).map((row) => <p key={row.id}><strong>{row.status}</strong> · {row.schedule_kind} {row.schedule_value} · {row.destination}</p>)}</Panel>
    </div>}
  </>;
}
