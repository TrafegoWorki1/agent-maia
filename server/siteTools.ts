import { z } from "zod";
import type { Db } from "./store.ts";
import { saveFile } from "./integrations/github.ts";
import { createDeployment, VercelError } from "./integrations/vercel.ts";

// Ferramenta de publicação de site, compartilhada pelos dois executores (Claude e Codex), no mesmo molde de `githubTools`.
// Decisão do owner (20/10/2026, ampliando a decisão do GitHub do mesmo dia): a Maia pode gerar um site em HTML, mandar
// no chat e publicar com `site_publicar` — commit sempre com OK do owner (mesma regra do GitHub), deploy na Vercel
// automático dentro da mesma ação (sem pedir OK de novo). Repositório fixo (MAIA_SITES_REPO no .env), não escolhido
// pelo pedido. Membro só usa com a permissão site.publicar; sem ela, o pedido é negado antes de chegar ao owner.

export interface SiteTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (db: Db, input: unknown) => Promise<unknown>;
}

const SLUG = z.string().regex(/^[a-z0-9-]{1,60}$/, "use letras minúsculas, números e hífen").describe("Identificador curto do site (vira o caminho e o nome do projeto na Vercel).");

function define<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (db: Db, input: z.infer<z.ZodObject<S>>) => Promise<unknown>): SiteTool {
  const schema = z.object(shape);
  return { name, description, schema: schema as unknown as z.ZodObject<z.ZodRawShape>, run: async (db, input) => run(db, schema.parse(input)) };
}

function sitesRepo(): string {
  const repo = process.env.MAIA_SITES_REPO?.trim();
  if (!repo) throw new Error("Publicação de site não configurada: falta MAIA_SITES_REPO no .env do servidor (repositório dono/nome).");
  return repo;
}

export const siteTools: SiteTool[] = [
  define(
    "site_publicar",
    "Cria ou atualiza um site de uma página (HTML único) e publica. Ação que altera algo externo: só roda depois do OK do " +
      "owner. O commit vai para o repositório fixo de sites; o deploy na Vercel acontece na mesma chamada, sem pedir OK de novo.",
    {
      slug: SLUG,
      html: z.string().min(1).max(300_000).describe("Conteúdo HTML completo do site."),
      mensagem: z.string().min(1).max(200).describe("Mensagem do commit."),
    },
    async (db, i) => {
      const repo = sitesRepo();
      const commit = await saveFile(db, { repo, path: `sites/${i.slug}/index.html`, content: i.html, message: i.mensagem });
      try {
        const deploy = await createDeployment(db, { project: i.slug, fileName: "index.html", content: i.html });
        return { commitUrl: commit.url, repo, deployUrl: deploy.url, deployEstado: deploy.estado };
      } catch (error) {
        const motivo = error instanceof VercelError ? error.message : "falha inesperada ao publicar na Vercel";
        return { commitUrl: commit.url, repo, deployUrl: null, deployEstado: null, aviso: `Commit feito, mas o deploy na Vercel falhou: ${motivo}` };
      }
    },
  ),
];
