import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Panel } from "../../components/ui";
import { useOrganization, type AccessGroupRow, type OrganizationData } from "../../lib/organizationApi";
import { OrganizationFeedback } from "./OrganizationFeedback";

export function AccessGroupsPage() {
  const { data, error, notice, reload, save, busy } = useOrganization();
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const group = data?.accessGroups.find((g) => g.id === selected);
  return <>
    <PageHeader eyebrow="Equipe e acessos" title="Grupos de acesso" subtitle="Organize pessoas e permissões por equipe ou cliente. As permissões do cliente valem nos grupos dele." action={<button type="button" className="button button-dark" disabled={!data || busy} onClick={() => setSelected("new")}><Plus size={16} /> Novo grupo de acesso</button>} />
    <OrganizationFeedback error={error} notice={notice} reload={reload} />
    {!data ? !error && <p className="empty-note">Carregando grupos de acesso…</p> : <div className="organization-layout">
      <Panel title="Equipes e acessos" caption={`${data.accessGroups.length} grupo(s)`}><div className="organization-directory">{data.accessGroups.map((g) => <button key={g.id} type="button" aria-pressed={selected === g.id} disabled={busy} onClick={() => setSelected(g.id)}><span><strong>{g.name}</strong><small>{g.client_id ? data.clients.find((c) => c.id === g.client_id)?.name ?? "Cliente" : "Equipe interna"} · {g.members.length} pessoa(s) · {g.permissions.length} permissão(ões)</small></span><span className="organization-tag">{g.active ? "Ativo" : "Pausado"}</span></button>)}</div>{!data.accessGroups.length && <p className="empty-note">Crie o primeiro grupo para reunir membros e suas permissões.</p>}</Panel>
      {selected === "new" || group ? <AccessGroupForm key={`${selected}:${group?.revision ?? "new"}`} data={data} group={group ?? null} busy={busy} onCancel={() => setSelected(null)} onSave={async (input) => { if (await save("access_group_save", input)) setSelected(null); }} /> : <Panel title="Permissões em um só cadastro"><p className="empty-note">Um grupo de acesso é uma equipe com permissões compartilhadas. Você pode vinculá-lo a um grupo do WhatsApp para limitar quem pode pedir ações ali.</p><p className="empty-note">O proprietário administra esses cadastros. Aprovação de ações continua individual.</p><a className="text-button" href="#acessos/pessoas">Gerenciar acessos individuais →</a></Panel>}
    </div>}
  </>;
}
function AccessGroupForm({ data, group, busy, onSave, onCancel }: { data: OrganizationData; group: AccessGroupRow | null; busy: boolean; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [clientId, setClientId] = useState(group?.client_id ?? "");
  const [active, setActive] = useState(group?.active ?? true);
  const [members, setMembers] = useState(group?.members ?? []);
  const [permissions, setPermissions] = useState(group?.permissions ?? []);
  const [revision] = useState(group?.revision);
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ ...(group ? { id: group.id, revision } : {}), name, client_id: clientId || null, active, members, permissions }); };
  return <Panel title={group ? "Editar grupo de acesso" : "Novo grupo de acesso"}><form className="organization-form" onSubmit={(e) => void submit(e)}>
    <label>Nome do grupo<input required maxLength={100} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
    <label>Cliente ou equipe<select value={clientId} disabled={busy} onChange={(e) => setClientId(e.target.value)}><option value="">Equipe interna</option>{data.clients.map((c) => <option key={c.id} value={c.id} disabled={!c.active}>{c.name}{!c.active && " · pausado"}</option>)}</select></label>
    <label className="organization-checkbox"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} /> Grupo de acesso ativo</label>
    <fieldset disabled={busy}><legend>Pessoas</legend><div className="organization-checks">{data.people.filter((p) => p.role !== "proprietario").map((p) => <label className="organization-checkbox" key={p.id}><input type="checkbox" checked={members.includes(p.id)} onChange={() => setMembers(toggle(members, p.id))} /> {p.name}{!p.active && " · acesso pausado"}</label>)}</div><a className="text-button" href="#acessos/pessoas">Cadastrar ou editar pessoa →</a></fieldset>
    <fieldset disabled={busy}><legend>Permissões compartilhadas</legend><p className="empty-note">{clientId ? "Aplicadas somente nos grupos do cliente selecionado." : "Somadas às permissões individuais dos membros em toda a operação."}</p><div className="people-permissions">{data.permissions.filter((p) => p.code !== "escrita.aprovar").map((p) => <label className="people-permission" key={p.code}><input type="checkbox" checked={permissions.includes(p.code)} onChange={() => setPermissions(toggle(permissions, p.code))} /><span><strong>{p.label}</strong><small>{p.description}</small></span></label>)}</div></fieldset>
    <div className="organization-actions"><button type="submit" className="button button-dark" disabled={busy || !name.trim()}>{busy ? "Salvando…" : "Salvar grupo de acesso"}</button><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>Cancelar</button></div>
  </form></Panel>;
}
