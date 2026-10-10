import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, LockKeyhole, LogOut, Phone, Plus, Search, ShieldCheck, Users, X } from "lucide-react";
import { PageHeader, Panel } from "../../components/ui";
import { supabase } from "../../lib/supabaseBrowser";
import { signOut } from "../auth/AuthGate";

type Role = "proprietario" | "aprovador" | "equipe";
const ROLE_LABEL: Record<Role, string> = { proprietario: "Proprietário", aprovador: "Aprovador", equipe: "Equipe" };
interface Catalog { code: string; label: string; description: string }
interface Person {
  id: string; name: string; role: Role; active: boolean;
  person_numbers: { number: string }[];
  person_permissions: { permission_code: string }[];
}
const NUMBER_RE = /^[0-9]{10,15}$/;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
function formatNumber(number: string) {
  if (/^55\d{11}$/.test(number)) return `+55 (${number.slice(2, 4)}) ${number.slice(4, 9)}-${number.slice(9)}`;
  if (/^55\d{10}$/.test(number)) return `+55 (${number.slice(2, 4)}) ${number.slice(4, 8)}-${number.slice(8)}`;
  return `+${number}`;
}

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"todas" | "ativas" | "inativas">("todas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);

  async function load() {
    try {
      if (!supabase) throw new Error("A conexão para carregar pessoas não está configurada.");
      const [peopleRes, catalogRes, ownerRes] = await Promise.all([
        supabase.from("people").select("id, name, role, active, person_numbers(number), person_permissions(permission_code)").order("created_at"),
        supabase.from("permission_catalog").select("code, label, description").order("code"),
        supabase.rpc("is_owner"),
      ]);
      const failure = peopleRes.error ?? catalogRes.error ?? ownerRes.error;
      if (failure) throw new Error(failure.message);
      setPeople((peopleRes.data ?? []) as unknown as Person[]);
      setCatalog((catalogRes.data ?? []) as Catalog[]);
      setIsOwner(ownerRes.data === true);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar as pessoas."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  // A autorização continua no banco; o bloqueio de cliques evita gravações concorrentes.
  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, done: string) {
    if (!isOwner || saving.current) return;
    saving.current = true; setBusy(true); setNotice(null); setError(null);
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      await load(); setNotice(done);
    } catch (cause) { setError(`Não foi possível salvar: ${cause instanceof Error ? cause.message : "tente novamente"}`); }
    finally { saving.current = false; setBusy(false); }
  }
  async function togglePermission(person: Person, code: string, granted: boolean) {
    if (!supabase || person.role === "proprietario") return;
    const db = supabase;
    await run(() => granted
      ? db.from("person_permissions").delete().eq("person_id", person.id).eq("permission_code", code)
      : db.from("person_permissions").insert({ person_id: person.id, permission_code: code }), granted ? "Permissão removida." : "Permissão concedida.");
  }
  async function setActive(person: Person) {
    if (!supabase || person.role === "proprietario") return;
    const db = supabase;
    await run(() => db.from("people").update({ active: !person.active }).eq("id", person.id), person.active ? "Pessoa desativada." : "Pessoa reativada.");
  }
  async function removeNumber(person: Person, number: string) {
    if (!supabase || person.role === "proprietario" || person.person_numbers.length <= 1) return;
    const db = supabase;
    await run(() => db.from("person_numbers").delete().eq("person_id", person.id).eq("number", number), "Número removido.");
  }

  const search = normalize(query.trim());
  const digits = query.replace(/\D/g, "");
  const visible = people.filter((person) =>
    (!search || normalize(person.name).includes(search) || (digits && person.person_numbers.some((n) => n.number.includes(digits)))) &&
    (filter === "todas" || (filter === "ativas" ? person.active : !person.active)));
  const selected = visible.find((person) => person.id === selectedId) ?? visible[0];
  const locked = selected?.role === "proprietario";
  const granted = new Set(selected?.person_permissions.map((permission) => permission.permission_code));
  const permissionCount = locked ? catalog.length : catalog.filter((permission) => granted.has(permission.code)).length;
  const activeCount = people.filter((person) => person.active).length;

  function selectPerson(id: string) { setSelectedId(id); setCreating(false); setMobileDetail(true); setNotice(null); }
  function startCreate() { setCreating(true); setMobileDetail(true); setNotice(null); }
  async function created(id: string) {
    await load(); setQuery(""); setFilter("todas"); setSelectedId(id); setCreating(false);
    setNotice("Pessoa cadastrada. Agora escolha as permissões de acesso.");
  }

  return <div className="people-page">
    <PageHeader eyebrow="Equipe & acessos" title="Pessoas" subtitle="Uma visão clara de quem faz parte da operação e como pode usar a Maia."
      action={<div className="people-heading-actions"><button className="button button-outline" type="button" onClick={() => void signOut()}><LogOut size={15} /> Sair</button>{isOwner && <button className="button button-dark" type="button" onClick={startCreate}><Plus size={16} /> Nova pessoa</button>}</div>} />
    <div className="people-summary" aria-label="Resumo das pessoas">
      {[{ label: "Pessoas cadastradas", value: people.length, detail: "na sua operação", icon: Users }, { label: "Acessos ativos", value: activeCount, detail: "cadastros habilitados", icon: Check }, { label: "Acessos desativados", value: people.length - activeCount, detail: "cadastros pausados", icon: LockKeyhole }].map(({ label, value, detail, icon: Icon }) =>
        <div className="people-stat" key={label}><div><span>{label}</span><strong>{loading ? "—" : value}</strong><small>{detail}</small></div><span className="people-stat-icon"><Icon size={20} /></span></div>)}
    </div>
    <div className="people-access-note"><ShieldCheck size={16} /><span>{loading ? "Verificando seu acesso…" : isOwner ? "Você gerencia os acessos desta operação." : "Você está em modo de consulta. Apenas o proprietário altera acessos."}</span><span className="people-access-label">{loading ? "Carregando" : isOwner ? "Proprietário" : "Somente leitura"}</span></div>
    {error && <div role="alert" className="people-feedback people-feedback-error">{error}<button className="text-button" type="button" onClick={() => void load()}>Atualizar dados</button></div>}
    {notice && !error && <div role="status" className="people-feedback"><Check size={16} />{notice}</div>}
    <div className={`people-layout ${mobileDetail ? "people-layout-detail" : ""}`}>
      <Panel className="people-directory" title="Sua equipe" caption="Selecione uma pessoa para ver os acessos." action={<span className="people-count">{loading ? "—" : visible.length}</span>}>
        <label className="people-search"><Search size={16} /><span className="sr-only">Buscar por nome ou WhatsApp</span><input type="search" placeholder="Nome ou WhatsApp" value={query} onChange={(event) => { setQuery(event.target.value); setMobileDetail(false); }} /></label>
        <div className="people-filters" role="group" aria-label="Filtrar por status">{(["todas", "ativas", "inativas"] as const).map((value) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setMobileDetail(false); }}>{value === "todas" ? "Todas" : value === "ativas" ? "Ativas" : "Desativadas"}</button>)}</div>
        <div className="people-list" aria-busy={loading}>
          {loading ? <p className="people-empty">Carregando sua equipe…</p> : visible.length === 0 ? <div className="people-empty"><Users size={26} /><strong>{people.length ? "Nenhum resultado" : "Sua equipe começa aqui"}</strong><p>{people.length ? "Tente outro nome, número ou filtro." : "Cadastre a primeira pessoa para organizar os acessos."}</p></div> : visible.map((person) =>
            <button type="button" className="people-list-item" key={person.id} aria-pressed={!creating && selected?.id === person.id} onClick={() => selectPerson(person.id)}>
              <span className={`people-avatar people-avatar-${person.role}`}>{initials(person.name)}</span><span className="people-list-info"><strong>{person.name}</strong><small>{ROLE_LABEL[person.role]}<span aria-hidden="true"> · </span>{person.active ? "Ativa" : "Desativada"}</small></span><ChevronRight size={16} />
            </button>)}
        </div>
      </Panel>
      <div className="people-detail">
        <button className="text-button people-mobile-back" type="button" onClick={() => { setMobileDetail(false); setCreating(false); }}><ArrowLeft size={16} /> Voltar para pessoas</button>
        {creating && isOwner ? <NewPersonForm onCreated={created} onCancel={() => { setCreating(false); setMobileDetail(false); }} onError={setError} /> : selected ? <Panel className="people-profile">
          <div className="people-profile-heading"><span className={`people-avatar people-avatar-large people-avatar-${selected.role}`}>{initials(selected.name)}</span><div><span className="people-overline">Perfil de acesso</span><h2>{selected.name}</h2><span className="people-role">{ROLE_LABEL[selected.role]}</span></div><span className={`people-status ${selected.active ? "people-status-active" : "people-status-inactive"}`}><i />{selected.active ? "Ativa" : "Desativada"}</span></div>
          <section className="people-detail-section" aria-label="Números do WhatsApp"><div className="people-section-heading"><h3><Phone size={16} /> WhatsApp</h3><span>{selected.person_numbers.length} {selected.person_numbers.length === 1 ? "número" : "números"}</span></div><p className="people-section-description">Números vinculados a esta pessoa para falar com a Maia.</p>
            <div className="people-number-chips">{selected.person_numbers.map((n) => <span className="people-number-chip" key={n.number}>{formatNumber(n.number)}{isOwner && !locked && selected.person_numbers.length > 1 && <button type="button" disabled={busy} aria-label={`Remover número ${formatNumber(n.number)}`} onClick={() => void removeNumber(selected, n.number)}><X size={14} /></button>}</span>)}</div>
            {selected.person_numbers.length === 0 && <p className="people-section-description">Nenhum número vinculado.</p>}
            {isOwner && <AddNumber key={selected.id} personId={selected.id} onDone={load} onError={setError} disabled={busy} />}
          </section>
          <section className="people-detail-section" aria-label="Permissões"><div className="people-section-heading"><h3><ShieldCheck size={16} /> Permissões de acesso</h3><span>{permissionCount} de {catalog.length}</span></div><p className="people-section-description">{locked ? "O proprietário tem acesso a todas as permissões." : "Confira o que esta pessoa pode solicitar à Maia."}{!locked && isOwner && " Alterações são salvas automaticamente."}</p>
            <div className="people-permissions">{catalog.map((perm) => { const on = locked || granted.has(perm.code); return <label key={perm.code} className={`people-permission ${on ? "people-permission-on" : ""}`}><input type="checkbox" checked={on} disabled={!isOwner || locked || busy} onChange={() => void togglePermission(selected, perm.code, granted.has(perm.code))} /><span><strong>{perm.label}</strong><small>{perm.description}</small></span>{on && <Check size={15} className="people-permission-check" aria-hidden="true" />}</label>; })}</div>
          </section>
          {isOwner && !locked && <div className="people-profile-footer"><div><strong>{selected.active ? "Pausar este acesso" : "Retomar este acesso"}</strong><small>{selected.active ? "O cadastro e suas permissões serão mantidos." : "Reative a pessoa com as permissões atuais."}</small></div><button className={`button ${selected.active ? "button-danger-quiet" : "button-outline"}`} type="button" disabled={busy} onClick={() => void setActive(selected)}>{busy ? "Salvando…" : selected.active ? "Desativar" : "Reativar"}</button></div>}
        </Panel> : <Panel className="people-profile"><div className="people-empty"><ShieldCheck size={30} /><strong>Os acessos, em um só lugar</strong><p>{loading ? "Os perfis aparecerão assim que os dados forem carregados." : "Selecione uma pessoa ou cadastre um novo integrante."}</p>{isOwner && <button className="button button-dark" type="button" onClick={startCreate}><Plus size={16} /> Nova pessoa</button>}</div></Panel>}
      </div>
    </div>
  </div>;
}

function NewPersonForm({ onCreated, onCancel, onError }: { onCreated: (id: string) => Promise<void>; onCancel: () => void; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("equipe");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || saving.current) return;
    if (!name.trim()) return onError("Informe o nome da pessoa.");
    const digits = number.replace(/\D/g, "");
    if (!NUMBER_RE.test(digits)) return onError("Número inválido: use DDI + DDD + número (ex.: 5585999999999).");
    saving.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.from("people").insert({ name: name.trim(), role }).select("id").single();
      if (error || !data) throw new Error(`Não foi possível cadastrar: ${error?.message ?? "sem resposta"}`);
      const id = (data as { id: string }).id;
      const linked = await supabase.from("person_numbers").insert({ number: digits, person_id: id });
      // Se só o número falhar, abre o cadastro já salvo para corrigir sem criar outra pessoa.
      await onCreated(id);
      if (linked.error) onError(`Pessoa criada, mas o número não foi salvo: ${linked.error.message}. Adicione o número no perfil.`);
    } catch (cause) { onError(cause instanceof Error ? cause.message : "Não foi possível cadastrar a pessoa."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Panel className="people-profile people-create" title="Nova pessoa" caption="Adicione um integrante e defina os acessos no próximo passo.">
    <form className="people-form" onSubmit={submit}><fieldset disabled={busy}><label>Nome completo<input autoFocus required autoComplete="name" placeholder="Como a pessoa se chama?" value={name} onChange={(e) => setName(e.target.value)} /></label><label>WhatsApp<input required type="tel" autoComplete="tel" placeholder="+55 (85) 99999-9999" value={number} onChange={(e) => setNumber(e.target.value)} /><small>Inclua o código do país e o DDD.</small></label><label>Papel na operação<select value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="equipe">Equipe</option><option value="aprovador">Aprovador</option></select><small>As permissões individuais são escolhidas após o cadastro.</small></label></fieldset><div className="people-form-actions"><button className="button button-outline" type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button type="submit" className="button button-dark" disabled={busy}>{busy ? "Cadastrando…" : "Cadastrar pessoa"}<ArrowRight size={16} /></button></div></form>
  </Panel>;
}

function AddNumber({ personId, onDone, onError, disabled }: { personId: string; onDone: () => Promise<void>; onError: (message: string) => void; disabled: boolean }) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || saving.current || disabled) return;
    const digits = number.replace(/\D/g, "");
    if (!NUMBER_RE.test(digits)) return onError("Número inválido: use DDI + DDD + número.");
    saving.current = true; setBusy(true);
    try {
      const { error } = await supabase.from("person_numbers").insert({ number: digits, person_id: personId });
      if (error) throw new Error(error.message);
      setNumber(""); await onDone();
    } catch (cause) { onError(`Não foi possível adicionar o número: ${cause instanceof Error ? cause.message : "tente novamente"}`); }
    finally { saving.current = false; setBusy(false); }
  }
  return <form className="people-add-number" onSubmit={submit}><label className="sr-only" htmlFor={`number-${personId}`}>Adicionar WhatsApp</label><input id={`number-${personId}`} required type="tel" placeholder="Adicionar outro WhatsApp" value={number} disabled={busy || disabled} onChange={(e) => setNumber(e.target.value)} /><button className="button button-outline" type="submit" disabled={busy || disabled || !number.trim()}><Plus size={14} />{busy ? "Salvando…" : "Adicionar"}</button></form>;
}
