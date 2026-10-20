import { z } from "zod";
import type { Db } from "./store.ts";
import { readFile, saveFile } from "./integrations/github.ts";
import { createDeployment, VercelError } from "./integrations/vercel.ts";

// Ferramentas de site, compartilhadas pelos dois executores (Claude e Codex), no mesmo molde de `githubTools`.
// Decisão do owner (20/10/2026): o pedido escolhe o caminho, sem fluxo fixo.
//   - `site_subir_github`: grava sites/<nome>/index.html no repositório fixo (commit). Sempre com OK do owner.
//   - `site_publicar_vercel`: publica na Vercel. Usa o HTML do pedido ou, se não vier, o arquivo já salvo no repositório.
//     Deploy automático, sem OK (ação já pedida pelo owner).
// O repositório é fixo (MAIA_SITES_REPO no .env), não escolhido pelo pedido. Membro só usa com site.publicar.

export interface SiteTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (db: Db, input: unknown) => Promise<unknown>;
}

const SLUG = z.string().regex(/^[a-z0-9-]{1,60}$/, "use letras minúsculas, números e hífen").describe("Identificador curto do site (vira o caminho e o nome do projeto na Vercel).");
const HTML = z.string().min(1).max(300_000).describe("Conteúdo HTML completo do site.");

function define<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (db: Db, input: z.infer<z.ZodObject<S>>) => Promise<unknown>): SiteTool {
  const schema = z.object(shape);
  return { name, description, schema: schema as unknown as z.ZodObject<z.ZodRawShape>, run: async (db, input) => run(db, schema.parse(input)) };
}

function sitesRepo(): string {
  const repo = process.env.MAIA_SITES_REPO?.trim();
  if (!repo) throw new Error("Publicação de site não configurada: falta MAIA_SITES_REPO no .env do servidor (repositório dono/nome).");
  return repo;
}

const sitePath = (slug: string) => `sites/${slug}/index.html`;

export const siteTools: SiteTool[] = [
  define(
    "site_subir_github",
    "Grava o HTML de um site no repositório de sites (um commit em sites/<slug>/index.html). Não publica na Vercel. " +
      "Ação que altera algo externo: só roda depois do OK do owner.",
    {
      slug: SLUG,
      html: HTML,
      mensagem: z.string().min(1).max(200).describe("Mensagem do commit."),
    },
    async (db, i) => {
      const repo = sitesRepo();
      const commit = await saveFile(db, { repo, path: sitePath(i.slug), content: i.html, message: i.mensagem });
      return { commitUrl: commit.url, repo, caminho: sitePath(i.slug), acao: commit.acao };
    },
  ),
  define(
    "site_publicar_vercel",
    "Publica um site na Vercel (deploy de produção). Se `html` vier, publica esse HTML; se não vier, publica o arquivo já salvo " +
      "em sites/<slug>/index.html do repositório (é preciso ter subido antes). Não faz commit. Não pede OK: o owner já pediu a publicação.",
    {
      slug: SLUG,
      html: HTML.optional().describe("HTML a publicar. Se omitido, usa o arquivo salvo no repositório."),
    },
    async (db, i) => {
      const repo = sitesRepo();
      let content = i.html;
      if (content === undefined) {
        content = (await readFile(db, { repo, path: sitePath(i.slug) })) ?? undefined;
        if (content === undefined) throw new Error(`Não encontrei ${sitePath(i.slug)} em ${repo}. Suba o site no GitHub antes de publicar, ou envie o HTML.`);
      }
      try {
        const deploy = await createDeployment(db, { project: i.slug, fileName: "index.html", content });
        return { repo, deployUrl: deploy.url, deployEstado: deploy.estado, origem: i.html === undefined ? "repositório" : "HTML do pedido" };
      } catch (error) {
        const motivo = error instanceof VercelError ? error.message : "falha inesperada ao publicar na Vercel";
        throw new Error(`Falha ao publicar na Vercel: ${motivo}`);
      }
    },
  ),
];
