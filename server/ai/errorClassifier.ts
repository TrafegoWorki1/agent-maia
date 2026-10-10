import type { ErrorKind } from "./types.ts";

// Classifica um erro de execução. Só limite de uso, indisponibilidade e timeout permitem tentar outro provedor.
// Autenticação, permissão, ferramenta inexistente, orçamento e limite de passos NUNCA disparam fallback:
// trocar de modelo não resolve, e poderia contornar uma regra.
export interface ClassifiedError {
  kind: ErrorKind;
  retryAfterMs: number | null;
  fallbackAllowed: boolean;
  message: string;
}

const FALLBACK_KINDS: ErrorKind[] = ["rate_limit", "quota", "unavailable", "timeout"];

function parseRetryAfter(text: string): number | null {
  const header = /retry[- ]after[:= ]+(\d+)/i.exec(text);
  if (header) return Number(header[1]) * 1000;
  const human = /try again in (\d+)\s*(second|minute|hour)/i.exec(text);
  if (human) {
    const unit = human[2].toLowerCase();
    const factor = unit.startsWith("hour") ? 3_600_000 : unit.startsWith("minute") ? 60_000 : 1000;
    return Number(human[1]) * factor;
  }
  return null;
}

export function classifyError(input: unknown): ClassifiedError {
  const message = (input instanceof Error ? input.message : String(input ?? "")).slice(0, 500);
  const t = message.toLowerCase();
  let kind: ErrorKind = "unknown";
  // A ordem importa: erros de tarefa vêm antes dos de provedor.
  if (/error_max_budget|max.?budget/.test(t)) kind = "budget";
  else if (/error_max_turns|max.?turns/.test(t)) kind = "max_turns";
  else if (/unauthorized|\b401\b|not logged in|invalid api key|login required|authentication/.test(t)) kind = "auth";
  else if (/\b403\b|permission denied|not allowed|recusad|sem aprovação/.test(t)) kind = "permission";
  else if (/tool.*not found|unknown tool|no such tool/.test(t)) kind = "tool_missing";
  else if (/usage limit|(?:daily|weekly|monthly|token) limit|limit reached|hit your (?:daily|weekly|monthly|token)? ?limit|limit exceeded|quota|credit balance|exceeded your/.test(t)) kind = "quota";
  else if (/rate.?limit|too many requests|\b429\b|overloaded|\b529\b/.test(t)) kind = "rate_limit";
  else if (/\b50[234]\b|service unavailable|bad gateway|temporarily unavailable|econnreset|enotfound|fetch failed/.test(t)) kind = "unavailable";
  else if (/timed? ?out|etimedout|tempo esgotado/.test(t)) kind = "timeout";
  return { kind, retryAfterMs: parseRetryAfter(message), fallbackAllowed: FALLBACK_KINDS.includes(kind), message };
}
