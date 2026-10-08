import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "../server/loadEnv.ts";

// Sobe tudo de uma vez: webhook da Maia + túnel público (cloudflared) + registro do webhook na
// Evolution + app (Vite, só neste computador). A URL do túnel muda a cada execução, por isso o
// webhook é re-registrado sempre. Se qualquer processo cair, tudo para.
loadLocalEnv();
const env = process.env;
const required = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "EVOLUTION_WEBHOOK_SECRET"];
const missing = required.filter((name) => !env[name]);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(", ")}`);
  process.exit(1);
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const WEBHOOK_PORT = Number(env.WEBHOOK_PORT ?? 3100);
const APP_PORT = 3000;
const children: ChildProcess[] = [];
let stopping = false;

// Registro em disco: logs/<origem>-AAAA-MM-DD.log, uma linha por evento, com data e hora em UTC.
// A saída de cada processo filho também vai para a janela, como antes.
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
      // Se o disco falhar, a Maia continua no ar; o aviso aparece na janela.
      console.error(`[launcher] não consegui gravar o log: ${error instanceof Error ? error.message : error}`);
    }
  }
}

// Liga a saída (stdout e stderr) de um processo filho ao registro, por linha completa.
function capture(child: ChildProcess, source: string, onData?: (buffer: Buffer) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let pending = "";
    stream.on("data", (buffer: Buffer) => {
      onData?.(buffer);
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
process.on("uncaughtException", (error) => {
  log("launcher", `erro não tratado: ${error.stack ?? error.message}`);
  stop(1, "erro não tratado");
});
process.on("unhandledRejection", (reason) => {
  log("launcher", `promessa rejeitada sem tratamento: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

function fail(message: string): void {
  log("launcher", message);
  stop(1, message);
}

log("launcher", `iniciando (pid ${process.pid}, Node ${process.version})`);

// Porta 3100 ocupada: outro webhook ainda está rodando e o novo não conseguiria escutar.
const busy = await fetch(`http://127.0.0.1:${WEBHOOK_PORT}/webhook`, { method: "POST" }).then(
  () => true,
  () => false,
);
if (busy) fail(`A porta ${WEBHOOK_PORT} já está em uso. Feche o webhook antigo e tente de novo.`);

const webhook = spawn(process.execPath, [here("../server/webhookServer.ts")], { stdio: ["ignore", "pipe", "pipe"] });
children.push(webhook);
capture(webhook, "webhook");
webhook.on("exit", (code, signal) => fail(`Webhook parou (código ${code}, sinal ${signal ?? "nenhum"}).`));


const endpoint = `${env.EVOLUTION_API_URL}/webhook/set/${env.EVOLUTION_INSTANCE}`;
const events = ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"];

async function registerWebhook(publicUrl: string): Promise<void> {
  const url = `${publicUrl}/webhook?token=${encodeURIComponent(env.EVOLUTION_WEBHOOK_SECRET!)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: env.EVOLUTION_API_KEY! },
    body: JSON.stringify({ webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: false, events } }),
  });
  if (!response.ok) throw new Error(`Evolution respondeu HTTP ${response.status} ao registrar o webhook`);
}

async function connectionState(): Promise<string> {
  const response = await fetch(`${env.EVOLUTION_API_URL}/instance/connectionState/${env.EVOLUTION_INSTANCE}`, {
    headers: { apikey: env.EVOLUTION_API_KEY! },
  });
  if (!response.ok) return `HTTP ${response.status}`;
  const data = (await response.json()) as { instance?: { state?: string } };
  return data.instance?.state ?? "desconhecido";
}

// O painel cai sem o webhook cair: reinicia o painel (até 5 vezes seguidas) e mantém a Maia no ar.
// Se o webhook ou o túnel caírem, aí sim para tudo, como antes.
let appRestarts = 0;
function startApp(): void {
  // --strictPort: se a 3000 estiver ocupada, o painel falha com erro visível em vez de trocar de porta.
  const app = spawn(process.execPath, [here("../node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"], {
    cwd: here(".."),
    // stdin isolado: o Vite lê atalhos do teclado no stdin e não deve depender da janela.
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(app);
  capture(app, "painel");
  app.on("exit", (code, signal) => {
    if (stopping) return;
    log("launcher", `painel saiu (código ${code}, sinal ${signal ?? "nenhum"})`);
    if (appRestarts >= 5) {
      log("launcher", "painel caiu 5 vezes seguidas e não será reiniciado. A Maia segue ativa; feche e abra o launcher para voltar o painel.");
      return;
    }
    appRestarts += 1;
    setTimeout(startApp, 3_000);
  });
}

// O túnel é reiniciado se cair: cada subida ganha uma URL nova, que é registrada de novo na Evolution.
// Config vazio evita o ~/.cloudflared/config.yml global, que responde 404 e sobrescreve o --url.
let registered = false;
let tunnelRestarts = 0;
let appStarted = false;

async function onTunnelOutput(buffer: Buffer): Promise<void> {
  if (registered) return;
  // O cloudflared escreve a URL no stderr.
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(buffer));
  if (!match) return;
  registered = true;
  try {
    await registerWebhook(match[0]);
    // A URL muda a cada execução: o painel (processo filho) lê a atual, não a do .env.
    process.env.WEBHOOK_PUBLIC_URL = match[0];
    log("launcher", `webhook registrado em ${match[0]}/webhook?token=***`);
    log("launcher", `WhatsApp: ${await connectionState()}`);

    if (!appStarted) {
      appStarted = true;
      startApp();
      log("launcher", `App (só neste PC): http://localhost:${APP_PORT}`);
      log("launcher", "Maia ativa. Feche esta janela (ou Ctrl+C) para desligar.");
      // Abre o painel publicado na Vercel. O painel local continua em localhost:3000, sem abrir sozinho.
      spawn("cmd", ["/c", "start", "", "https://agent-maia.vercel.app"], { stdio: "ignore" });
    }
  } catch (error) {
    registered = false;
    log("launcher", `falha ao registrar o webhook: ${error instanceof Error ? error.message : error}`);
  }
}

function startTunnel(): void {
  registered = false;
  const tunnel = spawn(
    "cloudflared",
    ["tunnel", "--config", here("./cloudflared-empty.yml"), "--url", `http://127.0.0.1:${WEBHOOK_PORT}`],
    { shell: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(tunnel);
  capture(tunnel, "tunel", (buffer) => void onTunnelOutput(buffer));
  tunnel.on("exit", (code, signal) => {
    if (stopping) return;
    log("launcher", `túnel saiu (código ${code}, sinal ${signal ?? "nenhum"})`);
    if (tunnelRestarts >= 5) return fail("Túnel caiu 5 vezes seguidas. Feche e abra o launcher.");
    tunnelRestarts += 1;
    setTimeout(startTunnel, 5_000);
  });
}

startTunnel();

setTimeout(() => {
  if (!appStarted) fail("Túnel não ficou pronto em 60s.");
}, 60_000).unref();
