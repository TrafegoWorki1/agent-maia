// Consulta SOMENTE LEITURA ao Postgres do Supabase pela Management API. Usada para detectar divergência de esquema.
// Nunca grava: recusa qualquer SQL que não seja SELECT/WITH e usa a opção read_only da API.
// O token vem do ambiente (SUPABASE_ACCESS_TOKEN) e nunca é impresso.
import { loadLocalEnv } from "../../server/loadEnv.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export function projectRef(): string {
  loadLocalEnv();
  const ref = process.env.SUPABASE_PROJECT_REF ?? /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL ?? "")?.[1];
  if (!ref) throw new Error("Defina SUPABASE_PROJECT_REF (ou SUPABASE_URL).");
  return ref;
}

export function assertReadOnly(sql: string): void {
  // Tira comentários e textos entre aspas antes de procurar palavras de escrita.
  const text = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''").trim();
  if (!/^(select|with)\b/i.test(text)) throw new Error("Somente SELECT/WITH é permitido neste script.");
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do)\b/i.test(text)) throw new Error("O SQL contém comando de escrita.");
  if (text.replace(/;\s*$/, "").includes(";")) throw new Error("Apenas uma instrução por consulta.");
}

export async function remoteQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  assertReadOnly(sql);
  loadLocalEnv();
  // Alternativa explícita para quem já autenticou a CLI; não extrai nem copia seus tokens.
  if (process.env.MAIA_DB_READ_VIA_CLI === "1") {
    const linked=readFileSync(resolve("supabase/.temp/project-ref"),"utf8").trim();
    if(linked!==projectRef())throw new Error("O projeto vinculado à CLI difere do ambiente local.");
    const directory=mkdtempSync(join(tmpdir(),"maia-db-read-"));
    try{
      // A CLI inclui extensions no search_path; fixa public como no retrato temporário.
      // SET LOCAL afeta só esta transação de leitura, sem alterar esquema ou configuração persistida.
      const file=join(directory,"query.sql");writeFileSync(file,"set local search_path = public;\n"+sql);
      const output=process.platform==="win32"
        ?execFileSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command","supabase db query --linked --file $env:MAIA_DB_READ_FILE --output json"],{encoding:"utf8",env:{...process.env,MAIA_DB_READ_FILE:file},stdio:["ignore","pipe","pipe"],timeout:90_000,maxBuffer:16*1024*1024})
        :execFileSync("supabase",["db","query","--linked","--file",file,"--output","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"],timeout:90_000,maxBuffer:16*1024*1024});
      const result=JSON.parse(output) as {rows?:T[]};
      if(!Array.isArray(result.rows))throw new Error("Resposta da CLI sem registros.");
      return result.rows;
    }finally{rmSync(directory,{recursive:true,force:true});}
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? process.env.SUPABASE_ACCESS_TOKKEN;
  if (!token) throw new Error("Defina SUPABASE_ACCESS_TOKEN.");
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef()}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Management API respondeu HTTP ${response.status}`);
  return (await response.json()) as T[];
}
