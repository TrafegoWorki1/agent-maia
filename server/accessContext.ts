import type { AccessContext } from "./access.ts";
import { resolveGroup } from "./groupTools.ts";
import type { Db } from "./store.ts";

// Dados que a decisão de acesso precisa e que dependem do banco: o grupo é cadastrado? quantos contatos já recebem
// mensagem neste pedido?
export async function accessContext(db: Db, taskId: number, toolName: string, input: Record<string, unknown>): Promise<AccessContext> {
  const ctx: AccessContext = {};
  if (/^mcp__maia__grupo_(enviar_texto|enviar_enquete|agendar|gerenciar_participantes|enviar_convite|alterar_foto|info|participantes|ler_enquetes)$/.test(toolName)) {
    const name = typeof input.grupo === "string" ? input.grupo : "";
    const group = name ? await resolveGroup(name) : null;
    if (group?.ok) {
      ctx.targetGroupJid = group.group.jid;
      const { data } = await db.from("maia_groups").select("jid").eq("jid", group.group.jid).eq("active", true).maybeSingle();
      ctx.groupRegistered = Boolean(data);
    } else {
      ctx.groupRegistered = false;
    }
  }
  // Busca na web nesta tarefa: o registro de uso fica em task_events (tool_use / WebSearch), o mesmo nos dois executores.
  const { count: webUses } = await db.from("task_events").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("type", "tool_use").eq("operation", "WebSearch");
  ctx.webTainted = (webUses ?? 0) > 0;
  if (toolName === "mcp__maia__contato_enviar_mensagem") {
    const { count } = await db.from("task_events").select("id", { count: "exact", head: true }).eq("task_id", taskId).eq("type", "dm_sent");
    ctx.dmInTask = count ?? 0;
  }
  return ctx;
}
