import { loadLocalEnv } from "../server/loadEnv.ts";

// Registra o webhook na instância da Evolution. Sem --apply, só mostra o que faria.
// A URL completa (com o segredo) nunca é impressa.
loadLocalEnv();

const apply = process.argv.includes("--apply");
// Bug real encontrado e corrigido em 10/10/2026: este script usava WEBHOOK_PUBLIC_URL (o túnel Cloudflare do
// launcher LEGADO, scripts/start.ts/pnpm start:legacy) com o caminho /webhook. Isso é só um valor de sessão
// anterior sobrando no .env — o caminho real de produção é api/webhook.ts na Vercel. Rodar este script com
// --apply usando WEBHOOK_PUBLIC_URL sobrescreveu a Evolution para apontar pro túnel morto; corrigido de volta
// na hora. EVOLUTION_WEBHOOK_URL é a variável nova, explícita, para a URL real (sem o token, que o script já
// acrescenta). WEBHOOK_PUBLIC_URL nunca mais é usado aqui.
const required = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "EVOLUTION_WEBHOOK_SECRET", "EVOLUTION_WEBHOOK_URL"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Faltam variáveis no .env: ${missing.join(", ")}`);
  process.exit(1);
}

// Eventos de grupo (10/10/2026): sem eles, a Maia só sabe de foto/nome/participante trocados por fora dela
// quando alguém pergunta e ela reconsulta — e reconsultar demais bate no rate-overlimit do WhatsApp. Com o
// evento, o worker invalida o cache na hora (server/inbox.ts, server/inboxWorker.ts).
// GROUP_UPDATE (singular), confirmado contra o enum real desta instância em 10/10/2026 — a documentação
// pública usa GROUPS_UPDATE (plural), mas essa versão recusa com 400 e lista o enum aceito.
const events = ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "GROUPS_UPSERT", "GROUP_UPDATE", "GROUP_PARTICIPANTS_UPDATE"];
const webhookUrl = `${process.env.EVOLUTION_WEBHOOK_URL}?token=${encodeURIComponent(process.env.EVOLUTION_WEBHOOK_SECRET!)}`;
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
