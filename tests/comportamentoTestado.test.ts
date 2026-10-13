import { describe, expect, it } from "vitest";
import { matchContacts } from "../server/contacts.ts";
import { withCountryCode } from "../server/evolutionWebhook.ts";
import { participantsWithOwner } from "../server/groups.ts";

// Achados do teste de comportamento (13/10/2026): o dono entra em todo grupo que a Maia cria para ele, e um número
// digitado sem o 55 é reconhecido (antes a Maia pedia para salvar de novo um número que já estava na agenda).
describe("dono sempre no grupo criado", () => {
  const OWNER = "EVOLUTION_OWNER_NUMBER";

  it("sem outros participantes, o grupo nasce só com o dono", () => {
    expect(participantsWithOwner([], OWNER)).toEqual([OWNER]);
  });

  it("outras pessoas entram depois do dono, sem duplicar o dono (com ou sem o nono dígito)", () => {
    expect(participantsWithOwner(["5585991872784", "EVOLUTION_OWNER_NUMBER", "85991872784"], OWNER)).toEqual([OWNER, "5585991872784"]);
  });

  it("número sem o 55 ganha o DDI; número incompleto fica de fora", () => {
    expect(participantsWithOwner(["85 99187-2784", "123"], OWNER)).toEqual([OWNER, "5585991872784"]);
  });
});

describe("número sem o 55", () => {
  it("DDD + número (10 ou 11 dígitos) ganha o 55; outros tamanhos ficam", () => {
    expect(withCountryCode("11 98888-7777")).toBe("EVOLUTION_APPROVER_NUMBER");
    expect(withCountryCode("8532221234")).toBe("558532221234");
    expect(withCountryCode("EVOLUTION_APPROVER_NUMBER")).toBe("EVOLUTION_APPROVER_NUMBER");
    expect(withCountryCode("12345")).toBe("12345");
  });

  it("a busca na agenda acha o contato mesmo digitado sem o 55", () => {
    const agenda = [{ number: "EVOLUTION_APPROVER_NUMBER", name: "Herickson", aliases: [] }];
    expect(matchContacts(agenda, "85998372658").map((c) => c.name)).toEqual(["Herickson"]);
    expect(matchContacts(agenda, "(85) 99837-2658").map((c) => c.name)).toEqual(["Herickson"]);
  });
});
