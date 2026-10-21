import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { PageHeader, Panel } from "../../components/ui";
import { formatWhen } from "../../lib/snapshotApi";
import { useSnapshot } from "../../lib/useSnapshot";
import { useOrganization, type OrganizationData, type RegisteredGroupRow } from "../../lib/organizationApi";
import { OrganizationFeedback } from "../organization/OrganizationFeedback";

type LiveRow = { jid: string; subject: string; size: number | null; messages7d: number | null; recordedMessages?: number | null; lastActivity: string | null };
export function GruposPage() {
  const { snapshot, error: snapshotError } = useSnapshot();
  const { data, error, notice, reload, save, busy } = useOrganization();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("todos");
  const [client, setClient] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const registrations = new Map((data?.groups ?? []).map((g) => [g.jid, g]));
  const rows: LiveRow[] = [...(snapshot?.groups.groups ?? [])];
  const known = new Set(rows.map((g) => g.jid));
  for (const g of data?.groups ?? []) if (!known.has(g.jid)) rows.push({ jid: g.jid, subject: g.name, size: null, messages7d: null, recordedMessages: null, lastActivity: null });
  const visible = rows.filter((g) => {
    const reg = registrations.get(g.jid);
    const text = (g.subject + " " + (data?.clients.find((c) => c.id === reg?.client_id)?.name ?? "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return text.includes(query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()) &&
      (filter === "todos" || (filter === "cadastrados" ? Boolean(reg) : filter === "pendentes" ? !reg : reg?.kind === filter)) &&
      (!client || reg?.client_id === client);
  });
  const row = rows.find((g) => g.jid === selected);
  return <>
    <PageHeader eyebrow="Grupos e clientes" title="Grupos do WhatsApp" subtitle="Acompanhe os grupos cadastrados, identifique cada cliente e escolha quem pode solicitar ações à Maia." />
    <OrganizationFeedback error={error} notice={notice} reload={reload} />
    {(snapshotError || snapshot?.groups.error) && <p className="empty-note" role="alert">A lista do WhatsApp não pôde ser atualizada. {snapshot?.groups.error ?? snapshotError}</p>}
    {!snapshot && !data && !error ? <p className="empty-note">Carregando grupos…</p> : <>
      <Panel title="Seus grupos" caption={`${visible.length} de ${rows.length} grupo(s) · contador acumulado dos grupos com atividade recente`}>
        <div className="organization-toolbar">
          <label className="people-search"><Search size={16} /><span className="sr-only">Buscar grupo ou cliente</span><input type="search" placeholder="Grupo ou cliente" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          <label><span className="sr-only">Filtrar grupos</span><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="todos">Todos os grupos</option><option value="cadastrados">Cadastrados na Maia</option><option value="cliente">Grupos de clientes</option><option value="interno">Grupos internos</option><option value="pendentes">Não cadastrados</option></select></label>
          <label><span className="sr-only">Filtrar por cliente</span><select value={client} onChange={(e) => setClient(e.target.value)}><option value="">Todos os clientes</option>{data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div className="table-wrap"><table><thead><tr><th>Grupo</th><th>Cliente / equipe</th><th>Maia atende</th><th>Pessoas</th><th>Mensagens registradas (acumulado)</th><th>Última atividade</th><th>Ação</th></tr></thead><tbody>{visible.map((g) => {
          const reg = registrations.get(g.jid);
          const c = data?.clients.find((c) => c.id === reg?.client_id);
          const access = data?.accessGroups.find((a) => a.id === reg?.access_group_id);
          return <tr key={g.jid}><td><strong>{g.subject}</strong>{access && <small className="organization-cell-note">Acesso: {access.name}</small>}</td><td>{!data ? "Cadastro indisponível" : reg?.kind === "cliente" ? c?.name ?? "Cliente" : reg ? "Equipe interna" : "Não classificado"}</td><td>{!data ? "—" : reg?.active && (!c || c.active) && (!access || access.active) ? "Ativo" : "Pausado"}</td><td>{g.size ?? "—"}</td><td>{g.recordedMessages ?? "Sem registro"}</td><td>{g.lastActivity ? formatWhen(g.lastActivity) : "Sem atividade"}</td><td><button type="button" className="text-button" disabled={!data || busy} onClick={() => setSelected(g.jid)}>Organizar</button></td></tr>;
        })}</tbody></table></div>
        {!visible.length && <p className="empty-note">Nenhum grupo corresponde aos filtros.</p>}
      </Panel>
      {row && data && <GroupForm key={`${row.jid}:${registrations.get(row.jid)?.revision ?? "new"}`} row={row} registration={registrations.get(row.jid) ?? null} data={data} busy={busy} onCancel={() => setSelected(null)} onSave={async (input) => { if (await save("group_save", input)) { setSelected(null); } }} />}
      <Panel title="Acesso por equipe ou cliente"><p className="empty-note">Vincule o grupo a um cliente e a um grupo de acesso. Só os membros autorizados poderão solicitar ações, além do proprietário. O histórico usado em um grupo de cliente fica restrito ao cliente atual.</p><a href="#acessos/grupos-acesso" className="text-button">Gerenciar grupos de acesso →</a></Panel>
    </>}
  </>;
}
function GroupForm({ row, registration, data, busy, onSave, onCancel }: { row: LiveRow; registration: RegisteredGroupRow | null; data: OrganizationData; busy: boolean; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState(registration?.kind ?? "interno");
  const [clientId, setClientId] = useState(registration?.client_id ?? "");
  const [accessId, setAccessId] = useState(registration?.access_group_id ?? "");
  const [active, setActive] = useState(registration?.active ?? false);
  const [revision] = useState(registration?.revision);
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ jid: row.jid, revision, kind, client_id: kind === "cliente" ? clientId || null : null, access_group_id: accessId || null, active }); };
  return <Panel title={`Organizar · ${row.subject}`}><form className="organization-form" onSubmit={(e) => void submit(e)}>
    <div className="organization-form-grid"><label>Tipo do grupo<select value={kind} disabled={busy} onChange={(e) => { setKind(e.target.value as "interno" | "cliente"); setClientId(""); setAccessId(""); }}><option value="interno">Equipe interna</option><option value="cliente">Grupo de cliente</option></select></label>
      {kind === "cliente" && <label>Cliente<select required value={clientId} disabled={busy} onChange={(e) => { setClientId(e.target.value); setAccessId(""); }}><option value="">Selecione o cliente</option>{data.clients.map((c) => <option key={c.id} value={c.id} disabled={!c.active}>{c.name}{!c.active && " · pausado"}</option>)}</select></label>}
      <label>Grupo de acesso<select value={accessId} disabled={busy} onChange={(e) => setAccessId(e.target.value)}><option value="">{kind === "cliente" ? "Membros autorizados deste cliente" : "Permissões individuais"}</option>{data.accessGroups.filter((a) => a.active && a.client_id === (kind === "cliente" ? clientId : null)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    </div><label className="organization-checkbox"><input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} /> Permitir que Maia atenda neste grupo</label>
    <p className="empty-note">Ao ativar, as mensagens passam a compor o contexto do grupo por 7 dias. A Maia responde quando é chamada e respeita as permissões de quem pediu.</p>
    <div className="organization-actions"><button type="submit" className="button button-dark" disabled={busy || (kind === "cliente" && !clientId)}>{busy ? "Salvando…" : "Salvar organização"}</button><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>Cancelar</button></div>
  </form></Panel>;
}
