import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A regra de contatos precisa dizer à Maia como fazer prospecção quando o dono pede. Sem isso ela recusava.
describe("regra de contatos com prospecção pedida pelo dono", () => {
  const rules = JSON.parse(readFileSync("config/maia-rules.json", "utf8")) as { rules: Array<{ codigo: string; texto: string; ordem: number; ativa: boolean }> };
  const regra = rules.rules.find((r) => r.codigo === "contatos_membros")!;
  // Usa a migration mais recente que atualiza contatos_membros (cresce a cada nova versão da regra).
  const allMigrations = readdirSync("supabase/migrations").sort();
  const latestContatos = [...allMigrations].reverse().find((f) => readFileSync(`supabase/migrations/${f}`, "utf8").includes("contatos_membros"))!;
  const migration = readFileSync(`supabase/migrations/${latestContatos}`, "utf8");

  it("cita as ferramentas, o OK a cada envio, o teto e o SAIR", () => {
    for (const trecho of ["prospeccao_preparar", "prospeccao_enviar_proximo", "prospeccao_descadastrar", "OK do owner", "30 envios", "SAIR", "Não inicie prospecção por conta própria"]) {
      expect(regra.texto, trecho).toContain(trecho);
    }
    expect(regra.ordem).toBe(30);
    expect(regra.ativa).toBe(true);
  });

  it("o texto da migração é exatamente o da regra", () => {
    expect(migration).toContain(regra.texto);
  });
});
