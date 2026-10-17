import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationContext } from "../server/context.ts";
import type { Db } from "../server/store.ts";

const reads = vi.hoisted(() => ({ recent: vi.fn(), memory: vi.fn() }));
vi.mock("../server/store.ts", () => ({ recentMessages: reads.recent }));
vi.mock("../server/ownerMemory.ts", () => ({ ownerMemoryContext: reads.memory }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("contexto usado para interpretar complementos do pedido", () => {
  it.each(["claude", "codex"] as const)("preserva pedido, resposta e cancelamento do canal atual mesmo com memória extensa (%s)", async (executor) => {
    vi.stubEnv("EVOLUTION_OWNER_NUMBER", "");
    reads.memory.mockResolvedValue("Memória antiga ".repeat(4000));
    const at = new Date().toISOString();
    reads.recent.mockResolvedValue([
      { at, channel: "whatsapp", author: "owner", text: "Produza as artes do carrossel, vou enviar o roteiro." },
      { at, channel: "whatsapp", author: "maia", text: "Envie o roteiro para preparar as lâminas." },
      { at, channel: "painel", author: "owner", text: "Publique outro cliente agora." },
      { at, channel: "whatsapp", author: "owner", text: "Correção: por enquanto só revise, não gere imagens." },
    ]);
    const context = await conversationContext({} as Db, "Roteiro Tesla", "whatsapp", executor);
    expect(context).toContain("Dono: Produza as artes do carrossel");
    expect(context).toContain("Maia: Envie o roteiro");
    expect(context).toContain("Dono: Correção: por enquanto só revise, não gere imagens.");
    expect(context).not.toContain("Publique outro cliente");
    expect(context.length).toBeLessThanOrEqual(executor === "codex" ? 18000 : 28000);
  });
});
