import { describe, expect, it, vi } from "vitest";
import { taskSentTextToGroup, type Db } from "../server/store.ts";

describe("taskSentTextToGroup", () => {
  it("só reconhece o envio direto da tarefa para o mesmo grupo", async () => {
    const calls: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn((...args: unknown[]) => { calls.push(["select", ...args]); return builder; });
    builder.eq = vi.fn((...args: unknown[]) => { calls.push(["eq", ...args]); return builder; });
    builder.like = vi.fn((...args: unknown[]) => { calls.push(["like", ...args]); return builder; });
    builder.limit = vi.fn((...args: unknown[]) => { calls.push(["limit", ...args]); return builder; });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: 99 }], error: null }).then(resolve);
    const from = vi.fn((table: string) => {
      calls.push(["from", table]);
      return builder;
    });

    const found = await taskSentTextToGroup({ from } as unknown as Db, 73, "120@g.us");

    expect(found).toBe(true);
    expect(calls).toContainEqual(["from", "task_events"]);
    expect(calls).toContainEqual(["eq", "task_id", 73]);
    expect(calls).toContainEqual(["eq", "type", "group_message_sent"]);
    expect(calls).toContainEqual(["eq", "operation", "grupo_enviar_texto"]);
    expect(calls).toContainEqual(["like", "detail", "jid=120@g.us;%"]);
    expect(calls).toContainEqual(["limit", 1]);
  });
});
