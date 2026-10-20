/**
 * Sincroniza as skills bundled como proposta e ativa atendimento-whatsapp e prospeccao-whatsapp.
 * Uso: pnpm tsx scripts/activate-bundled-skills.ts
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { parseSkillMarkdown, validateSkillSafety } from "../server/skills.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OWNER_KEY = (process.env.EVOLUTION_OWNER_NUMBER ?? "").replace(/\D/g, "");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const TO_ACTIVATE = ["atendimento-whatsapp", "prospeccao-whatsapp"];
const ALL_BUNDLED = ["diagnostico-operacional", "relatorio-marketing", "preparar-trabalho-criativo", "atendimento-whatsapp", "atendimento-instagram", "prospeccao-whatsapp", "prospeccao-instagram"];

// 1. Sincroniza propostas
console.log("Sincronizando skills bundled...");
for (const name of ALL_BUNDLED) {
  const file = resolve(__dirname, "../skills", name, "SKILL.md");
  const skill = parseSkillMarkdown(readFileSync(file, "utf8"));
  const safetyErr = validateSkillSafety(skill.channel, skill.instructions);
  if (safetyErr) { console.warn(`⚠ ${name}: ${safetyErr}`); continue; }

  const { error } = await db.from("maia_skills").upsert(
    { slug: skill.id, version: skill.version, description: skill.description, instructions: skill.instructions, scope: { value: skill.scope, channel: skill.channel ?? null, origin: "bundled" }, tools: skill.toolNames, status: "proposal" },
    { onConflict: "slug,version", ignoreDuplicates: true }
  );
  if (error) console.error(`✗ sync ${name}: ${error.message}`);
  else console.log(`  sync ok: ${name}`);
}

// 2. Ativa as skills alvo
console.log("\nAtivando skills...");
const { data: skills, error: fetchErr } = await db
  .from("maia_skills")
  .select("id,slug,version,status")
  .in("slug", TO_ACTIVATE)
  .in("status", ["proposal", "active"])
  .order("updated_at", { ascending: false });

if (fetchErr) { console.error("Erro ao buscar:", fetchErr.message); process.exit(1); }

const seen = new Set<string>();
for (const skill of (skills ?? [])) {
  if (seen.has(skill.slug)) continue;
  seen.add(skill.slug);

  if (skill.status === "active") {
    console.log(`✓ ${skill.slug} já está ativa`);
    continue;
  }
  const { data, error: rpcErr } = await db.rpc("activate_maia_skill", { p_skill_id: skill.id, p_owner_key: OWNER_KEY });
  if (rpcErr) console.error(`✗ ${skill.slug}: ${rpcErr.message}`);
  else if (data) console.log(`✓ ${skill.slug} v${skill.version} ativada! (${skill.id})`);
  else console.log(`? ${skill.slug}: RPC retornou false`);
}
