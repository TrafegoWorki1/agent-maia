import { useEffect, useState } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { retryCreativeSend, workspaceRequest, type WorkspaceData } from "../../lib/workspaceApi";

// Decisão do owner (10/10/2026): tarefa, lembrete e avaliação são criados pela Maia, a partir da conversa no
// WhatsApp (ferramentas tarefa_criar/lembrete_criar) — nunca por um formulário aqui. Esta tela só acompanha e,
// quando preciso, corrige o que já existe (editar, reagendar, cancelar, reenviar); não cria nada do zero.
const reminderLabel: Record<string,string> = { pending: "Agendado", sending: "Em envio", sent: "Aceito pelo WhatsApp", failed: "Falhou", uncertain: "Incerto · não repetido", cancelled: "Cancelado" };
const receiptLabel: Record<string,string> = { accepted: "Aceito pelo serviço · entrega não confirmada", delivered: "Entregue", read: "Lida", played: "Reproduzida", failed: "Falha informada" };
const creativeJobLabel: Record<string,string> = { queued: "Na fila", running: "Em andamento", review: "Rascunhos enviados · aguardam sua revisão", partial: "Concluído parcialmente · há itens com falha", uncertain: "Resultado incerto · precisa de conferência" };
const creativeItemLabel: Record<string,string> = { queued: "Na fila", generating: "Gerando", artifact_ready: "Arte pronta · aguardando envio", preview_sending: "Enviando rascunho", ready_for_review: "Enviado para revisão", sent: "Enviado · aguardando confirmação", accepted: "Aceito pelo serviço", failed: "Falhou", uncertain: "Incerto · não repetido" };
const brt = (v: string | null) => v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem prazo";
const iso = (v: string) => v ? `${v}:00-03:00` : null;

type RetryPhase = "idle" | "confirming" | "processing" | "sent" | "failed" | "uncertain";

export function TarefasPage() {
  const [data,setData] = useState<WorkspaceData | null>(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const [reminderTime,setReminderTime] = useState("");
  const [editReminderId,setEditReminderId] = useState<number | null>(null);
  const [notice,setNotice] = useState("");
  const [retryPhase,setRetryPhase] = useState<Record<number,RetryPhase>>({});
  const [retryMsg,setRetryMsg] = useState<Record<number,string>>({});
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
  async function triggerRetry(itemId: number, confirmUncertain: boolean) {
    const key = crypto.randomUUID();
    setRetryPhase((prev) => ({ ...prev, [itemId]: "processing" }));
    setRetryMsg((prev) => ({ ...prev, [itemId]: "" }));
    try {
      const result = await retryCreativeSend(itemId, confirmUncertain, key);
      if (result.ok) {
        setRetryPhase((prev) => ({ ...prev, [itemId]: "sent" }));
        setRetryMsg((prev) => ({ ...prev, [itemId]: result.messageId }));
      } else {
        const phase: RetryPhase = result.state === "uncertain" ? "uncertain" : "failed";
        setRetryPhase((prev) => ({ ...prev, [itemId]: phase }));
        setRetryMsg((prev) => ({ ...prev, [itemId]: result.message }));
      }
    } catch (e) {
      setRetryPhase((prev) => ({ ...prev, [itemId]: "failed" }));
      setRetryMsg((prev) => ({ ...prev, [itemId]: e instanceof Error ? e.message : "Falha ao tentar novamente" }));
    }
  }
  return <>
    <PageHeader eyebrow="OPERAÇÃO DA MAIA" title="Filas, entregas e eficácia" subtitle="Diagnóstico técnico da IA. Tarefas de trabalho são acompanhadas e alteradas na Central; resposta da IA não comprova entrega." />
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <Panel title="Trabalho na Central" caption="Uma única fonte e um único fluxo de alteração de tarefas.">
      <a href="#trabalho/minha-equipe">Abrir tarefas, projetos e entregáveis na Central de Trabalho</a>
    </Panel>
    <Panel title="Lembretes no WhatsApp" caption="Agendados pela Maia junto com a tarefa (prazo) ou a pedido do owner no WhatsApp. Aqui só reagenda ou cancela um já existente. ID confirma aceitação, não leitura; falha/resultado incerto fica visível, sem repetição automática.">
      {editReminderId && <form className="work-form" onSubmit={(e) => { e.preventDefault(); void mutate("edit_reminder",{ id:editReminderId,horario:iso(reminderTime) }).then((ok) => { if (ok) { setEditReminderId(null); setReminderTime(""); } }); }}>
        <label>Novo horário · Brasília<input required type="datetime-local" value={reminderTime} onChange={(e) => setReminderTime(e.target.value)} /></label>
        <button disabled={busy} type="submit">Reagendar #{editReminderId}</button>
        <button type="button" onClick={() => setEditReminderId(null)}>Cancelar edição</button>
      </form>}
      {!data?.work.reminders.length ? <p>Nenhum lembrete agendado ainda.</p> : <div className="table-wrap"><table><thead><tr><th>Tarefa</th><th>Horário · Brasília</th><th>Estado</th><th>Diagnóstico / ID</th><th>Ações</th></tr></thead><tbody>{data.work.reminders.map((r) => <tr key={r.id}><td>#{r.work_task_id} · {r.kind === "prazo" ? "Prazo" : "Manual"}</td><td>{brt(r.run_at)}</td><td>{reminderLabel[r.status] ?? r.status}</td><td>{r.error ?? r.message_id ?? "—"}</td><td>{r.status === "pending" && <><button disabled={busy} onClick={() => { setEditReminderId(r.id); setReminderTime(new Date(Date.parse(r.run_at) - 3 * 3600000).toISOString().slice(0,16)); }}>Reagendar</button><button disabled={busy} onClick={() => void mutate("edit_reminder",{ id:r.id,cancelar:true })}>Cancelar</button></>}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Trabalhos criativos retomáveis" caption="Cada arte é gerada e registada separadamente. Em caso de reinício, o worker continua do último checkpoint seguro. Rascunhos são enviados apenas para si; nada é publicado automaticamente.">
      {!data?.creativeJobs?.length ? <p>Nenhum trabalho criativo enfileirado.</p> : <div className="table-wrap"><table><thead><tr><th>Trabalho</th><th>Estado</th><th>Progresso por arte</th></tr></thead><tbody>{data.creativeJobs.map((job) => <tr key={job.id}><td>#{job.id} · {job.title}<br /><small>Tarefa de origem #{job.source_task_id} · {brt(job.created_at)}</small></td><td>{creativeJobLabel[job.status] ?? job.status}</td><td>{job.items.map((item) => {
        const phase = retryPhase[item.id] ?? "idle";
        const msg = retryMsg[item.id] ?? "";
        const itemIsRetryable = item.status === "failed" || item.status === "uncertain";
        const effectiveStatus = phase === "sent" ? "sent" : item.status;
        return (
          <div key={item.seq}>
            #{item.seq} ({item.format}): {creativeItemLabel[effectiveStatus] ?? effectiveStatus}{item.artifact_name ? ` · ${item.artifact_name}` : ""}{item.error && phase !== "sent" ? ` · ${item.error}` : ""}
            {phase === "processing" && <span aria-live="polite"> · Processando…</span>}
            {phase === "sent" && msg && <span> · {msg}</span>}
            {phase === "failed" && <span role="alert"> · Falhou · {msg}</span>}
            {phase === "uncertain" && <span role="alert"> · Incerto · {msg}</span>}
            {phase === "confirming" && <span> · Estado incerto. Deseja reenviar? <button type="button" onClick={() => void triggerRetry(item.id, true)}>Confirmar</button> <button type="button" onClick={() => setRetryPhase((prev) => ({ ...prev, [item.id]: "idle" }))}>Cancelar</button></span>}
            {itemIsRetryable && phase === "idle" && (
              item.status === "uncertain"
                ? <button type="button" onClick={() => setRetryPhase((prev) => ({ ...prev, [item.id]: "confirming" }))}>Tentar novamente</button>
                : <button type="button" onClick={() => void triggerRetry(item.id, false)}>Tentar novamente</button>
            )}
            {(phase === "failed" || phase === "uncertain") && (
              phase === "uncertain"
                ? <button type="button" onClick={() => setRetryPhase((prev) => ({ ...prev, [item.id]: "confirming" }))}>Tentar novamente</button>
                : <button type="button" onClick={() => void triggerRetry(item.id, false)}>Tentar novamente</button>
            )}
          </div>
        );
      })}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Mensagens recentes no WhatsApp" caption="Status reportados pela Evolution. Aceite não significa entrega; entrega/leitura só aparecem quando chega um recibo. O painel não exibe o conteúdo nem o número do destinatário.">
      {!data?.receipts.length ? <p>Nenhum recibo de saída registrado ainda.</p> : <div className="table-wrap"><table><thead><tr><th>Destino</th><th>Estado comprovado</th><th>Atualizado · Brasília</th><th>ID da mensagem</th></tr></thead><tbody>{data.receipts.map((r) => <tr key={r.messageId}><td>{r.destination}</td><td>{receiptLabel[r.status] ?? "Estado não classificado"}</td><td>{brt(r.updatedAt)}</td><td>{r.messageId}</td></tr>)}</tbody></table></div>}
    </Panel>
    <Panel title="Relevância e resolução" caption="Acompanhamento das entregas, sem avaliação manual: a amostra vem do que a própria Maia registra.">
      {data?.effectiveness.deliveries.filter((d) => d.status === "failed" || d.status === "uncertain").map((d,i) => <p role="alert" key={`${d.task_id}:${i}`}>Entrega #{d.task_id}: {d.status === "uncertain" ? "incerta — confira no WhatsApp, sem repetição" : "rejeitada"} · {d.error} {d.status === "failed" && <button disabled={busy} onClick={() => void mutate("retry_delivery",{ task_id:d.task_id })}>Reenviar somente a resposta</button>}</p>)}
      <p>{data?.effectiveness.sample ?? 0}/20 pedidos avaliados · Relevância: {data?.effectiveness.relevance == null ? "Sem avaliação" : `${data.effectiveness.relevance}%`} · Resolvidos: {data?.effectiveness.resolution == null ? "Sem avaliação" : `${data.effectiveness.resolution}%`}</p>
      {!data?.effectiveness.sufficient && <p>Amostra abaixo de 20: resultado exploratório, não comprova a meta de eficácia.</p>}
      <p>{data?.effectiveness.sampleScope}</p>
    </Panel>
  </>;
}
