import type { AccessContext } from "./access.ts";
import { resolveGroup, resolveMentions, withMentionTags } from "./groupTools.ts";
import { resolveContact } from "./contacts.ts";
import { outboundContentHash } from "./outboundReceipts.ts";
import type { Db } from "./store.ts";

// Dados que a decisão de acesso precisa e que dependem do banco: o grupo é cadastrado? quantos contatos já recebem
// mensagem neste pedido?
export async function accessContext(db: Db, taskId: number, toolName: string, input: Record<string, unknown>): Promise<AccessContext> {
  const ctx: AccessContext = { toolInput:input };
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
    const name = typeof input.contato === "string" ? input.contato : "";
    const text = typeof input.texto === "string" ? input.texto : "";
    const contact = name ? await resolveContact(db, name) : null;
    if (contact?.ok && text) {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const duplicate = await db.from("outbound_receipts").select("message_id").eq("recipient", contact.contact.number).eq("content_hash", outboundContentHash(text)).gte("created_at", since).limit(1);
      if (duplicate.error) throw new Error(`Não foi possível conferir envios anteriores: ${duplicate.error.message}`);
      let foundDuplicate = Boolean(duplicate.data?.length);
      if (!foundDuplicate) {
        const [history, outreach] = await Promise.all([
          db.from("group_messages").select("id").eq("conv", `dm:${contact.contact.number}`).eq("from_maia", true).eq("text", text).gte("at", since).limit(1),
          db.from("outreach").select("id").eq("number", contact.contact.number).eq("text", text).gte("at", since).limit(1),
        ]);
        if (history.error || outreach.error) throw new Error("Não foi possível conferir o histórico do contato antes do envio");
        foundDuplicate = Boolean(history.data?.length || outreach.data?.length);
      }
      ctx.duplicateSend = foundDuplicate;
    }
  }
  if (toolName === "mcp__maia__grupo_enviar_texto") {
    const name = typeof input.grupo === "string" ? input.grupo : "";
    const text = typeof input.texto === "string" ? input.texto : "";
    const group = name ? await resolveGroup(name) : null;
    if (group?.ok && text) {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString();
      const names = Array.isArray(input.mencionar) ? input.mencionar.filter((v): v is string => typeof v === "string") : [];
      const mentions = await resolveMentions(db, names);
      if (!mentions.ok) throw new Error(`Não foi possível conferir o texto com menções: ${mentions.error}`);
      const sentText = withMentionTags(text, mentions.numbers);
      const duplicate = await db.from("outbound_receipts").select("message_id").eq("recipient", group.group.jid).eq("content_hash", outboundContentHash(sentText)).gte("created_at", since).limit(1);
      if (duplicate.error) throw new Error(`Não foi possível conferir envios anteriores: ${duplicate.error.message}`);
      if (duplicate.data?.length) ctx.duplicateSend = true;
      else {
        const legacy = await db.from("group_messages").select("id").eq("conv", group.group.jid).eq("from_maia", true).eq("text", text).gte("at", since).limit(1);
        if (legacy.error) throw new Error(`Não foi possível conferir o histórico do grupo: ${legacy.error.message}`);
        ctx.duplicateSend = Boolean(legacy.data?.length);
      }
    }
  }
  return ctx;
}
