import { describe, expect, it, vi } from "vitest";
import type { Db } from "../server/store.ts";
import { resolveCreativeAsset, formatAssetSummary, type CreativeAssetMatch } from "../server/creativeAssetResolver.ts";

vi.mock("node:fs", () => ({ existsSync: (p: string) => p.includes("present") }));

function makeAsset(overrides: Partial<CreativeAssetMatch> = {}): CreativeAssetMatch {
  return {
    itemId: 1, jobId: 10, jobTitle: "Campanha Tesla", seq: 1,
    briefing: "Arte do Tesla Model 3 para feed", format: "feed",
    status: "ready_for_review", artifactPath: "/data/arte/present/arte.png", messageId: "msg1",
    createdAt: new Date().toISOString(), ...overrides,
  };
}

function mockDb(rows: CreativeAssetMatch[]) {
  // Each `from()` call creates fresh filter state so multiple fetchItems calls don't bleed filters
  const db = {
    from: vi.fn(() => {
      const filters: { eq: Record<string, unknown>; in: Record<string, unknown[]> } = { eq: {}, in: {} };
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((col: string, val: unknown) => { filters.eq[col] = val; return chain; }),
        in: vi.fn((col: string, vals: unknown[]) => { filters.in[col] = vals; return chain; }),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        // thenable: `await chain` calls this
        then: (resolve: (v: unknown) => void) => {
          const data = rows.filter(r => {
            if (filters.eq.job_id !== undefined && r.jobId !== filters.eq.job_id) return false;
            if (filters.eq.seq !== undefined && r.seq !== filters.eq.seq) return false;
            if (filters.in.status && !filters.in.status.includes(r.status)) return false;
            return true;
          }).map(r => ({
            id: r.itemId, job_id: r.jobId, seq: r.seq, briefing: r.briefing, format: r.format,
            status: r.status, artifact_path: r.artifactPath, message_id: r.messageId,
            created_at: r.createdAt, creative_jobs: { title: r.jobTitle },
          }));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    }),
  } as unknown as Db;
  return db;
}

describe("resolveCreativeAsset", () => {
  it("resolve 'lâmina 8' para seq=8 dentro do job corrente", async () => {
    const rows = [
      makeAsset({ itemId: 7, seq: 8, jobId: 10, briefing: "Post feed campanha" }),
    ];
    const db = mockDb(rows);
    const result = await resolveCreativeAsset(db, "lâmina 8", 10);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.asset.seq).toBe(8);
  });

  it("resolve 'a capa' para seq=1", async () => {
    const rows = [makeAsset({ seq: 1, briefing: "Capa da campanha" })];
    const db = mockDb(rows);
    const result = await resolveCreativeAsset(db, "a capa", 10);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.asset.seq).toBe(1);
  });

  it("resolve 'aquele Tesla' pelo briefing", async () => {
    const rows = [makeAsset({ briefing: "Arte Tesla Model 3 azul" })];
    const db = mockDb(rows);
    const result = await resolveCreativeAsset(db, "aquele Tesla", 10);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.asset.briefing).toContain("Tesla");
  });

  it("retorna 'multiple' e pergunta objetiva quando há mais de um match", async () => {
    const rows = [
      makeAsset({ itemId: 1, seq: 1, briefing: "Arte feed Tesla" }),
      makeAsset({ itemId: 2, seq: 2, briefing: "Arte story Tesla" }),
    ];
    const db = mockDb(rows);
    const result = await resolveCreativeAsset(db, "Tesla");
    expect(result.kind).toBe("multiple");
    if (result.kind === "multiple") {
      expect(result.question).toMatch(/Qual delas/);
      expect(result.assets.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("retorna 'not_found' quando não há correspondência", async () => {
    const db = mockDb([]);
    const result = await resolveCreativeAsset(db, "arte do unicórnio voador");
    expect(result.kind).toBe("not_found");
  });

  it("amplia a busca para todos os jobs quando não acha no job corrente", async () => {
    const rows = [makeAsset({ jobId: 99, briefing: "Arte Nike fundo branco" })];
    const db = mockDb(rows);
    // Query with currentJobId=10 won't find it, should retry without jobId
    const result = await resolveCreativeAsset(db, "Nike fundo branco", 10);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.asset.jobId).toBe(99);
  });

  it("filtra por status quando a query menciona 'faltou'", async () => {
    const rows = [makeAsset({ status: "failed", artifactPath: null })];
    const db = mockDb(rows);
    const result = await resolveCreativeAsset(db, "a arte que faltou", 10);
    expect(result.kind).toBe("found");
    if (result.kind === "found") expect(result.asset.status).toBe("failed");
  });
});

describe("formatAssetSummary", () => {
  it("indica arquivo ok quando arquivo existe", () => {
    const a = makeAsset({ artifactPath: "/data/arte/present/arte.png", status: "ready_for_review" });
    expect(formatAssetSummary(a)).toContain("✓ arquivo ok");
  });

  it("indica arquivo ausente quando artifact_path aponta para arquivo inexistente", () => {
    const a = makeAsset({ artifactPath: "/data/arte/missing/arte.png", status: "artifact_ready" });
    expect(formatAssetSummary(a)).toContain("⚠ arquivo ausente");
  });

  it("não menciona arquivo quando artifact_path é null", () => {
    const a = makeAsset({ artifactPath: null, status: "queued" });
    const summary = formatAssetSummary(a);
    expect(summary).not.toContain("arquivo");
    expect(summary).toContain("na fila");
  });
});
