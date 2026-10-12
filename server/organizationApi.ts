import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { Db } from "./store.ts";
import { json } from "./workspaceApi.ts";
import { organizationView, saveAccessGroup, saveClient, saveWhatsAppGroup } from "./organization.ts";
export async function handleOrganization(req: IncomingMessage, res: ServerResponse, db: Db) {
  try {
    if (req.method === "GET") return json(res, 200, await organizationView(db));
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "same_origin_required" });
    if (!req.headers["content-type"]?.startsWith("application/json")) return json(res, 415, { error: "json_required" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 32_000) return json(res, 413, { error: "too_large" }); }
    const command = z.object({ action: z.enum(["client_save", "access_group_save", "group_save"]), input: z.unknown() }).parse(JSON.parse(raw));
    const result = command.action === "client_save" ? await saveClient(db, command.input) : command.action === "access_group_save" ? await saveAccessGroup(db, command.input) : await saveWhatsAppGroup(db, command.input);
    return json(res, 200, { result });
  } catch (error) {
    return json(res, 400, { error: error instanceof Error ? error.message.slice(0, 500) : "Não foi possível atualizar o cadastro." });
  }
}
