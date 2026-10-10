// Ponte MCP usada exclusivamente pelo Codex. Ela roda como processo local do
// servidor: o modelo nunca recebe as credenciais do banco ou da Evolution.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadLocalEnv } from "./loadEnv.ts";
import { getDb, addTaskEvent, setTaskStatus, recordMessage } from "./store.ts";
import { searchKnowledge } from "./knowledge.ts";
import { loadContacts, matchContacts, resolveContact, registerMember } from "./contacts.ts";
import { getPostStatus, recentArts, instagramPerformance, listInstagramAccounts, publishInstagramPost, resolveArtPath, uploadImage } from "./integrations/zernio.ts";
import { recordActionEvidence } from "./actionEvidence.ts";
import { operationalSummary } from "./operationalSummary.ts";
import { workTools } from "./workTasks.ts";
import { createImage, FORMATS } from "./imagegen.ts";
import { sendOwnerImage, sendOwnerText, sendTextChecked } from "./evolutionSend.ts";
import { recordConvMessage } from "./conversations.ts";
import { registerGroup, requestCreateGroup } from "./groups.ts";
import { readGroupPolls, resolveGroup, resolveMentions, scheduleAction, sendGroupPoll, sendGroupText, validatePoll, validateRunAt, validateText } from "./groupTools.ts";
import { approverNumbers, createApproval, openApprovals, waitApproval } from "./approvals.ts";
import { accessContext } from "./accessContext.ts";
import { decideAccess, ownerRequester, type Requester } from "./access.ts";
import { isReadTool } from "./approvalPolicy.ts";
import { isLocalSafeTool } from "./maiaImageTool.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv(resolve(ROOT, ".env"));

const taskId = Number(process.env.MAIA_CODEX_TASK_ID ?? "0");
const channel = process.env.MAIA_CODEX_CHANNEL === "painel" ? "painel" : "whatsapp";
const inGroup = process.env.MAIA_CODEX_GROUP === "1";

function requester(): Requester {
  try {
    const raw = JSON.parse(process.env.MAIA_CODEX_REQUESTER ?? "") as { role?: string; name?: string; number?: string; permissions?: string[] };
    if ((raw.role === "owner" || raw.role === "member" || raw.role === "guest") && Array.isArray(raw.permissions)) {
      return { role: raw.role, name: raw.name ?? "", number: raw.number ?? "", permissions: new Set(raw.permissions) };
    }
  } catch {}
  return ownerRequester();
}

function result(text: string, isError = false) {
  return isError ? { content: [{ type: "text" as const, text }], isError: true } : { content: [{ type: "text" as const, text }] };
}

async function allowed(tool: string, input: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  const db = getDb();
  if (channel === "painel" && !(isReadTool(tool) || isLocalSafeTool(tool))) {
    await addTaskEvent(db, taskId, "access_denied", tool, "escrita pelo painel não permitida");
    return { ok: false, message: "Ações de escrita são feitas pelo WhatsApp, com aprovação." };
  }
  const verdict = decideAccess(tool, requester(), await accessContext(db, taskId, tool, input), isReadTool(tool) || isLocalSafeTool(tool));
  if (verdict.decision === "allow") return { ok: true };
  if ((await openApprovals(db)).some((r) => r.kind === "ferramenta")) {
    await addTaskEvent(db, taskId, "access_denied", tool, "outra aprovação já pendente");
    return { ok: false, message: "Já existe outra ação aguardando aprovação do dono." };
  }
  const approval = await createApproval(db, { kind: "ferramenta", toolName: tool, summary: JSON.stringify(input).slice(0, 300), taskId });
  await setTaskStatus(db, taskId, "aguardando_aprovacao");
  await addTaskEvent(db, taskId, "approval_requested", tool, null);
  const who = requester();
  const notice = `Pedido de ação (#${approval.id})${inGroup ? ` feito por ${who.name || "alguém"} no grupo` : ""} (${verdict.reason}):\n${tool}\n${JSON.stringify(input).slice(0, 300)}\n\nResponda OK para aprovar ou NÃO para recusar.`;
  await recordMessage(db, { channel: "whatsapp", author: "maia", text: notice });
  for (const to of await approverNumbers(db)) void sendOwnerText(to, notice);
  const outcome = await waitApproval(db, approval.id, approval.expiresAt);
  await setTaskStatus(db, taskId, "em_andamento");
  await addTaskEvent(db, taskId, outcome === "approved" ? "approval_approved" : outcome === "denied" ? "approval_denied" : "approval_expired", tool, null);
  return outcome === "approved" ? { ok: true } : { ok: false, message: "Ação recusada ou sem aprovação do dono." };
}

async function guarded(tool: string, input: Record<string, unknown>, run: () => Promise<string>) {
  const verdict = await allowed(tool, input);
  if (!verdict.ok) return result(verdict.message, true);
  try { return result(await run()); } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await addTaskEvent(getDb(), taskId, "tool_failed", tool, reason.slice(0, 300)).catch(() => {});
    return result(`Não consegui concluir: ${reason}`, true);
  }
}

const server = new McpServer({ name: "maia", version: "1.0.0" });

for (const t of workTools) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape }, async (args: Record<string, unknown>) =>
    guarded(`mcp__maia__${t.name}`, args, async () => JSON.stringify(await t.run(getDb(), args, taskId))));
}
server.registerTool("operacao_resumo", { description: "Consulta tarefas de trabalho com prazos/lembretes, pedidos, aprovações e conexões. Dados privados do owner.", inputSchema: {} }, async () => guarded("mcp__maia__operacao_resumo", {}, async () => JSON.stringify(await operationalSummary(getDb()))));

server.registerTool("buscar_conhecimento", { description: "Busca regras, decisões e registros na base interna da Maia.", inputSchema: { pergunta: z.string().min(3).max(500) } }, async ({ pergunta }) => guarded("mcp__maia__buscar_conhecimento", { pergunta }, async () => {
  const hits = await searchKnowledge(getDb(), pergunta, 4);
  return hits.length ? hits.map((hit, i) => `[${i + 1}] ${hit.titulo} · ${hit.secao}\n${hit.conteudo.slice(0, 700)}`).join("\n\n") : "Nenhum trecho encontrado.";
}));

server.registerTool("avisar_dono", { description: "Avisa o owner sobre um pedido que precisa da decisão dele.", inputSchema: { pedido: z.string().min(3).max(500), quem_pediu: z.string().max(100).optional() } }, async ({ pedido, quem_pediu }) => guarded("mcp__maia__avisar_dono", { pedido, quem_pediu }, async () => {
  await sendOwnerText(process.env.EVOLUTION_OWNER_NUMBER ?? "", `Pedido que precisa de decisão${quem_pediu ? ` (${quem_pediu})` : ""}: ${pedido}`);
  return "Aviso enviado ao Herickson.";
}));

server.registerTool("contato_buscar", { description: "Busca contato por nome, apelido ou número. Somente leitura.", inputSchema: { busca: z.string().min(1).max(80) } }, async ({ busca }) => guarded("mcp__maia__contato_buscar", { busca }, async () => {
  const hits = matchContacts(await loadContacts(getDb()), busca);
  return hits.length ? hits.slice(0, 8).map((c) => `${c.name || "(sem nome)"} +${c.number}`).join("\n") : `Nenhum contato para "${busca}".`;
}));

server.registerTool("grupo_ler_enquetes", { description: "Lê enquetes recentes de um grupo WhatsApp. Somente leitura.", inputSchema: { grupo: z.string().min(2).max(100), limite: z.number().int().min(1).max(10).optional() } }, async ({ grupo, limite }) => guarded("mcp__maia__grupo_ler_enquetes", { grupo, limite }, async () => {
  const found = await resolveGroup(grupo); if (!found.ok) return found.error;
  const polls = await readGroupPolls(found.group.jid, limite ?? 3);
  return polls.length ? polls.map((p) => `${p.question}: ${p.options.map((o) => `${o.name} = ${o.votes ?? "—"}`).join("; ")}`).join("\n") : `Nenhuma enquete no grupo "${found.group.subject}".`;
}));

server.registerTool("instagram_desempenho", { description: "Mostra desempenho dos posts recentes do Instagram. Somente leitura.", inputSchema: { limite: z.number().int().min(1).max(20).optional() } }, async ({ limite }) => guarded("mcp__maia__instagram_desempenho", { limite }, async () => {
  const { posts, totalPosts } = await instagramPerformance(limite ?? 5);
  return posts.length ? `Total: ${totalPosts ?? "—"}\n${posts.map((p) => `${p.publishedAt?.slice(0, 10) ?? "sem data"}: ${p.caption} | alcance ${p.alcance ?? "—"}, curtidas ${p.curtidas ?? "—"}`).join("\n")}` : "Nenhum post encontrado.";
}));

server.registerTool("artes_recentes", { description: "Lista artes recentes para escolher uma publicação. Somente leitura.", inputSchema: {} }, async () => guarded("mcp__maia__artes_recentes", {}, async () => {
  const arts = recentArts(5); return arts.length ? arts.map((a) => a.path).join("\n") : "Nenhuma arte gerada.";
}));

server.registerTool("gerar_imagem", { description: "Cria uma arte para feed, story ou quadrado.", inputSchema: { briefing: z.string().min(1).max(2000), formato: z.enum(["feed", "story", "quadrado"]), referencias: z.array(z.string()).max(4).optional() } }, async ({ briefing, formato, referencias }) => guarded("mcp__maia__gerar_imagem", { briefing, formato, referencias }, async () => {
  const image = await createImage({ briefing, format: formato, refs: referencias ?? [] });
  if (!image.ok) throw new Error(image.error);
  if (channel === "painel") return `Arte criada em: ${image.path}`;
  const id = await sendOwnerImage(process.env.EVOLUTION_OWNER_NUMBER ?? "", image.path, `Arte ${FORMATS[formato]}`);
  await recordActionEvidence(getDb(), taskId, "enviar_arte", null, id ? `mensagem ${id}` : null);
  return id ? "Arte criada e envio aceito pelo WhatsApp, com ID da mensagem." : "Arte criada; a Evolution aceitou o envio, mas não devolveu um ID para conferência.";
}));

server.registerTool("grupo_enviar_texto", { description: "Envia texto a um grupo. Pode pedir aprovação conforme a política.", inputSchema: { grupo: z.string().min(2).max(100), texto: z.string().min(1).max(3000), mencionar: z.array(z.string()).max(20).optional() } }, async ({ grupo, texto, mencionar }) => guarded("mcp__maia__grupo_enviar_texto", { grupo, texto, mencionar }, async () => {
  const invalid = validateText(texto); if (invalid) throw new Error(invalid);
  const found = await resolveGroup(grupo); if (!found.ok) throw new Error(found.error);
  const mentions = await resolveMentions(getDb(), mencionar ?? []); if (!mentions.ok) throw new Error(mentions.error);
  const id = await sendGroupText(found.group.jid, texto, mentions.numbers);
  await recordActionEvidence(getDb(), taskId, "grupo_enviar_texto", found.group.subject, `mensagem ${id}`);
  await recordConvMessage(getDb(), { conv: found.group.jid, name: "Maia", text: texto, fromMaia: true }).catch(() => {});
  return `Texto enviado no grupo "${found.group.subject}" (mensagem ${id}).`;
}));

server.registerTool("grupo_enviar_enquete", { description: "Cria uma enquete em grupo. Pode pedir aprovação conforme a política.", inputSchema: { grupo: z.string().min(2).max(100), pergunta: z.string().min(1).max(250), opcoes: z.array(z.string().min(1).max(100)).min(2).max(12), respostas_permitidas: z.number().int().min(1).max(12).optional() } }, async ({ grupo, pergunta, opcoes, respostas_permitidas }) => guarded("mcp__maia__grupo_enviar_enquete", { grupo, pergunta, opcoes, respostas_permitidas }, async () => {
  const invalid = validatePoll(pergunta, opcoes, respostas_permitidas ?? 1); if (invalid) throw new Error(invalid);
  const found = await resolveGroup(grupo); if (!found.ok) throw new Error(found.error);
  const id = await sendGroupPoll(found.group.jid, pergunta, opcoes, respostas_permitidas ?? 1);
  await recordActionEvidence(getDb(), taskId, "grupo_enviar_enquete", found.group.subject, `mensagem ${id}`);
  return `Enquete enviada no grupo "${found.group.subject}" (mensagem ${id}).`;
}));

server.registerTool("contato_enviar_mensagem", { description: "Envia mensagem privada a um contato cadastrado. Pode pedir aprovação conforme a política.", inputSchema: { contato: z.string().min(1).max(80), texto: z.string().min(1).max(2000) } }, async ({ contato, texto }) => guarded("mcp__maia__contato_enviar_mensagem", { contato, texto }, async () => {
  const invalid = validateText(texto); if (invalid) throw new Error(invalid);
  const found = await resolveContact(getDb(), contato); if (!found.ok) throw new Error(found.error);
  const id = await sendTextChecked(found.contact.number, texto);
  await addTaskEvent(getDb(), taskId, "dm_sent", "contato_enviar_mensagem", found.contact.name).catch((error) => console.error("[contatos] falha ao registrar envio aceito:", error instanceof Error ? error.message : error));
  await recordActionEvidence(getDb(), taskId, "contato_enviar_mensagem", found.contact.name, `mensagem ${id}`);
  await recordConvMessage(getDb(), { conv: found.contact.number, text: texto, fromMaia: true, name: "Maia" }).catch(() => {});
  return `Mensagem enviada para ${found.contact.name || `+${found.contact.number}`} (${id}).`;
}));

server.registerTool("grupo_cadastrar", { description: "Cadastra um grupo existente para atendimento.", inputSchema: { grupo: z.string().min(2).max(100) } }, async ({ grupo }) => guarded("mcp__maia__grupo_cadastrar", { grupo }, async () => {
  const found = await resolveGroup(grupo); if (!found.ok) throw new Error(found.error);
  await registerGroup(getDb(), found.group.jid, found.group.subject, "cadastrado"); return `Grupo "${found.group.subject}" cadastrado.`;
}));

// Criar grupo não passa pelo guard genérico: ele usa o mesmo fluxo persistido
// do roteador do owner, que cria uma aprovação do tipo "grupo" e só chama a
// Evolution depois do OK. Assim o processo não fica aguardando 10 min no SDK.
server.registerTool("grupo_criar", { description: "Cria um grupo novo no WhatsApp. Só o owner pode pedir; a criação sempre aguarda aprovação antes de sair para a Evolution.", inputSchema: { grupo: z.string().min(2).max(100), participantes: z.array(z.string().min(10).max(20)).min(1).max(100) } }, async ({ grupo, participantes }) => {
  if (channel !== "whatsapp") return result("A criação de grupo é feita pelo WhatsApp, com aprovação.", true);
  if (requester().role !== "owner") return result("Só o owner pode solicitar a criação de grupo.", true);
  const numbers = [...new Set(participantes.map((item) => item.replace(/\D/g, "")).filter((number) => number.length >= 12 && number.length <= 13))];
  if (numbers.length !== participantes.length) return result("Informe todos os participantes com DDI e DDD (12 ou 13 dígitos).", true);
  const db = getDb();
  try {
    const reply = await requestCreateGroup({
      db,
      notifyOwner: async (text) => {
        await sendOwnerText(process.env.EVOLUTION_OWNER_NUMBER ?? "", text);
        await recordMessage(db, { channel: "whatsapp", author: "maia", text });
      },
    }, grupo.trim(), numbers);
    return result(reply);
  } catch (error) {
    return result(`Não consegui solicitar a criação do grupo: ${error instanceof Error ? error.message : String(error)}`, true);
  }
});

server.registerTool("membro_cadastrar", { description: "Cadastra um membro e suas permissões.", inputSchema: { nome: z.string().min(2).max(60), numero: z.string().min(10).max(20), permissoes: z.array(z.string().max(40)).max(12).optional() } }, async ({ nome, numero, permissoes }) => guarded("mcp__maia__membro_cadastrar", { nome, numero, permissoes }, async () => {
  const registered = await registerMember(getDb(), { name: nome, number: numero, permissions: permissoes }); if (!registered.ok) throw new Error(registered.error);
  return `${nome} cadastrado(a) como membro.`;
}));

server.registerTool("grupo_agendar", { description: "Agenda texto ou enquete para grupo no futuro.", inputSchema: { grupo: z.string().min(2).max(100), quando: z.string().min(10).max(40), texto: z.string().max(3000).optional(), mencionar: z.array(z.string()).max(20).optional(), pergunta: z.string().max(250).optional(), opcoes: z.array(z.string()).max(12).optional(), respostas_permitidas: z.number().int().min(1).max(12).optional() } }, async (args) => guarded("mcp__maia__grupo_agendar", args, async () => {
  const when = validateRunAt(args.quando); if (!when.ok) throw new Error(when.error);
  const found = await resolveGroup(args.grupo); if (!found.ok) throw new Error(found.error);
  const isPoll = Boolean(args.pergunta);
  const invalid = isPoll ? validatePoll(args.pergunta ?? "", args.opcoes ?? [], args.respostas_permitidas ?? 1) : validateText(args.texto ?? ""); if (invalid) throw new Error(invalid);
  const mentions = await resolveMentions(getDb(), args.mencionar ?? []); if (!mentions.ok) throw new Error(mentions.error);
  const id = await scheduleAction(getDb(), { kind: isPoll ? "enquete" : "texto", group: found.group, payload: isPoll ? { question: args.pergunta, options: args.opcoes, selectable: args.respostas_permitidas ?? 1 } : { text: args.texto, mentions: mentions.numbers }, runAt: when.at, taskId: taskId || null });
  return `Agendado (#${id}) para ${when.at.toISOString()}.`;
}));

server.registerTool("instagram_publicar", { description: "Publica ou agenda uma arte no Instagram. Sempre pede aprovação.", inputSchema: { legenda: z.string().min(1).max(2200), arte: z.string().min(3).max(200), agendar_para: z.string().max(40).optional() } }, async ({ legenda, arte, agendar_para }) => guarded("mcp__maia__instagram_publicar", { legenda, arte, agendar_para }, async () => {
  const art = resolveArtPath(arte); if (!art.ok) throw new Error(art.error);
  const accounts = (await listInstagramAccounts()).filter((a) => a.active); if (accounts.length !== 1) throw new Error("É necessário haver exatamente uma conta Instagram ativa.");
  const post = await publishInstagramPost({ accountId: accounts[0].id, caption: legenda, imageUrl: await uploadImage(art.path), scheduledFor: agendar_para ?? null });
  const check = post.postId ? await getPostStatus(post.postId).catch(() => null) : null;
  const verified = check && (post.scheduled ? ["scheduled", "published"].includes(check.status) : check.status === "published");
  await recordActionEvidence(getDb(), taskId, "instagram_publicar", post.postId, verified ? post.postId : null);
  return `${post.scheduled ? "Agendamento aceito" : "Post criado"} no Instagram (@${accounts[0].username}). Status: ${check?.status ?? post.status}.${verified ? " Conferido na Zernio." : " Não consegui conferir o estado final; confirme no Instagram antes de tentar novamente."}`;
}));

await server.connect(new StdioServerTransport());
