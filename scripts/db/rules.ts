// Regras de qualidade para migrações: nome, imutabilidade, comandos destrutivos e verificações essenciais do esquema.
import type { SnapshotRow } from "./snapshot.ts";

// Última migração da baseline (já aplicada em produção antes desta regra). As anteriores são históricas e não passam pela guarda.
export const BASELINE_LAST_VERSION = "20261009180911";

export const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

// Comandos que perdem dados ou mudam o contrato. Exigem a marcação "-- destrutivo-aprovado: <quem aprovou e por quê>".
const DESTRUCTIVE: { pattern: RegExp; label: string }[] = [
  { pattern: /\bdrop\s+table\b/i, label: "drop table" },
  { pattern: /\bdrop\s+column\b/i, label: "drop column" },
  { pattern: /\btruncate\b/i, label: "truncate" },
  { pattern: /\bdrop\s+schema\b/i, label: "drop schema" },
  { pattern: /\bdelete\s+from\s+[\w.]+\s*;/i, label: "delete sem where" },
  { pattern: /\bdrop\s+(function|policy|index|constraint|type|trigger|extension)\b/i, label: "drop de objeto" },
  { pattern: /\balter\s+table\s+[\w.]+\s+alter\s+column\s+\w+\s+(type|set\s+data\s+type)\b/i, label: "mudança de tipo de coluna" },
  { pattern: /\balter\s+table\s+[\w.]+\s+disable\s+row\s+level\s+security\b/i, label: "desligar RLS" },
];

export const APPROVAL_MARK = /--\s*destrutivo-aprovado:\s*\S+/i;

export function findDestructive(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  return DESTRUCTIVE.filter((d) => d.pattern.test(clean)).map((d) => d.label);
}

export function hasApprovalMark(sql: string): boolean {
  return APPROVAL_MARK.test(sql);
}

export function checkNames(files: string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!MIGRATION_NAME.test(f)) problems.push(`${f}: nome fora do padrão AAAAMMDDHHMMSS_descricao_em_snake_case.sql`);
    const version = f.slice(0, 14);
    if (seen.has(version)) problems.push(`${f}: versão ${version} repetida`);
    seen.add(version);
  }
  return problems;
}

// Itens que o banco precisa ter para a Maia funcionar. Se uma migração futura remover algum, a validação falha.
export const ESSENTIAL_TABLES = [
  "inbox", "events", "messages", "tasks", "task_events", "approvals", "agent_runs", "message_batches", "batch_items",
  "people", "person_numbers", "person_permissions", "permission_catalog", "maia_rules", "maia_groups", "group_messages",
  "contacts", "outreach", "scheduled_actions", "knowledge_sources", "knowledge_chunks", "provider_health", "image_quota",
  "jev_triage", "group_activity", "snapshots", "seen_messages", "kv",
];

// Funções chamadas pelo código e quem pode executá-las. "service" = só o servidor; "authenticated" = também o painel logado.
export const ESSENTIAL_FUNCTIONS: Record<string, "service" | "authenticated"> = {
  "claim_inbox(p_limit integer)": "service",
  "purge_inbox_payloads()": "service",
  "record_group_activity(p_jid text, p_at timestamp with time zone)": "service",
  "add_batch_item(p_conversa text, p_inbox_id bigint, p_text text, p_window_s integer, p_max_s integer)": "service",
  "due_owner_batches()": "service",
  "search_knowledge(p_query text, p_embedding extensions.vector, p_limit integer)": "service",
  "claim_image_quota(p_dia date, p_limit integer)": "service",
  "release_image_quota(p_dia date)": "service",
  "claim_due_actions(p_limit integer)": "service",
  "purge_group_messages()": "service",
  "is_owner()": "authenticated",
};

export const ESSENTIAL_CONSTRAINTS = ["people.people_role_check", "inbox.inbox_sender_check", "inbox.inbox_kind_check", "inbox.inbox_status_check"];

export function checkEssentials(rows: SnapshotRow[]): string[] {
  const problems: string[] = [];
  const byKind = (kind: string) => new Map(rows.filter((r) => r.kind === kind).map((r) => [r.name, r.detail]));
  const tables = byKind("tabela");
  const functions = byKind("funcao");
  const constraints = new Set([...byKind("constraint").keys()].map((k) => k.replace(/^public\./, "")));

  for (const t of ESSENTIAL_TABLES) {
    const detail = tables.get(t);
    if (!detail) problems.push(`tabela essencial ausente: ${t}`);
    else if (!detail.startsWith("rls=true")) problems.push(`RLS desligado em ${t}`);
  }
  for (const [name, t] of tables) if (!t.startsWith("rls=true")) problems.push(`RLS desligado em ${name}`);

  for (const [signature, who] of Object.entries(ESSENTIAL_FUNCTIONS)) {
    const detail = functions.get(signature);
    if (!detail) {
      problems.push(`função essencial ausente: ${signature}`);
      continue;
    }
    if (!detail.includes("service=true")) problems.push(`${signature}: service_role sem permissão de execução`);
    if (who === "service" && (!detail.includes("anon=false") || !detail.includes("auth=false"))) problems.push(`${signature}: anon/authenticated não deveriam executar`);
    if (who === "authenticated" && !detail.includes("anon=false")) problems.push(`${signature}: anon não deveria executar`);
  }
  for (const c of ESSENTIAL_CONSTRAINTS) if (!constraints.has(c)) problems.push(`constraint essencial ausente: ${c}`);

  // Nenhuma tabela pode estar aberta a anon: anon não lê nem escreve nada no schema public.
  for (const r of rows.filter((x) => x.kind === "politica" && /roles=\S*anon/.test(x.detail))) problems.push(`política aberta ao papel anon: ${r.name}`);
  return problems;
}
