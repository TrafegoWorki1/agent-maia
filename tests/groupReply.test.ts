import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverGroupReply, shouldSendGroupFailureNotice } from "../server/groupReply.ts";
import { deliverResponse } from "../server/responseDelivery.ts";
import { addTaskEvent, markTaskReplied, setTaskStatus, taskSentTextToGroup, type Db } from "../server/store.ts";
import type { Requester } from "../server/access.ts";

vi.mock("../server/responseDelivery.ts", () => ({ deliverResponse: vi.fn() }));
vi.mock("../server/store.ts", () => ({
  addTaskEvent: vi.fn().mockResolvedValue(undefined),
  markTaskReplied: vi.fn().mockResolvedValue(undefined),
  setTaskStatus: vi.fn().mockResolvedValue(undefined),
  taskSentTextToGroup: vi.fn(),
}));

const db = {} as Db;
const requester = { role: "owner", number: "5511999999999", name: "Owner", permissions: new Set<string>(), groupScope: { jid: "123@g.us" } } as unknown as Requester;
const beforeDelivery = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  vi.clearAllMocks();
  beforeDelivery.mockResolvedValue(undefined);
});

describe("deliverGroupReply", () => {
  it("não envia resposta automática se a mesma tarefa já publicou texto no mesmo grupo", async () => {
    vi.mocked(taskSentTextToGroup).mockResolvedValue(true);

    const result = await deliverGroupReply(db, 41, "123@g.us", "resposta final", "pedido", requester, beforeDelivery);

    expect(result).toBe("already_sent");
    expect(taskSentTextToGroup).toHaveBeenCalledWith(db, 41, "123@g.us");
    expect(beforeDelivery).not.toHaveBeenCalled();
    expect(deliverResponse).not.toHaveBeenCalled();
    expect(addTaskEvent).toHaveBeenCalledWith(db, 41, "group_reply_suppressed", "whatsapp.reply", expect.stringContaining("123@g.us"));
    expect(markTaskReplied).toHaveBeenCalledWith(db, 41);
    expect(setTaskStatus).toHaveBeenCalledWith(db, 41, "concluida");
  });

  it("mantém a resposta automática quando o texto foi enviado a outro grupo ou não houve envio direto", async () => {
    vi.mocked(taskSentTextToGroup).mockResolvedValue(false);

    const result = await deliverGroupReply(db, 42, "123@g.us", "resposta final", "pedido", requester, beforeDelivery);

    expect(result).toBe("delivered");
    expect(beforeDelivery).toHaveBeenCalledOnce();
    expect(deliverResponse).toHaveBeenCalledWith(db, 42, "123@g.us", "resposta final", "pedido", requester);
  });

  it("falha de consulta não envia outra mensagem e marca a tarefa como incerta", async () => {
    vi.mocked(taskSentTextToGroup).mockRejectedValue(new Error("Supabase indisponível"));

    const result = await deliverGroupReply(db, 43, "123@g.us", "resposta final", "pedido", requester, beforeDelivery);

    expect(result).toBe("uncertain");
    expect(beforeDelivery).not.toHaveBeenCalled();
    expect(deliverResponse).not.toHaveBeenCalled();
    expect(setTaskStatus).toHaveBeenCalledWith(db, 43, "incerta");
    expect(addTaskEvent).toHaveBeenCalledWith(db, 43, "group_reply_check_failed", "whatsapp.reply", "Supabase indisponível");
  });

  it("não envia aviso de falha ao grupo se a ferramenta já publicou a mensagem", async () => {
    vi.mocked(taskSentTextToGroup).mockResolvedValue(true);

    const shouldNotify = await shouldSendGroupFailureNotice(db, 44, "123@g.us");

    expect(shouldNotify).toBe(false);
    expect(deliverResponse).not.toHaveBeenCalled();
    expect(markTaskReplied).toHaveBeenCalledWith(db, 44);
    expect(setTaskStatus).toHaveBeenCalledWith(db, 44, "concluida");
    expect(addTaskEvent).toHaveBeenCalledWith(db, 44, "group_reply_suppressed", "whatsapp.reply", expect.stringContaining("resposta final interrompida"));
  });

  it("permite aviso de falha se nenhuma mensagem foi enviada pela ferramenta", async () => {
    vi.mocked(taskSentTextToGroup).mockResolvedValue(false);

    await expect(shouldSendGroupFailureNotice(db, 45, "123@g.us")).resolves.toBe(true);
  });
});
