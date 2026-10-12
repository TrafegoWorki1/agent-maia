import { describe, expect, it } from "vitest";
import { hasRecentOutreach, saveContact } from "../server/contacts.ts";
import type { Db } from "../server/store.ts";

// Decisão do owner (12/10/2026): salvar um contato para enviar mensagem não cria Pessoa nem dá permissão;
// "membro da equipe" só quando o dono pede. E quem a Maia procurou e responde sempre é repassado ao dono.
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const db = {
    from(table: string) {
      const rows = tables[table] ?? [];
      const query = {
        select: () => query,
        gte: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: null }),
        insert: async (row: Record<string, unknown>) => {
          (inserted[table] ??= []).push(row);
          return { error: null };
        },
        then: (resolve: (v: { data: Record<string, unknown>[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return query;
    },
  } as unknown as Db;
  return { db, inserted };
}

describe("contato avulso", () => {
  it("salva só na agenda, sem criar Pessoa nem permissão", async () => {
    const { db, inserted } = fakeDb({ contacts: [] });
    const result = await saveContact(db, { name: "João", number: "5585997292636" });
    expect(result).toEqual({ ok: true, created: true });
    expect(inserted.contacts).toHaveLength(1);
    expect(inserted.people).toBeUndefined();
    expect(inserted.person_numbers).toBeUndefined();
    expect(inserted.person_permissions).toBeUndefined();
  });

  it("não duplica quando o número já existe, com ou sem o nono dígito", async () => {
    const { db, inserted } = fakeDb({ contacts: [{ number: "5585997292636", name: "João", aliases: [] }] });
    const result = await saveContact(db, { name: "João", number: "558597292636" });
    expect(result).toEqual({ ok: true, created: false });
    expect(inserted.contacts).toBeUndefined();
  });

  it("recusa número inválido e nome vazio", async () => {
    const { db } = fakeDb({ contacts: [] });
    expect((await saveContact(db, { name: "João", number: "123" })).ok).toBe(false);
    expect((await saveContact(db, { name: "  ", number: "5585997292636" })).ok).toBe(false);
  });
});

describe("repasse a quem a Maia procurou", () => {
  it("reconhece o número mesmo quando a resposta vem sem o nono dígito", async () => {
    const { db } = fakeDb({ outreach: [{ number: "5585997292636" }] });
    expect(await hasRecentOutreach(db, "558597292636")).toBe(true);
  });

  it("não repassa para quem a Maia não procurou", async () => {
    const { db } = fakeDb({ outreach: [{ number: "5585988082012" }] });
    expect(await hasRecentOutreach(db, "558597292636")).toBe(false);
  });
});
