import { z } from "zod";
import type { Db } from "./store.ts";

export const skillFrontmatterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
  version: z.string().min(1).max(40),
  description: z.string().min(1).max(500),
  scope: z.string().min(1).max(120),
  tools: z.string().optional().default(""),
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export interface SkillDocument extends SkillFrontmatter { instructions: string; toolNames: string[] }
export interface ActiveSkill { id: string; slug: string; version: string; description: string; instructions: string; scope: Record<string, unknown>; tools: string[]; status: "proposal" | "active" | "archived"; approved_by: string | null; approved_at: string | null }

export function parseSkillMarkdown(markdown: string): SkillDocument {
  const match = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) throw new Error("Skill inválida: frontmatter obrigatório");
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (pair) values[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/g, "");
  }
  const front = skillFrontmatterSchema.parse(values);
  return { ...front, toolNames: front.tools.split(",").map((x) => x.trim()).filter(Boolean), instructions: match[2].trim() };
}

export function skillMatches(skill: Pick<ActiveSkill, "description" | "scope" | "tools">, query: string, authorizedTools: ReadonlySet<string>): boolean {
  const terms = query.toLocaleLowerCase("pt-BR").split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 2);
  const haystack = `${skill.description} ${JSON.stringify(skill.scope)} ${skill.tools.join(" ")}`.toLocaleLowerCase("pt-BR");
  return terms.some((term) => haystack.includes(term)) && skill.tools.every((tool) => authorizedTools.has(tool));
}

export async function listActiveSkills(db: Db, limit = 100): Promise<ActiveSkill[]> {
  const { data, error } = await db.from("maia_skills").select("id,slug,version,description,instructions,scope,tools,status,approved_by,approved_at").eq("status", "active").order("slug").limit(Math.min(limit, 200));
  if (error) throw new Error(`Skills indisponíveis: ${error.message}`);
  return (data ?? []) as ActiveSkill[];
}

export async function relevantSkills(db: Db, query: string, authorizedTools: ReadonlySet<string>, limit = 5): Promise<ActiveSkill[]> {
  return (await listActiveSkills(db, 200)).filter((skill) => skillMatches(skill, query, authorizedTools)).slice(0, Math.max(1, Math.min(limit, 20)));
}

export async function proposeSkill(db: Db, markdown: string, sourceTaskId?: number | null): Promise<string> {
  const parsed = parseSkillMarkdown(markdown);
  const { data, error } = await db.from("maia_skills").insert({ slug: parsed.id, version: parsed.version, description: parsed.description, instructions: parsed.instructions, scope: { value: parsed.scope, source_task_id: sourceTaskId ?? null }, tools: parsed.toolNames, status: "proposal" }).select("id").single();
  if (error || !data) throw new Error(`Não consegui propor skill: ${error?.message ?? "sem retorno"}`);
  return String(data.id);
}

export async function recordSkillEvent(db: Db, skillId: string, input: { outcome: "loaded" | "succeeded" | "failed" | "proposed"; sessionId?: string | null; taskId?: number | null; detail?: string; metadata?: Record<string, unknown> }): Promise<void> {
  const { error } = await db.from("maia_skill_events").insert({ skill_id: skillId, session_id: input.sessionId ?? null, task_id: input.taskId ?? null, outcome: input.outcome, detail: input.detail?.slice(0, 2000) ?? null, metadata: input.metadata ?? {} });
  if (error) throw new Error(`Não consegui registrar uso da skill: ${error.message}`);
}
