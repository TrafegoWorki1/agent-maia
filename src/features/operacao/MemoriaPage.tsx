import { useEffect, useState, type FormEvent } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { workspaceRequest, type MemoryRow, type WorkspaceData } from "../../lib/workspaceApi";

const kindLabel: Record<MemoryRow["kind"], string> = { compromisso: "Combinado / compromisso", contexto: "Contexto", preferencia: "Preferência" };
const statusLabel: Record<MemoryRow["status"], string> = { active: "Ativo", completed: "Concluído", archived: "Arquivado" };
const when = (value: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem prazo";
const toIso = (value: string) => value ? `${value}:00-03:00` : null;

export function MemoriaPage() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState<MemoryRow["kind"]>("compromisso");
  const [due, setDue] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<MemoryRow | null>(null);

  async function refresh() {
    try { setData(await workspaceRequest()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao sincronizar memória"); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 30000); return () => clearInterval(timer); }, []);

  async function mutate(action: string, input: unknown) {
    setBusy(true); setError(""); setNotice("");
    try { await workspaceRequest(action, input); setData(await workspaceRequest()); setNotice("Salvo no banco compartilhado pelo agente e pelo painel."); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar"); return false; }
    finally { setBusy(false); }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (await mutate("memory_create", { title, detail, kind, due_at: toIso(due) })) { setTitle(""); setDetail(""); setDue(""); setKind("compromisso"); }
  }
  async function update(row: MemoryRow, status: MemoryRow["status"]) {
    await mutate("memory_update", { id: row.id, revision: row.revision, status });
  }
  async function saveEdit(e: FormEvent) {
    e.preventDefault(); if (!editing) return;
    if (await mutate("memory_update", { id: editing.id, revision: editing.revision, title, detail, kind, due_at: toIso(due) })) { setEditing(null); setTitle(""); setDetail(""); setDue(""); }
  }

  const memories = (data?.memories ?? []).filter((row) => showInactive || row.status === "active");
  return <>
    <PageHeader eyebrow="CONTINUIDADE DO AGENTE" title="Memória e combinados" subtitle="Registros ativos são carregados no contexto privado da Maia e aparecem aqui pela mesma fonte no Supabase." />
    {error && <p role="alert">Falha de sincronização: {error}. Seus registros existentes não foram apagados.</p>}
    {notice && <p role="status">{notice}</p>}
    <Panel title="Registrar uma memória" caption="Use para compromissos, contexto importante ou preferências. Evite senhas e dados sensíveis. A Maia também pode registrar combinados explícitos durante a conversa.">
      <form className="work-form" onSubmit={create}>
        <label>Título<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Enviar a proposta revisada" /></label>
        <label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value as MemoryRow["kind"])}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Detalhes<textarea required maxLength={4000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="O que foi combinado, com quem e qual é o próximo passo." /></label>
        <label>Prazo · Brasília (opcional)<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar memória compartilhada"}</button>
      </form>
    </Panel>
    <Panel title="Memória ativa" caption={`${data?.memories.filter((m) => m.status === "active").length ?? 0} registro(s) ativo(s). Alterações são sincronizadas em até 30 segundos; recarregue para tentar novamente se a conexão falhar.`}>
      {editing && <form className="work-form" onSubmit={saveEdit}>
        <h3>Editar memória #{editing.id}</h3>
        <label>Título<input required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value as MemoryRow["kind"])}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Detalhes<textarea required maxLength={4000} value={detail} onChange={(e) => setDetail(e.target.value)} /></label>
        <label>Prazo · Brasília<input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="submit" disabled={busy}>Salvar edição</button>
        <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button>
      </form>}
      <label style={{ display: "block", marginBottom: 12 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar concluídos e arquivados</label>
      {!data ? <p>Carregando memória…</p> : !memories.length ? <p>Nenhuma memória {showInactive ? "encontrada" : "ativa"}.</p> : <div style={{ display: "grid", gap: 12 }}>{memories.map((row) => <article key={row.id} className="panel" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{row.title}</strong><span>{kindLabel[row.kind]} · {statusLabel[row.status]}</span></div>
        <p style={{ whiteSpace: "pre-wrap" }}>{row.detail}</p>
        <small>Prazo: {when(row.due_at)} · Atualizado: {when(row.updated_at)} · Origem: {row.created_by === "maia" ? `Maia${row.source_task_id ? ` · tarefa #${row.source_task_id}` : ""}` : "Painel do owner"}</small>
        {row.status === "active" && <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button disabled={busy} onClick={() => { setEditing(row); setTitle(row.title); setDetail(row.detail); setKind(row.kind); setDue(row.due_at ? new Date(Date.parse(row.due_at) - 3 * 3600000).toISOString().slice(0,16) : ""); }}>Editar</button><button disabled={busy} onClick={() => void update(row, "completed")}>Marcar concluído</button><button disabled={busy} onClick={() => void update(row, "archived")}>Arquivar</button></div>}
        {row.status !== "active" && <button disabled={busy} onClick={() => void update(row, "active")}>Reativar</button>}
      </article>)}</div>}
    </Panel>
  </>;
}
