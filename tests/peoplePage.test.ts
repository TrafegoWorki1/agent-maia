// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeoplePage } from "../src/features/people/PeoplePage";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), insertNumber: vi.fn(), insertPerson: vi.fn(), updatePerson: vi.fn(), insertPermission: vi.fn() }));
vi.mock("../src/lib/supabaseBrowser", () => ({ supabase: db }));
vi.mock("../src/features/auth/AuthGate", () => ({ signOut: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const fixtures = [
  { id: "owner", name: "Marina Silva", role: "proprietario", active: true, person_numbers: [{ number: "5585999999999" }], person_permissions: [] },
  { id: "team", name: "Jéssica Souza", role: "equipe", active: true, person_numbers: [{ number: "5585988888888" }], person_permissions: [{ permission_code: "conversa.maia" }] },
  { id: "paused", name: "Pedro Lima", role: "aprovador", active: false, person_numbers: [{ number: "5585977777777" }], person_permissions: [] },
];
const catalog = [
  { code: "conversa.maia", label: "Conversar com a Maia", description: "Solicitar ajuda nas conversas." },
  { code: "mensagem.enviar", label: "Enviar mensagens", description: "Enviar mensagens nos grupos permitidos." },
];
let people = structuredClone(fixtures);
let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  people = structuredClone(fixtures);
  db.rpc.mockResolvedValue({ data: true, error: null });
  db.insertNumber.mockResolvedValue({ error: null });
  db.insertPerson.mockImplementation((person) => {
    people.push({ ...person, id: "new", active: true, person_numbers: [], person_permissions: [] });
    return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
  });
  db.updatePerson.mockImplementation((patch) => ({ eq: async (_column: string, id: string) => {
    Object.assign(people.find((p) => p.id === id)!, patch);
    return { error: null };
  } }));
  db.insertPermission.mockImplementation((grant) => {
    people.find((p) => p.id === grant.person_id)!.person_permissions.push({ permission_code: grant.permission_code });
    return Promise.resolve({ error: null });
  });
  db.from.mockImplementation((table: string) => {
    if (table === "people") return { select: () => ({ order: async () => ({ data: structuredClone(people), error: null }) }), insert: db.insertPerson, update: db.updatePerson };
    if (table === "permission_catalog") return { select: () => ({ order: async () => ({ data: catalog, error: null }) }) };
    if (table === "person_numbers") return { insert: db.insertNumber };
    if (table === "person_permissions") return { insert: db.insertPermission };
    throw new Error(`Unexpected table: ${table}`);
  });
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  document.body.innerHTML = "";
  root = undefined;
});

async function render() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(PeoplePage)));
}
function button(label: string) {
  const result = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function selectTeam() {
  await click([...host.querySelectorAll<HTMLButtonElement>(".people-list-item")].find((b) => b.textContent?.includes("Jéssica"))!);
}

describe("Pessoas: diretório e perfil de acesso", () => {
  it("resume cadastros reais e protege todas as permissões do proprietário", async () => {
    await render();
    expect([...host.querySelectorAll(".people-stat strong")].map((n) => n.textContent)).toEqual(["3", "2", "1"]);
    expect(host.querySelector(".people-profile h2")?.textContent).toBe("Marina Silva");
    const checkboxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.checked && checkbox.disabled)).toBe(true);
    expect(host.querySelector(".people-profile-footer")).toBeNull();
  });
  it("busca nomes sem acento e telefones formatados, e filtra desativados", async () => {
    await render();
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    await type(search, "jessica");
    expect(host.querySelectorAll(".people-list-item")).toHaveLength(1);
    expect(host.querySelector(".people-profile h2")?.textContent).toBe("Jéssica Souza");
    await type(search, "+55 (85) 97777-7777");
    expect(host.querySelector(".people-profile h2")?.textContent).toBe("Pedro Lima");
    await type(search, ""); await click(button("Desativadas"));
    expect(host.querySelectorAll(".people-list-item")).toHaveLength(1);
    expect(host.querySelector(".people-status")?.textContent).toBe("Desativada");
    await click(button("Reativar"));
    expect(db.updatePerson).toHaveBeenCalledWith({ active: true });
    expect(host.querySelector(".people-directory")?.textContent).toContain("Nenhum resultado");
  });
  it("somente leitura não oferece criação, números ou alterações de acesso", async () => {
    db.rpc.mockResolvedValue({ data: false, error: null });
    await render(); await selectTeam();
    expect(host.textContent).toContain("modo de consulta");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("Nova pessoa"))).toBe(false);
    expect(host.querySelector(".people-add-number")).toBeNull();
    expect(host.querySelector(".people-profile-footer")).toBeNull();
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((c) => c.disabled)).toBe(true);
  });
  it("adiciona WhatsApp normalizado à pessoa selecionada e permite voltar à lista", async () => {
    await render(); await selectTeam();
    expect(host.querySelector(".people-layout")?.classList.contains("people-layout-detail")).toBe(true);
    await type(host.querySelector<HTMLInputElement>(".people-add-number input")!, "+55 (85) 96666-6666");
    await click(button("Adicionar"));
    expect(db.insertNumber).toHaveBeenCalledExactlyOnceWith({ number: "5585966666666", person_id: "team" });
    expect(host.querySelector<HTMLInputElement>(".people-add-number input")?.value).toBe("");
    await click(button("Voltar para pessoas"));
    expect(host.querySelector(".people-layout")?.classList.contains("people-layout-detail")).toBe(false);
  });
  it("salva permissão no perfil selecionado e atualiza o estado visível", async () => {
    await render(); await selectTeam();
    const checkbox = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((c) => !c.checked)!;
    await click(checkbox);
    expect(db.insertPermission).toHaveBeenCalledExactlyOnceWith({ person_id: "team", permission_code: "mensagem.enviar" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Permissão concedida");
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((c) => c.checked)).toBe(true);
  });
  it("se o WhatsApp falha no cadastro, abre a pessoa salva sem oferecer cadastro duplicado", async () => {
    db.insertNumber.mockResolvedValue({ error: { message: "Número já cadastrado" } });
    await render(); await click(button("Nova pessoa"));
    await type(host.querySelector<HTMLInputElement>('.people-form input[autocomplete="name"]')!, "Ana Costa");
    await type(host.querySelector<HTMLInputElement>('.people-form input[type="tel"]')!, "+55 (85) 95555-5555");
    await click(button("Cadastrar pessoa"));
    expect(db.insertPerson).toHaveBeenCalledExactlyOnceWith({ name: "Ana Costa", role: "equipe" });
    expect(host.querySelector(".people-profile h2")?.textContent).toBe("Ana Costa");
    expect(host.querySelector(".people-form")).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Pessoa criada, mas o número não foi salvo");
  });
  it("expõe falha na verificação do proprietário e mantém controles de escrita ocultos", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "Não foi possível verificar acesso" } });
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível verificar acesso");
    expect(host.querySelector(".people-form")).toBeNull();
    expect(host.querySelector(".people-add-number")).toBeNull();
    expect(db.insertNumber).not.toHaveBeenCalled();
  });
});
