import { useEffect, useState, type FormEvent } from "react";
import { PageHeader, Panel } from "../../components/ui";
import { supabase } from "../../lib/supabaseBrowser";
import { signOut } from "../auth/AuthGate";

// Pessoas e permissões. Só o proprietário altera: o banco recusa a escrita de qualquer outro usuário.
// Quem não é proprietário vê a lista, mas os controles ficam bloqueados.

type Role = "proprietario" | "aprovador" | "equipe";
const ROLE_LABEL: Record<Role, string> = { proprietario: "Proprietário", aprovador: "Aprovador", equipe: "Equipe" };

interface Catalog {
  code: string;
  label: string;
  description: string;
}

interface Person {
  id: string;
  name: string;
  role: Role;
  active: boolean;
  person_numbers: { number: string }[];
  person_permissions: { permission_code: string }[];
}

const NUMBER_RE = /^[0-9]{10,15}$/;

export function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    if (!supabase) return;
    const [peopleRes, catalogRes, ownerRes] = await Promise.all([
      supabase.from("people").select("id, name, role, active, person_numbers(number), person_permissions(permission_code)").order("created_at"),
      supabase.from("permission_catalog").select("code, label, description").order("code"),
      supabase.rpc("is_owner"),
    ]);
    const failure = peopleRes.error ?? catalogRes.error;
    if (failure) return setError(`Não consegui ler as pessoas: ${failure.message}`);
    setPeople((peopleRes.data ?? []) as unknown as Person[]);
    setCatalog((catalogRes.data ?? []) as Catalog[]);
    setIsOwner(ownerRes.data === true);
    setError(null);
  }

  useEffect(() => {
    void load();
  }, []);

  // Grava uma ação e recarrega. Mostra o motivo se o banco recusar.
  async function run(action: PromiseLike<{ error: { message: string } | null }>, done: string) {
    const result = await action;
    if (result.error) return setError(`Não foi possível salvar: ${result.error.message}`);
    setError(null);
    setNotice(done);
    await load();
  }

  async function togglePermission(person: Person, code: string, granted: boolean) {
    if (!supabase) return;
    const action = granted
      ? supabase.from("person_permissions").delete().eq("person_id", person.id).eq("permission_code", code)
      : supabase.from("person_permissions").insert({ person_id: person.id, permission_code: code });
    await run(action, granted ? "Permissão removida." : "Permissão concedida.");
  }

  async function setActive(person: Person, active: boolean) {
    if (!supabase) return;
    await run(supabase.from("people").update({ active }).eq("id", person.id), active ? "Pessoa reativada." : "Pessoa desativada.");
  }

  async function removeNumber(number: string) {
    if (!supabase) return;
    await run(supabase.from("person_numbers").delete().eq("number", number), "Número removido.");
  }

  return (
    <>
      <PageHeader
        eyebrow="Acesso"
        title="Pessoas"
        subtitle="Quem pode usar a Maia e o que cada pessoa pode fazer. Só o proprietário altera."
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <span>{isOwner ? "Você é o proprietário: pode alterar." : "Somente leitura: você não é o proprietário."}</span>
        <button type="button" className="button-quiet" onClick={() => void signOut()}>Sair</button>
      </div>
      {error && <p role="alert" className="empty-note">{error}</p>}
      {notice && !error && <p role="status" className="empty-note">{notice}</p>}

      {people.map((person) => {
        const granted = new Set(person.person_permissions.map((p) => p.permission_code));
        const locked = person.role === "proprietario";
        return (
          <Panel
            key={person.id}
            title={`${person.name} · ${ROLE_LABEL[person.role]}${person.active ? "" : " (desativada)"}`}
            caption={locked ? "O proprietário tem todas as permissões." : "Marque só o que esta pessoa pode fazer."}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <strong>Números</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {person.person_numbers.map((n) => (
                    <li key={n.number}>
                      {n.number}{" "}
                      {isOwner && !locked && person.person_numbers.length > 1 && (
                        <button type="button" className="text-button" onClick={() => void removeNumber(n.number)}>remover</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {isOwner && (
                <AddNumber personId={person.id} onDone={load} onError={setError} />
              )}
              {catalog.map((perm) => {
                const on = locked || granted.has(perm.code);
                return (
                  <label key={perm.code} style={{ display: "flex", gap: 8, alignItems: "flex-start" }} title={perm.description}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!isOwner || locked}
                      onChange={() => void togglePermission(person, perm.code, granted.has(perm.code))}
                    />
                    <span><strong>{perm.label}</strong><br /><small>{perm.description}</small></span>
                  </label>
                );
              })}
              {isOwner && !locked && (
                <div>
                  <button type="button" className="text-button" onClick={() => void setActive(person, !person.active)}>
                    {person.active ? "Desativar pessoa" : "Reativar pessoa"}
                  </button>
                </div>
              )}
            </div>
          </Panel>
        );
      })}

      {isOwner && <NewPersonForm onCreated={load} onError={setError} />}
    </>
  );
}

function NewPersonForm({ onCreated, onError }: { onCreated: () => Promise<void>; onError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("equipe");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const digits = number.replace(/\D/g, "");
    if (!NUMBER_RE.test(digits)) return onError("Número inválido: use DDI + DDD + número, só dígitos (ex.: 5585999999999).");
    setBusy(true);
    const { data, error } = await supabase.from("people").insert({ name: name.trim(), role }).select("id").single();
    if (error || !data) {
      setBusy(false);
      return onError(`Não foi possível cadastrar: ${error?.message ?? "sem resposta"}`);
    }
    const linked = await supabase.from("person_numbers").insert({ number: digits, person_id: (data as { id: string }).id });
    setBusy(false);
    if (linked.error) return onError(`Pessoa criada, mas o número não foi salvo: ${linked.error.message}`);
    setName("");
    setNumber("");
    await onCreated();
  }

  return (
    <Panel title="Cadastrar pessoa" caption="Depois de cadastrar, marque as permissões acima.">
      <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        <label style={{ display: "grid", gap: 4 }}>
          Nome
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Número do WhatsApp
          <input required inputMode="numeric" placeholder="5585999999999" value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          Papel
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="equipe">Equipe</option>
            <option value="aprovador">Aprovador</option>
          </select>
        </label>
        <button type="submit" className="button" disabled={busy}>{busy ? "Salvando…" : "Cadastrar"}</button>
      </form>
    </Panel>
  );
}

// Acrescenta um número a uma pessoa que já existe (uma pessoa pode ter vários números).
function AddNumber({ personId, onDone, onError }: { personId: string; onDone: () => Promise<void>; onError: (message: string) => void }) {
  const [number, setNumber] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const digits = number.replace(/D/g, "");
    if (!NUMBER_RE.test(digits)) return onError("Número inválido: use DDI + DDD + número, só dígitos.");
    const { error } = await supabase.from("person_numbers").insert({ number: digits, person_id: personId });
    if (error) return onError(`Não foi possível adicionar o número: ${error.message}`);
    setNumber("");
    await onDone();
  }
  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
      <input inputMode="numeric" placeholder="Adicionar número (5585999999999)" value={number} onChange={(e) => setNumber(e.target.value)} />
      <button type="submit" className="button-outline">Adicionar</button>
    </form>
  );
}
