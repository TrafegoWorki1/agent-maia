import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { PageHeader, Panel } from "../../components/ui";
import { useOrganization, type ClientRow } from "../../lib/organizationApi";
import { OrganizationFeedback } from "./OrganizationFeedback";

export function ClientsPage() {
  const { data, error, notice, reload, save, busy } = useOrganization();
  const [selected, setSelected] = useState<string | null>(null);
  const client = data?.clients.find((c) => c.id === selected);
  return <>
    <PageHeader eyebrow="Grupos e clientes" title="Clientes" subtitle="Identifique de quem são os grupos e organize cada atendimento no seu próprio contexto." action={<button type="button" className="button button-dark" disabled={!data || busy} onClick={() => setSelected("new")}><Plus size={16} /> Novo cliente</button>} />
    <OrganizationFeedback error={error} notice={notice} reload={reload} />
    {!data ? !error && <p className="empty-note">Carregando clientes…</p> : <div className="organization-layout">
      <Panel title="Seus clientes" caption={`${data.clients.length} cadastro(s)`}>
        <div className="organization-directory">{data.clients.map((client) => <button key={client.id} type="button" disabled={busy} aria-pressed={selected === client.id} onClick={() => setSelected(client.id)}><span><strong>{client.name}</strong><small>{data.groups.filter((g) => g.client_id === client.id).length} grupo(s) do WhatsApp</small></span><span className="organization-tag">{client.active ? "Ativo" : "Pausado"}</span></button>)}</div>
        {!data.clients.length && <p className="empty-note">Cadastre um cliente e depois associe os grupos em Grupos do WhatsApp.</p>}
      </Panel>
      {selected === "new" || client ? <ClientForm key={`${selected}:${client?.revision ?? "new"}`} client={client ?? null} busy={busy} onCancel={() => setSelected(null)} onSave={async (input) => { if (await save("client_save", input)) setSelected(null); }} /> : <Panel title="Atendimento por cliente"><p className="empty-note">Selecione um cliente para editar. Ao pausar um cliente, a Maia interrompe o atendimento nos grupos vinculados.</p><a className="text-button" href="#grupos-clientes/grupos">Organizar grupos do WhatsApp →</a></Panel>}
    </div>}
  </>;
}
function ClientForm({ client, busy, onSave, onCancel }: { client: ClientRow | null; busy: boolean; onSave: (v: unknown) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(client?.name ?? "");
  const [active, setActive] = useState(client?.active ?? true);
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ ...(client ? { id: client.id, revision: client.revision } : {}), name: name.trim(), active }); };
  return <Panel title={client ? "Editar cliente" : "Novo cliente"}><form className="organization-form" onSubmit={(e) => void submit(e)}><label>Nome do cliente<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} /></label><label className="organization-checkbox"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} /> Cliente ativo</label><div className="organization-actions"><button type="submit" className="button button-dark" disabled={busy || !name.trim()}>{busy ? "Salvando…" : "Salvar cliente"}</button><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>Cancelar</button></div></form></Panel>;
}
