import { sendTextChecked } from "./evolutionSend.ts";
import type { Db } from "./store.ts";

// Prospecção pedida pelo dono (Fase 4): uma lista de contatos e uma mensagem final. Cada envio é uma ação aprovada
// (OK do dono a cada contato). Limites: teto diário, sem repetir contato, descadastro obrigatório na mensagem e checagem
// de WhatsApp antes de gravar o lote. Nada aqui envia por conta própria: quem chama é a ferramenta, que pede aprovação.

export const DAILY_CAP = 30;
export const BATCH_MAX = 200;
export const RECONTACT_DAYS = 30;
const NUMBER = /^[0-9]{12,13}$/;

export function normalizeNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return NUMBER.test(digits) ? digits : null;
}

// A mensagem precisa ensinar como sair: a palavra SAIR, em qualquer caixa, em qualquer lugar do texto.
export function hasOptOutLine(text: string): boolean {
  return /\bSAIR\b/i.test(text);
}

export function remainingToday(sentToday: number): number {
  return Math.max(0, DAILY_CAP - sentToday);
}

// Início do dia de hoje em São Paulo (UTC-3, sem horário de verão desde 2019).
export function startOfTodaySaoPaulo(now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return `${day}T00:00:00-03:00`;
}

export interface PlanInput {
  items: Array<{ numero: string; nome: string }>;
  optouts: ReadonlySet<string>;
  contacted: ReadonlySet<string>;
  onWhatsApp: ReadonlySet<string>;
}
export interface Plan {
  accepted: Array<{ number: string; name: string }>;
  skipped: Array<{ number: string; motivo: string }>;
}

// Decide, contato por contato, quem entra no lote e por quê os outros ficam de fora.
export function planBatch(input: PlanInput): Plan {
  const accepted: Plan["accepted"] = [];
  const skipped: Plan["skipped"] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const number = normalizeNumber(item.numero);
    if (!number) { skipped.push({ number: item.numero, motivo: "número inválido (use DDI+DDD+número)" }); continue; }
    if (seen.has(number)) { skipped.push({ number, motivo: "repetido na mesma lista" }); continue; }
    seen.add(number);
    if (input.optouts.has(number)) { skipped.push({ number, motivo: "pediu para sair" }); continue; }
    if (input.contacted.has(number)) { skipped.push({ number, motivo: `já foi contatado nos últimos ${RECONTACT_DAYS} dias ou em outro lote` }); continue; }
    if (!input.onWhatsApp.has(number)) { skipped.push({ number, motivo: "sem WhatsApp" }); continue; }
    accepted.push({ number, name: item.nome.trim().slice(0, 80) });
  }
  return { accepted, skipped };
}

// Confere na Evolution quais números têm WhatsApp, em lotes de 50.
export async function checkWhatsApp(numbers: string[]): Promise<{ ok: true; onWhatsApp: Set<string> } | { ok: false; error: string }> {
  const url = process.env.EVOLUTION_API_URL;
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE;
  if (!url || !key || !instance) return { ok: false, error: "Evolution não configurada no .env" };
  const found = new Set<string>();
  for (let i = 0; i < numbers.length; i += 50) {
    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, "")}/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify({ numbers: numbers.slice(i, i + 50) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { ok: false, error: "não consegui checar quais números têm WhatsApp" };
    }
    if (!res.ok) return { ok: false, error: `a Evolution respondeu HTTP ${res.status} na checagem de WhatsApp` };
    const body = (await res.json().catch(() => null)) as unknown;
    for (const row of Array.isArray(body) ? body : []) {
      const r = row as { exists?: unknown; number?: unknown };
      if (r.exists === true && typeof r.number === "string") found.add(r.number.replace(/\D/g, ""));
    }
  }
  return { ok: true, onWhatsApp: found };
}

export async function prepareBatch(db: Db, input: { nome: string; texto: string; contatos: Array<{ numero: string; nome?: string }> }): Promise<{ ok: true; lote: number; aceitos: number; ignorados: Plan["skipped"] } | { ok: false; error: string }> {
  if (!hasOptOutLine(input.texto)) return { ok: false, error: 'a mensagem precisa ensinar como sair, com a palavra SAIR (ex.: "Para não receber mais, responda SAIR.")' };
  if (input.contatos.length > BATCH_MAX) return { ok: false, error: `o lote aceita no máximo ${BATCH_MAX} contatos` };

  const { data: optRows, error: optErr } = await db.from("maia_optouts").select("number");
  if (optErr) return { ok: false, error: `não consegui ler a lista de descadastro: ${optErr.message}` };
  const since = new Date(Date.now() - RECONTACT_DAYS * 24 * 3600_000).toISOString();
  const { data: sentRows, error: sentErr } = await db.from("maia_prospects").select("number").eq("status", "sent");
  if (sentErr) return { ok: false, error: `não consegui ler os envios anteriores: ${sentErr.message}` };
  const { data: recentRows, error: recentErr } = await db.from("outreach").select("number").gte("at", since);
  if (recentErr) return { ok: false, error: `não consegui ler as mensagens recentes: ${recentErr.message}` };

  const optouts = new Set((optRows ?? []).map((r) => String(r.number)));
  const contacted = new Set([...(sentRows ?? []), ...(recentRows ?? [])].map((r) => String(r.number)));
  const candidates = [...new Set(input.contatos.map((c) => normalizeNumber(c.numero)).filter((n): n is string => Boolean(n)))]
    .filter((n) => !optouts.has(n) && !contacted.has(n));

  const check = candidates.length ? await checkWhatsApp(candidates) : { ok: true as const, onWhatsApp: new Set<string>() };
  if (!check.ok) return { ok: false, error: check.error };

  const plan = planBatch({ items: input.contatos.map((c) => ({ numero: c.numero, nome: c.nome ?? "" })), optouts, contacted, onWhatsApp: check.onWhatsApp });
  if (!plan.accepted.length) return { ok: false, error: "nenhum contato da lista pode receber a mensagem" };

  const { data: batch, error: batchErr } = await db.from("maia_prospect_batches").insert({ name: input.nome.trim(), text: input.texto.trim() }).select("id").single();
  if (batchErr || !batch) return { ok: false, error: `não consegui criar o lote: ${batchErr?.message ?? "sem resposta"}` };
  const lote = Number(batch.id);
  const { error: rowsErr } = await db.from("maia_prospects").insert(plan.accepted.map((a) => ({ batch_id: lote, number: a.number, name: a.name, status: "pending" })));
  if (rowsErr) {
    await db.from("maia_prospect_batches").delete().eq("id", lote);
    return { ok: false, error: `não consegui gravar os contatos do lote: ${rowsErr.message}` };
  }
  return { ok: true, lote, aceitos: plan.accepted.length, ignorados: plan.skipped };
}

// Envia a próxima mensagem pendente do lote. A ferramenta que chama esta função já passou pelo OK do dono.
export async function sendNextProspect(db: Db, lote: number): Promise<{ ok: true; mensagem: string } | { ok: false; error: string }> {
  const { count: sentToday, error: capErr } = await db.from("maia_prospects").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", startOfTodaySaoPaulo());
  if (capErr) return { ok: false, error: `não consegui conferir o teto diário: ${capErr.message}` };
  if (remainingToday(sentToday ?? 0) === 0) return { ok: false, error: `teto diário de ${DAILY_CAP} envios atingido; o lote continua amanhã` };

  const { data: batch } = await db.from("maia_prospect_batches").select("text").eq("id", lote).maybeSingle();
  if (!batch) return { ok: false, error: `lote ${lote} não existe` };
  const { data: next, error: nextErr } = await db.from("maia_prospects").select("id, number, name").eq("batch_id", lote).eq("status", "pending").order("id").limit(1).maybeSingle();
  if (nextErr) return { ok: false, error: `não consegui ler o lote: ${nextErr.message}` };
  if (!next) return { ok: false, error: `não há mais contatos pendentes no lote ${lote}` };

  const { data: optout } = await db.from("maia_optouts").select("number").eq("number", next.number).maybeSingle();
  if (optout) {
    await db.from("maia_prospects").update({ status: "skipped", note: "pediu para sair" }).eq("id", next.id);
    return { ok: false, error: `pulei ${next.name || next.number}: pediu para sair. Rode de novo para o próximo contato.` };
  }

  let messageId: string;
  try {
    messageId = await sendTextChecked(String(next.number), String(batch.text));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await db.from("maia_prospects").update({ status: "failed", note: reason.slice(0, 200) }).eq("id", next.id);
    return { ok: false, error: `não enviei para ${next.name || next.number}: ${reason}. Não repita sozinha.` };
  }
  const now = new Date().toISOString();
  await db.from("maia_prospects").update({ status: "sent", sent_at: now }).eq("id", next.id);
  await db.from("outreach").insert({ number: String(next.number), name: String(next.name ?? ""), text: String(batch.text), at: now });

  const { count: pending } = await db.from("maia_prospects").select("id", { count: "exact", head: true }).eq("batch_id", lote).eq("status", "pending");
  const sentNow = (sentToday ?? 0) + 1;
  return { ok: true, mensagem: `Enviado para ${next.name || `+${next.number}`} (mensagem ${messageId}). Hoje: ${sentNow} de ${DAILY_CAP}. Restam ${pending ?? 0} no lote ${lote}.` };
}

export async function addOptOut(db: Db, raw: string): Promise<{ ok: true; mensagem: string } | { ok: false; error: string }> {
  const number = normalizeNumber(raw);
  if (!number) return { ok: false, error: "número inválido (use DDI+DDD+número)" };
  const { error } = await db.from("maia_optouts").upsert({ number }, { onConflict: "number" });
  if (error) return { ok: false, error: `não consegui registrar: ${error.message}` };
  await db.from("maia_prospects").update({ status: "skipped", note: "pediu para sair" }).eq("number", number).eq("status", "pending");
  return { ok: true, mensagem: `+${number} foi colocado na lista de descadastro. Nenhum lote vai mais contatar esse número.` };
}
