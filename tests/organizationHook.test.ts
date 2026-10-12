// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOrganization } from "../src/lib/organizationApi";

vi.mock("../src/lib/supabaseBrowser", () => ({ supabase: null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const request = vi.fn();
const data = { clients: [], groups: [], accessGroups: [], people: [], permissions: [] };
let state: ReturnType<typeof useOrganization>;
let root: Root;
function Probe() { state = useOrganization(); return null; }
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });
beforeEach(async () => {
  request.mockReset(); request.mockResolvedValue(response(data)); vi.stubGlobal("fetch", request);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

describe("salvar e atualizar cadastros", () => {
  it("confirma o salvamento mesmo quando a releitura falha, sem repetir a escrita", async () => {
    request.mockResolvedValueOnce(response({ result: { id: "created" } }))
      .mockRejectedValueOnce(new Error("Sem conexão."));
    let saved = false;
    await act(async () => { saved = await state.save("client_save", { name: "Cliente" }); });
    expect(saved).toBe(true);
    expect(state.error).toContain("Cadastro salvo, mas não foi possível atualizar a lista.");
    expect(state.data).toEqual(data);
    expect(state.busy).toBe(false);
    expect(request.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    await act(async () => state.reload());
    expect(state.error).toBeNull();
    expect(state.notice).toBe("Cadastro atualizado.");
  });
  it("mantém o formulário aberto quando o servidor rejeita a revisão", async () => {
    request.mockResolvedValueOnce(response({ error: "Cliente alterado por outra sessão." }, false));
    let saved = true;
    await act(async () => { saved = await state.save("client_save", { id: "old", revision: 1 }); });
    expect(saved).toBe(false);
    expect(state.error).toBe("Cliente alterado por outra sessão.");
    expect(state.notice).toBeNull();
    expect(state.busy).toBe(false);
  });
});
