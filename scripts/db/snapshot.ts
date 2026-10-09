// Retrato do esquema do schema public: tabelas, colunas, constraints, índices, funções (com privilégios efetivos),
// gatilhos e políticas RLS. O MESMO SQL roda no banco temporário (migrações aplicadas) e no Supabase real (somente leitura),
// e os dois retratos são comparados. Não inclui dados nem segredos.

export const SNAPSHOT_SQL = `
with
tabelas as (
  select 'tabela' as kind, c.relname::text as name,
         'rls=' || c.relrowsecurity::text || ' force=' || c.relforcerowsecurity::text as detail
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
colunas as (
  select 'coluna', c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || case when a.attidentity::text <> '' then ' identity=' || a.attidentity::text else '' end
         || case when a.attgenerated::text <> '' then ' generated' else '' end
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
),
restricoes as (
  select 'constraint', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
   where n.nspname = 'public' and c.contype <> 'n' -- NOT NULL já aparece na coluna (PG 18 lista como constraint, PG 17 não)
),
indices as (
  select 'indice', indexname::text, indexdef from pg_indexes where schemaname = 'public'
),
funcoes as (
  select 'funcao', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         case when p.proname = 'rls_auto_enable' then 'platform-owned' else
         'lang=' || l.lanname
         || ' secdef=' || p.prosecdef::text
         || ' vol=' || p.provolatile::text
         || ' ret=' || pg_get_function_result(p.oid)
         || ' cfg=' || coalesce(array_to_string(p.proconfig, ','), '')
         || ' src=' || md5(p.prosrc) end
         || ' exec(anon=' || has_function_privilege('anon', p.oid, 'execute')::text
         || ',auth=' || has_function_privilege('authenticated', p.oid, 'execute')::text
         || ',service=' || has_function_privilege('service_role', p.oid, 'execute')::text || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.prokind = 'f'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
gatilhos as (
  select 'gatilho', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
),
politicas as (
  select 'politica', tablename || '.' || policyname,
         'cmd=' || cmd || ' roles=' || array_to_string(roles, ',') || ' permissive=' || permissive
         || ' using=' || coalesce(qual, '') || ' check=' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
),
privilegios as (
  select 'privilegio', c.relname || ' ' || r.rolname,
         'select=' || has_table_privilege(r.rolname, c.oid, 'select')::text
         || ' insert=' || has_table_privilege(r.rolname, c.oid, 'insert')::text
         || ' update=' || has_table_privilege(r.rolname, c.oid, 'update')::text
         || ' delete=' || has_table_privilege(r.rolname, c.oid, 'delete')::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
   where n.nspname = 'public' and c.relkind = 'r'
),
extensoes as (
  select 'extensao', extname::text, 'instalada' from pg_extension where extname in ('vector')
)
select kind, name, detail from (
  select * from tabelas union all select * from colunas union all select * from restricoes union all
  select * from indices union all select * from funcoes union all select * from gatilhos union all
  select * from politicas union all select * from privilegios union all select * from extensoes
) s order by kind, name
`;

export interface SnapshotRow {
  kind: string;
  name: string;
  detail: string;
}

export interface Diff {
  onlyExpected: SnapshotRow[]; // nas migrações, ausente no banco real
  onlyActual: SnapshotRow[]; // no banco real, ausente nas migrações
  changed: { kind: string; name: string; expected: string; actual: string }[];
}

function normalize(row: SnapshotRow): SnapshotRow {
  return { ...row, detail: row.detail.replace(/\s+/g, " ").trim() };
}

export function diffSnapshots(expected: SnapshotRow[], actual: SnapshotRow[]): Diff {
  const key = (r: SnapshotRow) => `${r.kind}|${r.name}`;
  const exp = new Map(expected.map((r) => [key(r), normalize(r)]));
  const act = new Map(actual.map((r) => [key(r), normalize(r)]));
  const diff: Diff = { onlyExpected: [], onlyActual: [], changed: [] };
  for (const [k, row] of exp) {
    const other = act.get(k);
    if (!other) diff.onlyExpected.push(row);
    else if (other.detail !== row.detail) diff.changed.push({ kind: row.kind, name: row.name, expected: row.detail, actual: other.detail });
  }
  for (const [k, row] of act) if (!exp.has(k)) diff.onlyActual.push(row);
  return diff;
}

export function hasDrift(diff: Diff): boolean {
  return diff.onlyExpected.length + diff.onlyActual.length + diff.changed.length > 0;
}

// Relatório em Markdown. Mostra estrutura (nomes, tipos, políticas); nunca dados nem segredos.
export function formatDiff(diff: Diff): string {
  if (!hasDrift(diff)) return "Sem divergência: o banco real bate com as migrações do repositório.\n";
  const lines: string[] = ["# Divergência de esquema (drift)\n"];
  const block = (title: string, rows: SnapshotRow[]) => {
    if (rows.length === 0) return;
    lines.push(`## ${title} (${rows.length})`);
    for (const r of rows) lines.push(`- **${r.kind}** \`${r.name}\`: ${r.detail.slice(0, 300)}`);
    lines.push("");
  };
  block("Existe no banco real, mas não nas migrações", diff.onlyActual);
  block("Existe nas migrações, mas não no banco real", diff.onlyExpected);
  if (diff.changed.length > 0) {
    lines.push(`## Diferente entre migrações e banco real (${diff.changed.length})`);
    for (const c of diff.changed) lines.push(`- **${c.kind}** \`${c.name}\`\n  - migrações: ${c.expected.slice(0, 300)}\n  - banco real: ${c.actual.slice(0, 300)}`);
    lines.push("");
  }
  lines.push("Correção: crie uma NOVA migração que leve o repositório e o banco ao mesmo estado (ou reverta a alteração manual com aprovação do owner). Nunca edite migração já aplicada.");
  return lines.join("\n") + "\n";
}
