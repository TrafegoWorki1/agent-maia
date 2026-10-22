// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MissionPanel } from "../src/features/operacao/MissionPanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
it("mostra estado/evidência e envia revisão para impedir controle sobre dados antigos", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const run = vi.fn().mockResolvedValue(undefined);
  await act(async () => root!.render(createElement(MissionPanel, {
    plans: [{ id: 3, title: "Reunião", status: "active", updated_at: "2026-10-21T15:00:00Z", kind: "meeting", mission_state: "waiting_external", revision: 4, interaction_count: 2, max_interactions: 8 }],
    receipts: [{ id: 1, plan_id: 3, kind: "message", state: "confirmed", evidence: { messageId: "receipt-real" }, created_at: "2026-10-21T15:00:00Z" }], busy: false, act: run,
  })));
  expect(host.textContent).toContain("Aguardando resposta"); expect(host.textContent).toContain("Envio aceito"); expect(host.textContent).toContain("receipt-real");
  const pause = [...host.querySelectorAll("button")].find(b => b.textContent === "Pausar missão")!;
  await act(async () => pause.click());
  expect(run).toHaveBeenCalledWith({ action: "mission_control", id: 3, revision: 4, operation: "pause" });
});
it("cancelada não oferece retomada nem conclusão manual", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(MissionPanel, { plans: [{ id: 4, title: "Cancelada", status: "cancelled", mission_state: "cancelled", kind: "conversation", revision: 2, updated_at: "2026-10-21T15:00:00Z" }], receipts: [], busy: false, act: vi.fn() })));
  expect(host.querySelectorAll("button").length).toBe(0);
});
