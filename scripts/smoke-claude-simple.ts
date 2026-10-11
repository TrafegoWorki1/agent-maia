import { runClaudeSimple } from "../server/ai/providers/claudeSimple.ts";
import { parseJsonObject } from "../server/refreshJob.ts";

// Verificação manual do caminho usado pela atualização do painel: Claude Code CLI + conector da conta, só leitura.
// Lê apenas a CONTAGEM de calendários do Google Agenda (não imprime nomes) e confirma que outras ferramentas são recusadas.
//   pnpm smoke:claude-simple   (usa a conta logada; teto de US$ 0,50 como no refresh, haiku)
const used: string[] = [];
const answer = await runClaudeSimple({
  prompt: 'Liste os calendários do Google Agenda desta conta e responda SOMENTE com JSON no formato {"total": number}. Nunca altere nada.',
  systemPrompt: "Você atualiza o painel da Maia com dados de leitura. Nunca execute ações.",
  model: "haiku",
  maxTurns: 6,
  maxBudgetUsd: 0.5,
  allowTool: (name) => {
    used.push(name);
    return name === "mcp__claude_ai_Google_Calendar__list_calendars";
  },
});
const total = parseJsonObject(answer.text).total;
const ok = typeof total === "number" && used.some((n) => n === "mcp__claude_ai_Google_Calendar__list_calendars");
console.log(JSON.stringify({ calendarios: total, ferramentasConsultadas: used, custoUsd: answer.costUsd, ok }));
process.exit(ok ? 0 : 1);
