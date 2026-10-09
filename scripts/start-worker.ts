import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../server/loadEnv.ts";

// Launcher da Maia pelo caminho novo: as mensagens chegam à Vercel e entram na fila do Supabase.
// Este launcher sobe só o worker (que processa a fila); o painel é o da Vercel. A porta 3000 fica livre para outros projetos. Não sobe túnel e não registra
// webhook: a Evolution aponta para a Vercel.
loadLocalEnv();
const env = process.env;
const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE"];
const missing = required.filter((name) => !env[name]);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(", ")}`);
  process.exit(1);
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const PUBLIC_URL = "https://agent-maia.vercel.app";
const children: ChildProcess[] = [];
let stopping = false;

const LOG_DIR = here("../logs");
mkdirSync(LOG_DIR, { recursive: true });

function log(source: string, text: string): void {
  const stamp = new Date().toISOString();
  const file = join(LOG_DIR, `${source}-${stamp.slice(0, 10)}.log`);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = `${stamp} [${source}] ${line}`;
    console.log(entry);
    try {
      appendFileSync(file, entry + "\n");
    } catch (error) {
      console.error(`[launcher] não consegui gravar o log: ${error instanceof Error ? error.message : error}`);
    }
  }
}

function capture(child: ChildProcess, source: string): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let pending = "";
    stream.on("data", (buffer: Buffer) => {
      pending += String(buffer);
      const cut = pending.lastIndexOf("\n");
      if (cut === -1) return;
      log(source, pending.slice(0, cut));
      pending = pending.slice(cut + 1);
    });
    stream.on("end", () => {
      if (pending.trim()) log(source, pending);
      pending = "";
    });
  }
}

function stop(code = 0, reason = "encerrado pelo usuário"): void {
  if (stopping) return;
  stopping = true;
  log("launcher", `parando: ${reason} (código ${code})`);
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => stop(0, "Ctrl+C ou janela fechada"));
process.on("SIGTERM", () => stop(0, "SIGTERM"));

// O worker reinicia sozinho se cair (até 5 vezes seguidas).
let workerRestarts = 0;
function startWorker(): void {
  const worker = spawn(process.execPath, [here("../server/inboxWorker.ts")], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(worker);
  capture(worker, "worker");
  worker.on("exit", (code, signal) => {
    if (stopping) return;
    log("launcher", `worker saiu (código ${code}, sinal ${signal ?? "nenhum"})`);
    if (workerRestarts >= 5) {
      log("launcher", "worker caiu 5 vezes seguidas e não será reiniciado. Feche e abra o launcher.");
      return;
    }
    workerRestarts += 1;
    setTimeout(startWorker, 5_000);
  });
}

log("launcher", `iniciando (pid ${process.pid}, Node ${process.version})`);
startWorker();
log("launcher", `Maia ativa: mensagens chegam pela Vercel (${PUBLIC_URL}). O painel local (porta 3000) não sobe mais por aqui; use pnpm dev se precisar.`);
log("launcher", "Feche esta janela (ou Ctrl+C) para desligar.");
spawn("cmd", ["/c", "start", "", PUBLIC_URL], { stdio: "ignore" });
