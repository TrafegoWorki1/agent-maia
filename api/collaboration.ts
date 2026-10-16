import type { IncomingMessage, ServerResponse } from "node:http";
import { collaborationView, executeCollaborationCommand, serializeIdentity } from "../server/collaborativeWork.ts";
import { authenticatePanelRequest } from "../server/panelIdentity.ts";
import { supabaseFromEnv } from "../server/supabaseClient.ts";
import { json } from "../server/workspaceApi.ts";

async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("json_required");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 64_000) throw new Error("too_large");
  }
  return JSON.parse(raw);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    res.setHeader("Cache-Control","no-store, private");
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res,403,{ error:"same_origin_required" });
    const db = supabaseFromEnv();
    // Carregada de novo em cada request: revogação e mudança de escopo não dependem do cache do navegador.
    const identity = await authenticatePanelRequest(req,db);
    if (req.method === "GET") {
      if(new URL(req.url??"/api/collaboration","http://localhost").searchParams.get("identity")==="1"){if(!identity.owner&&!serializeIdentity(identity).screens.length)throw new Error("Acesso ao painel revogado");return json(res,200,serializeIdentity(identity));}
      const view=await collaborationView(db,identity);
      const fresh=await authenticatePanelRequest(req,db);
      const fingerprint=(value:typeof identity)=>serializeIdentity(value).accessVersion;
      if(fingerprint(identity)!==fingerprint(fresh))throw new Error("Acesso ou escopo alterado; carregue novamente");
      return json(res,200,view);
    }
    if (req.method !== "POST") return json(res,405,{ error:"method_not_allowed" });
    const result = await executeCollaborationCommand(db,identity,await body(req));
    return json(res,200,{ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no pedido";
    const status = message === "login_required" ? 401 : /negad|denied|fora do escopo|exclusiva|revogado|escopo alterado|sem vínculo/i.test(message) ? 403 : message === "json_required" ? 415 : message === "too_large" ? 413 : 400;
    console.error("[collaboration]",message);
    return json(res,status,{ error:message.slice(0,500) });
  }
}
