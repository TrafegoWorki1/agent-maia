import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { answerWithClaude, type MaiaRequest } from "./server/maiaAgent.ts";
import { loadLocalEnv } from "./server/loadEnv.ts";
import { getDb, recentMessages, recoverStaleTasks } from "./server/store.ts";
import { answerFromPanel } from "./server/maiaOwnerAgent.ts";
import { buildSnapshot } from "./server/snapshot.ts";
import { isRefreshing, refreshAll, scheduleRefresh } from "./server/refreshJob.ts";

// Só o próprio computador lê o painel: o painel mostra dados pessoais de contas reais.
function isLocalRequest(host: string | undefined): boolean {
  const name = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

const MAX_BODY_BYTES = 8_000;

function isMaiaRequest(value: unknown): value is MaiaRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const statuses = ["permitido", "aguardando_aprovacao", "bloqueado"];
  return ["requesterName", "groupName", "request", "decisionExplanation"].every(
    (key) => typeof v[key] === "string" && (v[key] as string).length <= 1000,
  ) && typeof v.decisionStatus === "string" && statuses.includes(v.decisionStatus);
}

// Rota de desenvolvimento: existe só no `pnpm dev`. O build estático não tem backend.
function maiaAgentApi(): Plugin {
  return {
    name: "maia-agent-api",
    configureServer(server) {
      // Os testes também sobem um servidor Vite: não inicia banco nem atualização nesse caso.
      if (process.env.VITEST) return;
      loadLocalEnv();
      const db = getDb();
      // Tarefas da conversa do painel que estavam em andamento antes deste processo: viram "incerta".
      void recoverStaleTasks(db, "painel").catch((error) => console.error("[painel] recuperação de tarefas:", error instanceof Error ? error.message : error));
      // Atualização periódica das fontes (Gmail, Meta Ads, Sheets), só neste processo local.
      const stopRefresh = scheduleRefresh(db);
      server.httpServer?.once("close", stopRefresh);

      server.middlewares.use("/api/snapshot", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!isLocalRequest(req.headers.host)) return send(403, { error: "local_only" });
        if (req.method !== "GET") return send(405, { error: "method_not_allowed" });
        try {
          send(200, await buildSnapshot(db));
        } catch (error) {
          console.error("[snapshot]", error instanceof Error ? error.message : error);
          send(500, { error: "snapshot_failed" });
        }
      });

      server.middlewares.use("/api/refresh", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (!isLocalRequest(req.headers.host)) return send(403, { error: "local_only" });
        if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
        if (isRefreshing()) return send(409, { error: "already_running" });
        // Não espera o fim: as consultas levam alguns minutos. O painel acompanha pelo snapshot.
        void refreshAll(db).catch((error) => console.error("[refresh]", error instanceof Error ? error.message : error));
        send(202, { ok: true });
      });

      // Conversa do painel com a Maia. Mesmo histórico do WhatsApp; escrita continua só pelo WhatsApp.
      server.middlewares.use("/api/conversa", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        if (!isLocalRequest(req.headers.host)) return send(403, { error: "local_only" });
        if (req.method === "GET") return send(200, { messages: await recentMessages(db) });
        if (req.method !== "POST") return send(405, { error: "method_not_allowed" });

        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > MAX_BODY_BYTES) return send(413, { error: "too_large" });
        }
        let body: { text?: unknown };
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: "invalid_json" });
        }
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text || text.length > 2000) return send(400, { error: "invalid_text" });
        try {
          send(200, { reply: await answerFromPanel(text) });
        } catch (error) {
          console.error("[conversa]", error instanceof Error ? error.message : error);
          send(502, { error: "agent_failed" });
        }
      });

      server.middlewares.use("/api/maia", async (req, res) => {
        const send = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (!isLocalRequest(req.headers.host)) return send(403, { error: "local_only" });
        if (req.method !== "POST") return send(405, { error: "method_not_allowed" });

        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > MAX_BODY_BYTES) return send(413, { error: "too_large" });
        }
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: "invalid_json" });
        }
        if (!isMaiaRequest(body)) return send(400, { error: "invalid_request" });

        try {
          const reply = await answerWithClaude(body);
          send(200, { reply });
        } catch (error) {
          console.error("[maia-agent-api]", error instanceof Error ? error.message : error);
          send(502, { error: "agent_failed" });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), maiaAgentApi()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    // O PGlite (Postgres em WebAssembly) usa muita memória ao iniciar; poucos processos em paralelo evitam queda do worker no Windows.
    maxWorkers: 3,
  },
});
