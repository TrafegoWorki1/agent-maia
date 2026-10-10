import { useEffect, useState, type FormEvent } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { workspaceRequest, type WorkspaceData, type WorkRow } from "../../lib/workspaceApi";

// Decisão do owner (10/10/2026): tarefa, lembrete e avaliação são criados pela Maia, a partir da conversa no
// WhatsApp (ferramentas tarefa_criar/lembrete_criar) — nunca por um formulário aqui. Esta tela só acompanha e,
// quando preciso, corrige o que já existe (editar, reagendar, cancelar, reenviar); não cria nada do zero.
const statusLabel = { pendente: "Pendente", em_andamento: "Em andamento", concluida: "Concluída" };
const reminderLabel: Record<string,string> = { pending: "Agendado", sending: "Em envio", sent: "Aceito pelo WhatsApp", failed: "Falhou", uncertain: "Incerto · não repetido", cancelled: "Cancelado" };
const brt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem prazo";
const iso = (v: string) => v ? `${v}:00-03:00` : null;

export function TarefasPage() {
  const [data,setData] = useState<WorkspaceData | null>(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const [title,setTitle] = useState(""), [responsible,setResponsible] = useState("Herickson"), [due,setDue] = useState("");
  const [selected,setSelected] = useState<WorkRow | null>(null), [state,setState] = useState<WorkRow["status"]>("pendente"), [evidence,setEvidence] = useState("");
  const [reminderTime,setReminderTime] = useState("");
  const [editReminderId,setEditReminderId] = useState<number | null>(null);
  const [notice,setNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    const refresh = () => workspaceRequest().then((d) => { if (mounted) setData(d); }).catch((e: Error) => { if (mounted) setError(e.message); });
    void refresh(); const timer = setInterval(() => void refresh(),30000);
    return () => { mounted = false; clearInterval(timer); };
  },[]);
  async function mutate(action: string, input: unknown): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try { await workspaceRequest(action,input); setData(await workspaceRequest()); setNotice("Alteração salva no banco."); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar"); return false; }
    finally { setBusy(false); }
  }
  async function update(e: FormEvent) {
    e.preventDefault(); if (!selected) return;
    if (await mutate("update",{ id:selected.id,revisao:selected.revision,titulo:title,responsavel:responsible,prazo:iso(due),status:state,...(state === "concluida" ? { evidencia:evidence } : {}) })) { setSelected(null); setTitle(""); setDue(""); }
  }
  function select(t: WorkRow) {
    setSelected(t); setTitle(t.title); setResponsible(t.responsible); setState(t.status); setEvidence(t.completion_evidence ?? "");
    setDue(t.due_at ? new Date(Date.parse(t.due_at) - 3 * 3600000).toISOString().slice(0,16) : "");
  }
  return <>
    <PageHeader eyebrow="TRABALHO REAL" title="Tarefas e eficácia" subtitle="A Maia cria tarefa e lembrete pelo WhatsApp. Aqui você acompanha e corrige o que já existe; resposta da IA não significa trabalho concluído." />
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <Panel title="Trabalho operacional" caption={`Até ${data?.work.limit ?? 200} tarefas mais recentes, criadas pela Maia. Atraso é calculado pelo prazo, não um quarto estado.`}>
      {!data ? <p>Carregando tarefas…</p> : !data.work.tasks.length ? <p>Nenhuma tarefa de trabalho cadastrada. O histórico de execuções da IA continua separado.</p> : <div className="table-wrap"><table><thead><tr><th>Tarefa</th><th>Responsável</th><th>Estado</th><th>Prazo · Brasília</th><th>Evidência informada</th><th>Ação</th></tr></thead><tbody>{data.work.tasks.map((t) => <tr key={t.id}><td>#{t.id} · {t.title}</td><td>{t.responsible}</td><td>{statusLabel[t.status]}{t.overdue ? " · Atrasada" : ""}</td><td>{brt(t.due_at)}</td><td>{t.completion_evidence ?? "—"}</td><td><button disabled={busy} onClick={() => select(t)}>Editar</button></td></tr>)}</tbody></table></div>}
    </Panel>
    {selected && <Panel title={`Editar tarefa #${selected.id}`} caption="Correção manual de uma tarefa que a Maia já criou. Não cria tarefa nova.">
      <form className="work-form" onSubmit={update}>
        <label>Título<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Responsável<input required maxLength={100} value={responsible} onChange={(e) => setResponsible(e.target.value)} /></label>
        <label>Prazo · Brasília<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label>Estado<select value={state} onChange={(e) => setState(e.target.value as WorkRow["status"])}>{Object.entries(statusLabel).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {state === "concluida" && <label>Evidência do trabalho entregue<textarea required maxLength={2000} value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>}
        <button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button>
        <button type="button" onClick={() => { setSelected(null); setTitle(""); setDue(""); }}>Cancelar edição</button>
      </form>
    </Panel>}
    <Panel title="Lembretes no WhatsApp" caption="Agendados pela Maia junto com a tarefa (prazo) ou a pedido do owner no WhatsApp. Aqui só reagenda ou cancela um já existente. ID confirma aceitação, não leitura; falha/resultado incerto fica visível, sem repetição automática.">
      {editReminderId && <form className="work-form" onSubmit={(e) => { e.preventDefault(); void mutate("edit_reminder",{ id:editReminderId,horario:iso(reminderTime) }).then((ok) => { if (ok) { setEditReminderId(null); setReminderTime(""); } }); }}>
        <label>Novo horário · Brasília<input required type="datetime-local" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} /></label>
        <button disabled={busy} type="submit">Reagendar #{editReminderId}</button>
        <button type="button" onClick={() => setEditReminderId(null)}>Cancelar edição</button>
      </form>}
      {!data?.work.reminders.length ? <p>Nenhum lembrete agendado ainda.</p> : <div className="table-wrap"><table><thead><tr><th>Tarefa</th><th>Horário · Brasília</th><th>Estado</th><th>Diagnóstico / ID</th><th>Ações</th></tr></thead><tbody>{data.work.reminders.map((r) => <tr key={r.id}><td>#{r.work_task_id} · {r.kind === "prazo" ? "Prazo" : "Manual"}</td><td>{brt(r.run_at)}</td><td>{reminderLabel[r.status] ?? r.status}</td><td>{r.error ?? r.message_id ?? "—"}</td><td>{r.status === "pending" && <><button disabled={busy} onClick={() => { setEditReminderId(r.id); setReminderTime(new Date(Date.parse(r.run_at) - 3 * 3600000).toISOString().slice(0,16)); }}>Reagendar</button><button disabled={busy} onClick={() => void mutate("edit_reminder",{ id:r.id,cancelar:true })}>Cancelar</button></>}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Relevância e resolução" caption="Acompanhamento das entregas, sem avaliação manual: a amostra vem do que a própria Maia registra.">
      {data?.effectiveness.deliveries.filter((d) => d.status === "failed" || d.status === "uncertain").map((d,i) => <p role="alert" key={`${d.task_id}:${i}`}>Entrega #{d.task_id}: {d.status === "uncertain" ? "incerta — confira no WhatsApp, sem repetição" : "rejeitada"} · {d.error} {d.status === "failed" && <button disabled={busy} onClick={() => void mutate("retry_delivery",{ task_id:d.task_id })}>Reenviar somente a resposta</button>}</p>)}
      <p>{data?.effectiveness.sample ?? 0}/20 pedidos avaliados · Relevância: {data?.effectiveness.relevance == null ? "Sem avaliação" : `${data.effectiveness.relevance}%`} · Resolvidos: {data?.effectiveness.resolution == null ? "Sem avaliação" : `${data.effectiveness.resolution}%`}</p>
      {!data?.effectiveness.sufficient && <p>Amostra abaixo de 20: resultado exploratório, não comprova a meta de eficácia.</p>}
      <p>{data?.effectiveness.sampleScope}</p>
    </Panel>
  </>;
}
