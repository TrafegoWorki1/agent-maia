import { useCallback, useEffect, useState } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { nucleusCommand, nucleusRequest, searchNucleusSession, type NucleusCommand, type NucleusData } from "../../lib/nucleusApi";

export function NucleoPage() {
  const [data, setData] = useState<NucleusData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<"once" | "interval" | "cron">("interval");
  const [value, setValue] = useState("1d");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [analysisContext, setAnalysisContext] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historySession, setHistorySession] = useState("");
  const [historyResults, setHistoryResults] = useState<Array<{ id: number; at: string; author: string; text: string; source: string }>>([]);
  const refresh = useCallback(async () => { try { setData(await nucleusRequest()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : "Núcleo indisponível"); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const act = async (command: NucleusCommand) => {
    setBusy(true);
    try { await nucleusCommand(command); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Ação recusada"); }
    finally { setBusy(false); }
  };
  return <>
    <PageHeader eyebrow="NÚCLEO DA MAIA" title="Continuidade e automações" subtitle="Dados reais do banco compartilhado. Nenhuma rotina executa até ativação explícita e configuração do worker." />
    {error && <p role="alert">{error}</p>}
    {!data ? !error && <p>Carregando estado do núcleo…</p> : <div style={{ display: "grid", gap: 16 }}>
      <Panel title="Sessões" caption="Nova conversa arquiva a sessão atual sem apagar o histórico.">
        <button type="button" disabled={busy} onClick={() => void act({ action: "session_new", channel: "painel" })}>Nova conversa no painel</button>
        {data.sessions.length ? data.sessions.slice(0, 10).map((row) => <p key={row.id}><strong>{row.title || row.conversation_key}</strong> · {row.scope_kind} · {row.status} · {new Date(row.updated_at).toLocaleString("pt-BR")}</p>) : <p>Nenhuma sessão registrada.</p>}
        <form onSubmit={(event) => { event.preventDefault(); const row = data.sessions.find((item) => item.id === historySession); if (!row) return; setBusy(true); void searchNucleusSession(row.id, row.channel as "whatsapp" | "painel", historyQuery).then((rows) => { setHistoryResults(rows); setError(""); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Busca indisponível")).finally(() => setBusy(false)); }}>
          <label>Sessão <select value={historySession} onChange={(event) => setHistorySession(event.target.value)} required><option value="">Selecione</option>{data.sessions.map((row) => <option key={row.id} value={row.id}>{row.title || row.conversation_key} · {row.status}</option>)}</select></label>
          <label>Buscar no histórico <input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} minLength={2} maxLength={120} required /></label>
          <button type="submit" disabled={busy}>Buscar</button>
        </form>
        {historyResults.map((row) => <p key={row.id}>{new Date(row.at).toLocaleString("pt-BR")} · {row.author} · {row.text}</p>)}
      </Panel>
      <Panel title="Skills" caption="Propostas só são ativadas após aprovação explícita do owner.">
        {data.skills.length ? data.skills.map((row) => <p key={row.id}><strong>{row.slug}</strong> v{row.version} · {row.status} · {row.description} {row.status === "proposal" && <button type="button" disabled={busy} onClick={() => void act({ action: "skill_activate", id: row.id })}>Aprovar e ativar</button>}</p>) : <p>Nenhuma skill registrada. As iniciais são propostas na sincronização configurada do worker.</p>}
      </Panel>
      <Panel title="Planos e subagentes" caption="Estados incertos exigem revisão; não significam conclusão.">
        {data.plans.length ? data.plans.map((row) => <p key={row.id}>Plano #{row.id} · {row.title} · {row.status}</p>) : <p>Nenhum plano registrado.</p>}
        <form onSubmit={(event) => { event.preventDefault(); void act({ action: "delegate", kind: "analysis", objectives: [objective], context: analysisContext }); }}>
          <label>Objetivo de análise <input value={objective} onChange={(event) => setObjective(event.target.value)} required minLength={5} maxLength={1000} /></label>
          <label>Contexto fornecido <input value={analysisContext} onChange={(event) => setAnalysisContext(event.target.value)} maxLength={4000} /></label>
          <button type="submit" disabled={busy}>Enfileirar análise isolada</button>
        </form>
        <p>Subagentes recebem apenas o contexto digitado acima, sem ferramentas ou acesso a conectores. Requer MAIA_NUCLEUS_SUBAGENTS_ENABLED=1 no worker.</p>
        {data.subagents.length ? data.subagents.map((row) => <div key={row.id}><p>Subagente · {row.status} · {row.objective}</p>{row.result && <details><summary>Examinar resultado</summary><p>{row.result}</p></details>}{row.status === "awaiting_review" && row.result && <button type="button" disabled={busy} onClick={() => void act({ action: "subagent_review", id: row.id, approved: true, note: "Resultado examinado e aprovado pelo owner no painel" })}>Aprovar após examinar</button>} {["queued", "running", "awaiting_review"].includes(row.status) && <button type="button" disabled={busy} onClick={() => void act({ action: "subagent_cancel", id: row.id })}>Cancelar</button>}</div>) : <p>Nenhum subagente registrado.</p>}
        {data.delegationSummaries.map((row) => <p key={`${row.task_id}-${row.at}`}>Tarefa #{row.task_id} · síntese revisada: {row.detail}</p>)}
      </Panel>
      <Panel title="Rotinas" caption="Execução textual isolada, sem ferramentas. Entrega aceita não comprova leitura. Requer MAIA_NUCLEUS_SCHEDULES_ENABLED=1 no worker.">
        <form onSubmit={(event) => { event.preventDefault(); void act(editingId ? { action: "schedule_edit", id: editingId, instruction, kind, value, timezone: "America/Sao_Paulo" } : { action: "schedule_create", instruction, kind, value, timezone: "America/Sao_Paulo" }); }}>
          <label>Instrução <input value={instruction} onChange={(event) => setInstruction(event.target.value)} required maxLength={8000} /></label>
          <label>Agenda <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="once">Uma vez (ISO)</option><option value="interval">Intervalo</option><option value="cron">Cron</option></select></label>
          <label>Valor <input value={value} onChange={(event) => setValue(event.target.value)} required maxLength={120} /></label>
          <button type="submit" disabled={busy}>{editingId ? "Salvar rotina pausada" : "Criar pausada"}</button>
        </form>
        {data.schedules.length ? data.schedules.map((row) => <p key={row.id}><strong>{row.status}</strong> · {row.schedule_kind} {row.schedule_value} · {row.instruction.slice(0, 100)} {row.status !== "cancelled" && <><button type="button" disabled={busy} onClick={() => void act({ action: "schedule_status", id: row.id, status: row.status === "active" ? "paused" : "active" })}>{row.status === "active" ? "Pausar" : "Ativar"}</button>{row.status === "paused" && <button type="button" disabled={busy} onClick={() => { setEditingId(row.id); setInstruction(row.instruction); setKind(row.schedule_kind as typeof kind); setValue(row.schedule_value); }}>Editar</button>}<button type="button" disabled={busy} onClick={() => void act({ action: "schedule_status", id: row.id, status: "cancelled" })}>Cancelar</button></>}</p>) : <p>Nenhuma rotina cadastrada.</p>}
      </Panel>
      <Panel title="MCP" caption="O catálogo HTTP é distinto. Servidores sem conexão não são anunciados como disponíveis.">
        {data.mcp.length ? data.mcp.map((row) => <p key={row.id}>{row.name} · {row.transport} · {row.status}</p>) : <p>Nenhum servidor MCP externo configurado.</p>}
      </Panel>
    </div>}
  </>;
}
