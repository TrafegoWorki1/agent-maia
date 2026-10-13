import { beforeEach, describe, expect, it, vi } from "vitest";

// Decisão do owner (13/10/2026): o pedido de aprovação para criar grupo mostra quem entra (nomes e números), além
// da Maia, que cria e fica no grupo. Antes só dizia "2 participante(s)" e o Ítalo entrou sem o owner perceber.
const sent: string[] = [];
vi.mock("../server/evolutionSend.ts", () => ({ sendOwnerText: vi.fn(async (_to: string, text: string) => { sent.push(text); }) }));
vi.mock("../server/approvals.ts", () => ({
  APPROVAL_TTL_MS: 600_000,
  approverNumbers: vi.fn(async () => ["EVOLUTION_OWNER_NUMBER"]),
  createApproval: vi.fn(async () => ({ id: 9, expiresAt: "2099-01-01T00:00:00Z" })),
  decideFromText: vi.fn(),
  openApprovals: vi.fn(async () => []),
}));
vi.mock("../server/store.ts", () => ({
  addTaskEvent: vi.fn(async () => {}),
  createOwnerTask: vi.fn(async () => 385),
  recordMessage: vi.fn(async () => {}),
}));
vi.mock("../server/contacts.ts", () => ({
  loadContacts: vi.fn(async () => [{ number: "5585991872784", name: "Ítalo", aliases: [] }]),
}));

import { requestCreateGroup } from "../server/groups.ts";

describe("pedido de criação de grupo", () => {
  beforeEach(() => {
    sent.length = 0;
    process.env.EVOLUTION_APPROVER_NUMBER = "EVOLUTION_OWNER_NUMBER";
  });

  it("lista cada participante (com o nome da agenda) e avisa que a Maia entra por ser quem cria", async () => {
    const reply = await requestCreateGroup({ db: {} as never, notifyOwner: async () => {} }, "Projeto Ítalo", ["5585991872784", "EVOLUTION_OWNER_NUMBER"]);
    const message = sent[0];
    expect(message).toContain('Pedido para criar o grupo "Projeto Ítalo" (#9)');
    expect(message).toContain("além da Maia");
    expect(message).toContain("- Ítalo (+5585991872784)");
    expect(message).toContain("- +EVOLUTION_OWNER_NUMBER");
    expect(message).toContain("Responda OK para criar ou NÃO para recusar");
    expect(reply).toContain("Ítalo (+5585991872784)");
    expect(reply).toContain("além da Maia");
  });
});
