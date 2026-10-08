import { loadLocalEnv } from "../server/loadEnv.ts";

// Registra o webhook na instância da Evolution. Sem --apply, só mostra o que faria.
// A URL completa (com o segredo) nunca é impressa.
loadLocalEnv();

const apply = process.argv.includes("--apply");
const required = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "EVOLUTION_WEBHOOK_SECRET", "WEBHOOK_PUBLIC_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(", ")}`);
  process.exit(1);
}

const events = ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE"];
const webhookUrl = `${process.env.WEBHOOK_PUBLIC_URL}/webhook?token=${encodeURIComponent(process.env.EVOLUTION_WEBHOOK_SECRET!)}`;
const endpoint = `${process.env.EVOLUTION_API_URL}/webhook/set/${process.env.EVOLUTION_INSTANCE}`;
const body = { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false, events } };

if (!apply) {
  console.log(`DRY-RUN: POST ${endpoint}`);
  console.log(`eventos: ${events.join(", ")}`);
  console.log("url do webhook: <oculta, contém o segredo>");
  console.log("Rode com --apply para enviar.");
  process.exit(0);
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: process.env.EVOLUTION_API_KEY! },
  body: JSON.stringify(body),
});
console.log(`HTTP ${response.status} ${response.ok ? "(webhook registrado)" : "(falhou)"}`);
