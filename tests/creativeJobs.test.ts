import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../server/store.ts";
import { createCreativeJob } from "../server/creativeJobs.ts";

vi.mock("../server/store.ts", () => ({ addTaskEvent: vi.fn() }));
vi.mock("../server/imagegen.ts", () => ({ createImage: vi.fn(), existingImageForOutputKey: vi.fn(), FORMATS: { feed: "4:5", story: "9:16", quadrado: "1:1" } }));
vi.mock("../server/evolutionSend.ts", () => ({ sendOwnerImage: vi.fn() }));

const item = { briefing: "Story 1: chamada principal", format: "story" as const, refs: ["marca.png"] };
function mockDb(existingId: number | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: 42, error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: existingId === null ? null : { id: existingId }, error: null });
  const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }));
  return { db: { rpc, from } as unknown as Db, rpc, from };
}

describe("trabalhos criativos retomáveis", () => {
  beforeEach(() => vi.clearAllMocks());

  it("valida e persiste uma série numa única chamada idempotente do servidor", async () => {
    const { db, rpc, from } = mockDb();
    const id = await createCreativeJob(db, { sourceTaskId: 9, title: "Campanha Stories", items: [item, { ...item, briefing: "Story 2: prova social", refs: [] }] });
    expect(id).toBe(42);
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith("creative_jobs");
    expect(rpc).toHaveBeenCalledWith("create_creative_job", {
      p_source_task_id: 9,
      p_title: "Campanha Stories",
      p_items: [
        { briefing: item.briefing, format: "story", refs: ["marca.png"] },
        { briefing: "Story 2: prova social", format: "story", refs: [] },
      ],
    });
  });

  it("rejeita série acima do limite antes de tocar no banco", async () => {
    const { db, rpc, from } = mockDb();
    await expect(createCreativeJob(db, { sourceTaskId: 9, title: "Demasiadas artes", items: Array.from({ length: 11 }, (_, i) => ({ ...item, briefing: `Arte ${i + 1}` })) })).rejects.toThrow("de 1 a 10");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejeita formatos fora do enum e tarefa de origem inválida", async () => {
    const { db, rpc, from } = mockDb();
    await expect(createCreativeJob(db, { sourceTaskId: 0, title: "Teste", items: [item] })).rejects.toThrow("Tarefa de origem inválida");
    await expect(createCreativeJob(db, { sourceTaskId: 9, title: "Teste", items: [{ ...item, format: "jpeg" as never }] })).rejects.toThrow("Formato de arte inválido");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("não afirma que acrescentou artes numa repetição da mesma tarefa", async () => {
    const { db, rpc, from } = mockDb(73);
    await expect(createCreativeJob(db, { sourceTaskId: 9, title: "Campanha", items: [item] })).rejects.toThrow("Já existe o trabalho criativo #73");
    expect(from).toHaveBeenCalledWith("creative_jobs");
    expect(rpc).not.toHaveBeenCalled();
  });
});
