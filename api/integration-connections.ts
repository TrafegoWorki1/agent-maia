import type { IncomingMessage, ServerResponse } from "node:http";
import { authenticatePanelRequest } from "../server/panelIdentity.ts";
import { supabaseFromEnv } from "../server/supabaseClient.ts";
import { getZernioMetaAdsStatus } from "../server/integrations/metaAdsMcpAdapter.ts";
import { json } from "../server/workspaceApi.ts";

export const config = { maxDuration: 60 };

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const db = supabaseFromEnv();
    const identity = await authenticatePanelRequest(req, db);
    if (!identity.owner) return json(res, 403, { error: "owner_only" });
    if (req.method === "GET") return json(res, 200, { connections: { meta_ads: await getZernioMetaAdsStatus() } });
    if (req.method === "POST") {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: "same_origin_required" });
      const status = await getZernioMetaAdsStatus();
      return json(res, 200, { ok: status.connected, accountCount: status.accountCount, detail: status.detail });
    }
    return json(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao consultar Zernio";
    const status = message === "login_required" ? 401 : /owner_only/i.test(message) ? 403 : 500;
    return json(res, status, { error: message });
  }
}
