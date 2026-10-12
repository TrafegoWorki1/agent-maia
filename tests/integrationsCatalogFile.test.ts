import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillBody, resolveUrl } from "../server/integrationCatalog.ts";
import { evolutionRows, zernioRows } from "../scripts/db/catalog-sql.ts";

interface Entry { slug: string; title: string; risk: string; status?: "active" | "paused"; method: string; path: string; query?: string; body?: unknown; description: string }
const catalog = JSON.parse(readFileSync("config/integrations-catalog.json", "utf8")) as { evolution: Entry[] };
const migration = readdirSync("supabase/migrations").find((f) => f.endsWith("_maia_integrations_evolution_v2.sql"))!;
const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
const ENV = { EVOLUTION_API_URL: "https://evo.exemplo.com", EVOLUTION_INSTANCE: "inst1" };

// Procura {{nome}} no corpo e na consulta para montar parâmetros de mentira.
function placeholders(entry: Entry): string[] {
  return [...JSON.stringify(entry.body ?? {}).matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g), ...(entry.query ?? "").matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
}

describe("arquivo do catálogo de integrações da Evolution", () => {
  it("slugs únicos, riscos válidos e textos dentro dos limites do banco", () => {
    const slugs = catalog.evolution.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of catalog.evolution) {
      expect(e.slug).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
      expect(["leitura", "interna", "externa"]).toContain(e.risk);
      expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(e.method);
      expect(e.title.length).toBeLessThanOrEqual(80);
      expect(e.description.length).toBeLessThanOrEqual(400);
    }
  });

  it("cada endpoint monta uma URL e um corpo válidos com todos os parâmetros", () => {
    for (const e of catalog.evolution) {
      const params = Object.fromEntries(placeholders(e).map((n) => [n, "x"]));
      const url = resolveUrl(`{EVOLUTION_API_URL}${e.path}/{EVOLUTION_INSTANCE}${e.query ? `?${e.query}` : ""}`, ENV, params);
      expect(url, e.slug).toMatchObject({ ok: true });
      if (e.body) expect(fillBody(e.body, params, url.ok ? url.used : new Set()), e.slug).toMatchObject({ ok: true });
    }
  });

  it("os endpoints de maior dano entram pausados e as rotas que vazam segredo ficam de fora", () => {
    const paused = catalog.evolution.filter((e) => e.status === "paused").map((e) => e.slug).sort();
    expect(paused).toEqual(["whatsapp_apagar_instancia", "whatsapp_bloquear_contato", "whatsapp_desconectar_instancia", "whatsapp_perfil_nome", "whatsapp_perfil_recado", "whatsapp_perfil_remover_foto", "whatsapp_privacidade_alterar", "whatsapp_reiniciar_instancia", "whatsapp_sair_do_grupo"]);
    const paths = catalog.evolution.map((e) => e.path);
    for (const banned of ["/webhook/set", "/webhook/find", "/instance/fetchInstances", "/instance/create", "/message/sendText", "/message/sendPoll", "/group/create", "/group/updateParticipant"]) expect(paths).not.toContain(banned);
  });

  it("a migração contém exatamente as linhas geradas a partir do arquivo", () => {
    expect(sql).toContain(evolutionRows(catalog.evolution));
    expect(sql).toContain("check (risk in ('leitura', 'interna', 'externa'))");
  });
});

describe("arquivo do catálogo de integrações da Zernio (Instagram)", () => {
  const zernio = (catalog as unknown as { zernio: Array<Entry & { url: string }> }).zernio;
  const zernioMigration = readFileSync(`supabase/migrations/${readdirSync("supabase/migrations").find((f) => f.endsWith("_maia_integrations_zernio_v1.sql"))!}`, "utf8");

  it("slugs únicos e textos dentro dos limites do banco, sem repetir os da Evolution", () => {
    const slugs = zernio.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const evolutionSlugs = new Set(catalog.evolution.map((e) => e.slug));
    for (const e of zernio) {
      expect(evolutionSlugs.has(e.slug), e.slug).toBe(false);
      expect(e.slug).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
      expect(["leitura", "interna", "externa"]).toContain(e.risk);
      expect(e.title.length, e.slug).toBeLessThanOrEqual(80);
      expect(e.description.length, e.slug).toBeLessThanOrEqual(400);
      expect(e.url.length, e.slug).toBeLessThanOrEqual(400);
    }
  });

  it("toda URL é https da Zernio e monta com todos os parâmetros (os opcionais podem faltar)", () => {
    for (const e of zernio) {
      expect(e.url.startsWith("https://zernio.com/api/v1/"), e.slug).toBe(true);
      const required = [...(e.url + JSON.stringify(e.body ?? {})).matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
      const params = Object.fromEntries(required.map((n) => [n, "x1"]));
      const url = resolveUrl(e.url, {}, params);
      expect(url, e.slug).toMatchObject({ ok: true });
      if (e.body) expect(fillBody(e.body, params, url.ok ? url.used : new Set()), e.slug).toMatchObject({ ok: true });
    }
  });

  it("escritas e apagamentos são externos (OK a cada uso); leituras não", () => {
    for (const e of zernio) {
      if (e.method === "GET") expect(e.risk, e.slug).toBe("leitura");
      else expect(e.risk, e.slug).toBe("externa");
    }
  });

  it("a migração da Zernio contém exatamente as linhas geradas a partir do arquivo", () => {
    expect(zernioMigration).toContain(zernioRows(zernio));
  });
});
