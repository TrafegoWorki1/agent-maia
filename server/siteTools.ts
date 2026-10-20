import { z } from "zod";
import type { Db } from "./store.ts";
import { assertPrivateRepo, readFile, REPO_REF, saveFile } from "./integrations/github.ts";
import { createDeployment, VercelError } from "./integrations/vercel.ts";

// Ferramentas de site, compartilhadas pelos dois executores (Claude e Codex), no mesmo molde de `githubTools`.
// O pedido escolhe o caminho e o repositório (dono/nome), sem repositório fixo no servidor. O repositório precisa existir
// e ser privado (conferido no GitHub antes de gravar ou ler).
//   - `site_subir_github`: grava sites/<slug>/index.html no repositório (commit). Sempre com OK do owner.
//   - `site_publicar_vercel`: publica na Vercel. Usa o HTML do pedido ou, se não vier, o arquivo já salvo no repositório.
//     Deploy automático, sem OK (ação já pedida pelo owner).
// Membro só usa com a permissão site.publicar (conferida em access.ts).

export interface SiteTool {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  run: (db: Db, input: unknown) => Promise<unknown>;
}

const SLUG = z.string().regex(/^[a-z0-9-]{1,60}$/, "use letras minúsculas, números e hífen").describe("Identificador curto do site (vira o caminho e o nome do projeto na Vercel).");
const HTML = z.string().min(1).max(300_000).describe("Conteúdo HTML completo do site.");
const REPO = z.string().regex(REPO_REF, "use o formato dono/nome").describe("Repositório privado (dono/nome) onde o site fica. Use o repositório que o owner indicou ou o que você acabou de criar.");

function define<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (db: Db, input: z.infer<z.ZodObject<S>>) => Promise<unknown>): SiteTool {
  const schema = z.object(shape);
  return { name, description, schema: schema as unknown as z.ZodObject<z.ZodRawShape>, run: async (db, input) => run(db, schema.parse(input)) };
}

const sitePath = (slug: string) => `sites/${slug}/index.html`;

export const siteTools: SiteTool[] = [
  define(
    "site_subir_github",
    "Grava o HTML de um site num repositório privado (um commit em sites/<slug>/index.html). Não publica na Vercel. " +
      "Ação que altera algo externo: só roda depois do OK do owner.",
    {
      repo: REPO,
      slug: SLUG,
      html: HTML,
      mensagem: z.string().min(1).max(200).describe("Mensagem do commit."),
    },
    async (db, i) => {
      await assertPrivateRepo(db, i.repo);
      const commit = await saveFile(db, { repo: i.repo, path: sitePath(i.slug), content: i.html, message: i.mensagem });
      return { commitUrl: commit.url, repo: i.repo, caminho: sitePath(i.slug), acao: commit.acao };
    },
  ),
  define(
    "site_publicar_vercel",
    "Publica um site na Vercel (deploy de produção). Se `html` vier, publica esse HTML; se não vier, publica o arquivo já salvo " +
      "em sites/<slug>/index.html do repositório informado (é preciso ter subido antes). Não faz commit. Não pede OK: o owner já pediu.",
    {
      repo: REPO,
      slug: SLUG,
      html: HTML.optional().describe("HTML a publicar. Se omitido, usa o arquivo salvo no repositório."),
    },
    async (db, i) => {
      let content = i.html;
      if (content === undefined) {
        await assertPrivateRepo(db, i.repo);
        content = (await readFile(db, { repo: i.repo, path: sitePath(i.slug) })) ?? undefined;
        if (content === undefined) throw new Error(`Não encontrei ${sitePath(i.slug)} em ${i.repo}. Suba o site no GitHub antes de publicar, ou envie o HTML.`);
      }
      try {
        const deploy = await createDeployment(db, { project: i.slug, fileName: "index.html", content });
        return { repo: i.repo, deployUrl: deploy.url, deployEstado: deploy.estado, origem: i.html === undefined ? "repositório" : "HTML do pedido" };
      } catch (error) {
        const motivo = error instanceof VercelError ? error.message : "falha inesperada ao publicar na Vercel";
        throw new Error(`Falha ao publicar na Vercel: ${motivo}`);
      }
    },
  ),
];
