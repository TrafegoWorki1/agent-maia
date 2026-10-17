import { describe, expect, it, vi } from "vitest";
import { routeOwnerText } from "../server/ownerRouter.ts";

const run = vi.hoisted(() => vi.fn().mockResolvedValue(9));
vi.mock("../server/maiaOwnerAgent.ts", () => ({ handleOwnerMessage: run, handleGroupMessage: vi.fn(), handleMemberMessage: vi.fn(), startWithName: vi.fn() }));
vi.mock("../server/store.ts", async (importOriginal) => ({ ...await importOriginal<typeof import("../server/store.ts")>(), getDb: () => ({}) }));
vi.mock("../server/ownerPreferences.ts", () => ({ handleOwnerPreferenceCommand: vi.fn().mockResolvedValue(null) }));

describe("roteamento criativo com conversa", () => {
  it("envia pedido direto e complemento ao mesmo fluxo contextual, sem gerar imediatamente pelo atalho antigo", async () => {
    const request = "Crie as imagens dos 5 Stories daquele briefing.";
    const script = "Aqui está o roteiro: Tesla, tecnologia e design.";
    await routeOwnerText(request);
    await routeOwnerText(script);
    expect(run.mock.calls).toEqual([[request], [script]]);
  });
});
