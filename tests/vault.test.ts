import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, handleVaultItem, normalizeSecretName, parseVaultCommand, readSecret, secretAvailable } from "../server/vault.ts";
import { activateIntegration, callIntegration, listIntegrations } from "../server/integrationCatalog.ts";
import type { Db } from "../server/store.ts";

const KEY = "a".repeat(64);
const ENV = { INTEGRACAO_VAULT_KEY: KEY };
const TOKEN = "tok-super-secreto-12345";

// Banco de mentira com várias tabelas, só com o encadeamento que o cofre e o catálogo usam.
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  const writes: Array<{ table: string; op: string; data?: unknown }> = [];
  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let filter: [string, unknown] | null = null;
      const pick = () => rows.filter((r) => !filter || r[filter[0]] === filter[1]);
      const api: Record<string, unknown> = {
        select: () => api,
        order: () => Promise.resolve({ data: pick(), error: null }),
        eq: (k: string, v: unknown) => { filter = [k, v]; return api; },
        maybeSingle: () => Promise.resolve({ data: pick()[0] ?? null, error: null }),
        upsert: (row: Record<string, unknown>) => { writes.push({ table, op: "upsert", data: row }); const i = rows.findIndex((r) => r.name === row.name); if (i >= 0) rows[i] = row; else rows.push(row); return Promise.resolve({ error: null }); },
        update: (patch: Record<string, unknown>) => ({ eq: (k: string, v: unknown) => { writes.push({ table, op: "update", data: patch }); rows.filter((r) => r[k] === v).forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }); } }),
        delete: () => ({ eq: (k: string, v: unknown) => { writes.push({ table, op: "delete" }); tables[table] = rows.filter((r) => r[k] !== v); return Promise.resolve({ error: null }); } }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: pick(), error: null }),
      };
      return api;
    },
  };
  return { db: db as unknown as Db, tables, writes };
}

describe("criptografia do cofre", () => {
  it("criptografa e descriptografa, com um vetor novo a cada vez", () => {
    const a = encryptSecret(TOKEN, ENV)!, b = encryptSecret(TOKEN, ENV)!;
    expect(a).not.toBe(b);
    expect(a).not.toContain(TOKEN);
    expect(decryptSecret(a, ENV)).toBe(TOKEN);
  });

  it("sem chave, com chave errada ou com o texto adulterado, não devolve nada", () => {
    const blob = encryptSecret(TOKEN, ENV)!;
    expect(encryptSecret(TOKEN, {})).toBeNull();
    expect(decryptSecret(blob, {})).toBeNull();
    expect(decryptSecret(blob, { INTEGRACAO_VAULT_KEY: "b".repeat(64) })).toBeNull();
    expect(decryptSecret(blob.slice(0, -4) + "AAAA", ENV)).toBeNull();
    expect(encryptSecret(TOKEN, { INTEGRACAO_VAULT_KEY: "curta" })).toBeNull();
  });
});

describe("comando do cofre", () => {
  it("normaliza o nome e exige o prefixo INTEGRACAO_", () => {
    expect(normalizeSecretName("servicox")).toBe("INTEGRACAO_SERVICOX");
    expect(normalizeSecretName("servico x token")).toBe("INTEGRACAO_SERVICO_X_TOKEN");
    expect(normalizeSecretName("INTEGRACAO_SERVICOX_TOKEN")).toBe("INTEGRACAO_SERVICOX_TOKEN");
    expect(normalizeSecretName("!!!")).toBeNull();
    expect(normalizeSecretName("a".repeat(80))).toBeNull();
  });

  it("só reconhece as formas exatas; conversa comum sobre cofre não casa", () => {
    expect(parseVaultCommand(`cofre servicox | ${TOKEN}`)).toEqual({ action: "set", name: "INTEGRACAO_SERVICOX", value: TOKEN });
    expect(parseVaultCommand("cofre listar")).toEqual({ action: "list" });
    expect(parseVaultCommand("cofre apagar servicox")).toEqual({ action: "delete", name: "INTEGRACAO_SERVICOX" });
    expect(parseVaultCommand("o cofre do banco está cheio")).toBeNull();
    expect(parseVaultCommand("cofre")).toBeNull();
    expect(parseVaultCommand("cofre servicox | curto")).toMatchObject({ action: "set_invalid" });
    expect(parseVaultCommand("cofre servicox | tem espaço no meio do valor")).toMatchObject({ action: "set_invalid" });
  });
});

describe("mensagem com segredo na fila", () => {
  const notified: string[] = [];
  const notify = async (t: string) => { notified.push(t); };

  it("no privado do dono: guarda criptografado, apaga a fila, responde sem repetir o valor", async () => {
    notified.length = 0;
    const { db, tables } = fakeDb({ maia_secrets: [], inbox: [{ id: 7, payload: `cofre servicox | ${TOKEN}` }] });
    const handled = await handleVaultItem(db, { id: 7, kind: "text", sender: "owner", payload: `cofre servicox | ${TOKEN}` }, notify, ENV);
    expect(handled).toBe(true);
    expect(tables.inbox[0].payload).toBeNull();
    expect(tables.maia_secrets).toHaveLength(1);
    expect(tables.maia_secrets[0].name).toBe("INTEGRACAO_SERVICOX");
    expect(String(tables.maia_secrets[0].value_enc)).not.toContain(TOKEN);
    expect(decryptSecret(String(tables.maia_secrets[0].value_enc), ENV)).toBe(TOKEN);
    expect(notified.join(" ")).toContain("INTEGRACAO_SERVICOX");
    expect(notified.join(" ")).not.toContain(TOKEN);
  });

  it("no grupo (ou de outro número): recusa, não guarda, apaga a fila e avisa o dono", async () => {
    notified.length = 0;
    const payload = JSON.stringify({ jid: "g@g.us", participant: "5585", name: "Ana", text: `cofre servicox | ${TOKEN}` });
    const { db, tables } = fakeDb({ maia_secrets: [], inbox: [{ id: 9, payload }] });
    for (const sender of ["group", "member", "other"]) {
      expect(await handleVaultItem(db, { id: 9, kind: "text", sender, payload }, notify, ENV)).toBe(true);
    }
    expect(tables.maia_secrets).toHaveLength(0);
    expect(tables.inbox[0].payload).toBeNull();
    expect(notified).toHaveLength(3);
    expect(notified.join(" ")).not.toContain(TOKEN);
  });

  it("sem a chave do cofre: não guarda nada e ensina a criar a chave, sem repetir o valor", async () => {
    notified.length = 0;
    const { db, tables } = fakeDb({ maia_secrets: [], inbox: [{ id: 3, payload: `cofre servicox | ${TOKEN}` }] });
    await handleVaultItem(db, { id: 3, kind: "text", sender: "owner", payload: `cofre servicox | ${TOKEN}` }, notify, {});
    expect(tables.maia_secrets).toHaveLength(0);
    expect(tables.inbox[0].payload).toBeNull();
    expect(notified.join(" ")).toMatch(/INTEGRACAO_VAULT_KEY/);
    expect(notified.join(" ")).not.toContain(TOKEN);
  });

  it("mensagem comum do dono passa direto e a fila fica intacta", async () => {
    const { db, tables } = fakeDb({ inbox: [{ id: 1, payload: "oi, tudo bem?" }] });
    expect(await handleVaultItem(db, { id: 1, kind: "text", sender: "owner", payload: "oi, tudo bem?" }, notify, ENV)).toBe(false);
    expect(tables.inbox[0].payload).toBe("oi, tudo bem?");
  });

  it("listar e apagar valem só para o dono e nunca mostram o valor", async () => {
    notified.length = 0;
    const blob = encryptSecret(TOKEN, ENV)!;
    const { db, tables } = fakeDb({ maia_secrets: [{ name: "INTEGRACAO_SERVICOX", value_enc: blob }], inbox: [{ id: 5, payload: "x" }] });
    expect(await handleVaultItem(db, { id: 5, kind: "text", sender: "group", payload: JSON.stringify({ text: "cofre listar" }) }, notify, ENV)).toBe(false);
    expect(await handleVaultItem(db, { id: 5, kind: "text", sender: "owner", payload: "cofre listar" }, notify, ENV)).toBe(true);
    expect(notified.join(" ")).toContain("INTEGRACAO_SERVICOX");
    expect(notified.join(" ")).not.toContain(TOKEN);
    expect(await handleVaultItem(db, { id: 5, kind: "text", sender: "owner", payload: "cofre apagar servicox" }, notify, ENV)).toBe(true);
    expect(tables.maia_secrets).toHaveLength(0);
  });
});

describe("catálogo lendo do cofre", () => {
  const ROW = { slug: "servicox_enviar", title: "t", description: "d", method: "POST", url_template: "https://api.servicox.com/v1/enviar", body_template: { texto: "{{texto}}" }, auth_style: "bearer", auth_header: null, secret_ref: "INTEGRACAO_SERVICOX", risk: "interna", status: "active", required_permission: "integracao.usar" };

  it("usa o segredo do cofre quando ele não está no .env", async () => {
    const blob = encryptSecret(TOKEN, ENV)!;
    const { db } = fakeDb({ maia_integrations: [ROW], maia_secrets: [{ name: "INTEGRACAO_SERVICOX", value_enc: blob }] });
    let auth = "";
    const fetchImpl = (async (_u: unknown, init: RequestInit) => { auth = String((init.headers as Record<string, string>).authorization); return new Response(`eco ${TOKEN}`, { status: 200 }); }) as unknown as typeof fetch;
    const r = await callIntegration(db, "servicox_enviar", { texto: "oi" }, { env: ENV, fetchImpl });
    expect(r).toMatchObject({ ok: true });
    expect(auth).toBe(`Bearer ${TOKEN}`);
    expect(r.ok && r.body).not.toContain(TOKEN);
  });

  it("o .env tem prioridade e, sem nenhum dos dois, a chamada é recusada", async () => {
    const { db } = fakeDb({ maia_integrations: [ROW], maia_secrets: [] });
    const never = (async () => { throw new Error("não devia chamar"); }) as unknown as typeof fetch;
    expect(await callIntegration(db, "servicox_enviar", { texto: "oi" }, { env: ENV, fetchImpl: never })).toMatchObject({ ok: false, error: expect.stringMatching(/cofre nem no \.env/) });
    expect(await secretAvailable(db, "INTEGRACAO_SERVICOX", { ...ENV, INTEGRACAO_SERVICOX: "do-env-123" })).toBe("do-env-123");
  });

  it("só ativa quando o segredo existe no cofre e a listagem mostra isso sem revelar o valor", async () => {
    const blob = encryptSecret(TOKEN, ENV)!;
    const pending = { ...ROW, status: "pending" };
    const sem = fakeDb({ maia_integrations: [{ ...pending }], maia_secrets: [] });
    expect(await activateIntegration(sem.db, "servicox_enviar", ENV)).toMatchObject({ ok: false, error: expect.stringMatching(/cofre/) });
    const com = fakeDb({ maia_integrations: [{ ...pending }], maia_secrets: [{ name: "INTEGRACAO_SERVICOX", value_enc: blob }] });
    expect(await activateIntegration(com.db, "servicox_enviar", ENV)).toMatchObject({ ok: true });
    const list = await listIntegrations(com.db, ENV);
    expect(list[0]).toMatchObject({ segredo_configurado: true });
    expect(JSON.stringify(list)).not.toContain(TOKEN);
    expect(await readSecret(com.db, "EVOLUTION_API_KEY", ENV)).toBeUndefined();
  });
});
