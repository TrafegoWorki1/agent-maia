import { describe, it, expect, vi } from "vitest";

const claudeSimple = vi.hoisted(() => ({ runClaudeSimple: vi.fn() }));
vi.mock("../server/ai/providers/claudeSimple.ts", () => ({ runClaudeSimple: claudeSimple.runClaudeSimple }));

const drive = vi.hoisted(() => ({ getAccessToken: vi.fn().mockResolvedValue("token") }));
vi.mock("../server/integrations/googleDrive.ts", () => ({ getAccessToken: drive.getAccessToken }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { collectSourceHealth } from "../server/panelCollection.ts";
import type { Db } from "../server/store.ts";

function fakeDb() {
  const upserts: { table: string; row: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          upserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as Db;
  return { db, upserts };
}

describe("coleta do painel: calendar/gmail/meta pelo Claude, sheets pelo Drive direto", () => {
  it("sheets não chama o Claude, só a API do Drive", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ files: [{ name: "Planilha", modifiedTime: "2026-10-20T00:00:00Z" }] }) });
    const { db, upserts } = fakeDb();
    await collectSourceHealth(db, "sheets");
    expect(claudeSimple.runClaudeSimple).not.toHaveBeenCalled();
    const snapshot = upserts.find((u) => u.table === "snapshots");
    expect(snapshot?.row).toMatchObject({ source: "sheets", status: "ok" });
  });

  it("calendar só libera a ferramenta de leitura de calendários e salva os nomes validados", async () => {
    claudeSimple.runClaudeSimple.mockImplementationOnce(async ({ allowTool }) => {
      expect(allowTool("mcp__claude_ai_Google_Calendar__list_calendars")).toBe(true);
      expect(allowTool("mcp__claude_ai_Gmail__search_threads")).toBe(false);
      return { text: '{"calendars":[{"name":"Principal"}]}', costUsd: 0.01 };
    });
    const { db, upserts } = fakeDb();
    await collectSourceHealth(db, "calendar");
    const snapshot = upserts.find((u) => u.table === "snapshots");
    expect(snapshot?.row).toMatchObject({ source: "calendar", status: "ok", data: { calendars: [{ name: "Principal" }] } });
  });

  it("gmail e meta também passam pelo Claude, com a ferramenta certa para cada fonte", async () => {
    claudeSimple.runClaudeSimple.mockImplementationOnce(async ({ allowTool }) => {
      expect(allowTool("mcp__claude_ai_Gmail__search_threads")).toBe(true);
      return { text: '{"unread_count":3,"unread_last_24h":1}', costUsd: 0.01 };
    });
    const { db: dbGmail, upserts: upGmail } = fakeDb();
    await collectSourceHealth(dbGmail, "gmail");
    expect(upGmail.find((u) => u.table === "snapshots")?.row).toMatchObject({ status: "ok", data: { unread_count: 3, unread_last_24h: 1 } });

    claudeSimple.runClaudeSimple.mockImplementationOnce(async ({ allowTool }) => {
      expect(allowTool("mcp__claude_ai_Meta_ADS__ads_get_ad_accounts")).toBe(true);
      expect(allowTool("mcp__claude_ai_Meta_ADS__ads_get_ad_entities")).toBe(true);
      return { text: '{"accounts":[{"name":"Conta","spend_7d":100,"currency":"BRL"}]}', costUsd: 0.01 };
    });
    const { db: dbMeta, upserts: upMeta } = fakeDb();
    await collectSourceHealth(dbMeta, "meta");
    expect(upMeta.find((u) => u.table === "snapshots")?.row).toMatchObject({ status: "ok" });
  });

  it("formato inesperado ou {\"error\"} do Claude vira status de erro, nunca dado inventado", async () => {
    claudeSimple.runClaudeSimple.mockResolvedValueOnce({ text: '{"error":"sem permissão"}', costUsd: 0 });
    const { db, upserts } = fakeDb();
    await collectSourceHealth(db, "meta");
    expect(upserts.find((u) => u.table === "snapshots")?.row).toMatchObject({ status: "error", error: "sem permissão" });

    claudeSimple.runClaudeSimple.mockResolvedValueOnce({ text: '{"accounts":"não é lista"}', costUsd: 0 });
    const { db: db2, upserts: up2 } = fakeDb();
    await collectSourceHealth(db2, "meta");
    expect(up2.find((u) => u.table === "snapshots")?.row.status).toBe("error");
  });
});
