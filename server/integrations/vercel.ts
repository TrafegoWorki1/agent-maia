import { readSecret } from "../vault.ts";
import type { Db } from "../store.ts";

// Cliente mínimo da API REST da Vercel. Só o necessário para a ferramenta `site_publicar`: publicar um deployment por
// arquivo. Fora de propósito: variáveis de ambiente, domínios, equipe, billing, firewall — nada disso é exposto aqui.
// Isto não é o conector Vercel da conta Claude (`operationalConnectors.ts`); é um cliente próprio, de superfície mínima.

const API = "https://api.vercel.com";
const TIMEOUT_MS = 20_000;

export class VercelError extends Error {}

export const PROJECT_NAME = /^[a-z0-9-]{1,100}$/;

// `.env` primeiro; depois o cofre (`cofre VERCEL_TOKEN | valor` vira INTEGRACAO_VERCEL_TOKEN).
export async function vercelToken(db: Db): Promise<string> {
  const token = process.env.VERCEL_TOKEN?.trim() || (await readSecret(db, "INTEGRACAO_VERCEL_TOKEN"));
  if (!token) throw new VercelError("Vercel não configurada: falta VERCEL_TOKEN no .env do servidor ou INTEGRACAO_VERCEL_TOKEN no cofre.");
  return token;
}

interface DeploymentResponse {
  url?: string;
  readyState?: string;
  id?: string;
}

export async function createDeployment(db: Db, input: { project: string; fileName: string; content: string }): Promise<{ url: string | null; estado: string | null; id: string | null }> {
  if (!PROJECT_NAME.test(input.project)) throw new VercelError("Nome de projeto inválido: use letras minúsculas, números e hífen.");
  const token = await vercelToken(db);
  const response = await fetch(`${API}/v13/deployments?forceNew=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.project,
      target: "production",
      projectSettings: { framework: null },
      files: [{ file: input.fileName, data: Buffer.from(input.content, "utf8").toString("base64"), encoding: "base64" }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta sem JSON */ }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && data.error && typeof data.error === "object" && "message" in (data.error as object)
      ? String((data.error as { message: unknown }).message)
      : response.statusText;
    throw new VercelError(`Vercel respondeu ${response.status}: ${message}`);
  }
  const deployment = data as DeploymentResponse;
  return { url: deployment.url ? `https://${deployment.url}` : null, estado: deployment.readyState ?? null, id: deployment.id ?? null };
}
