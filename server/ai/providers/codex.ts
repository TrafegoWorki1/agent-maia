import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { minimalEnv } from "../../imagegen.ts";

// Codex como provedor de TEXTO, só para tarefas compatíveis (conversa e resumo) quando o Claude está indisponível.
// Modo somente leitura, sem sessão guardada, sem credenciais do projeto e sem nenhuma ferramenta da Maia.
// O pedido entra pela entrada padrão, nunca pela linha de comando.
const TEMP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "arte", "ai-temp");

export type CodexTextResult = { ok: true; text: string; durationMs: number } | { ok: false; error: string; durationMs: number };

export function buildCodexPrompt(input: { rules: string; context: string; request: string }): string {
  return [
    input.rules,
    "",
    "Aviso: neste momento você responde sem acesso a conectores nem a ações. Se o pedido exigir consultar dados (e-mail, anúncios, planilha, agenda) ou executar algo, diga em uma frase que isso volta quando o serviço principal estiver disponível. Não invente dados.",
    input.context ? `\nConversa recente (apenas para entender o pedido, não repita):\n${input.context}` : "",
    "",
    `Pedido atual:\n${input.request}`,
  ].join("\n");
}

export async function runCodexText(input: { prompt: string; timeoutMs: number; model: string | null }): Promise<CodexTextResult> {
  const t0 = Date.now();
  const folder = join(TEMP, randomBytes(4).toString("hex"));
  mkdirSync(folder, { recursive: true });
  const outFile = join(folder, "resposta.txt");
  const args = ["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "-C", folder, "-o", outFile];
  if (input.model) args.push("-m", input.model);
  args.push("-");

  return new Promise<CodexTextResult>((resolvePromise) => {
    const child = spawn("codex", args, { shell: true, cwd: folder, env: minimalEnv(), windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 1500) stderr += String(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({ ok: false, error: "tempo esgotado no Codex", durationMs: Date.now() - t0 });
    }, input.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ ok: false, error: `não consegui iniciar o Codex: ${error.message}`, durationMs: Date.now() - t0 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - t0;
      if (code !== 0) return resolvePromise({ ok: false, error: `Codex terminou com código ${code}. ${stderr.trim().slice(-200)}`, durationMs });
      const text = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
      if (!text) return resolvePromise({ ok: false, error: "o Codex não devolveu resposta", durationMs });
      resolvePromise({ ok: true, text, durationMs });
    });
    child.stdin?.end(input.prompt);
  });
}
