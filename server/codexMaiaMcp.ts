// Ponte MCP usada exclusivamente pelo Codex. Ela roda como processo local do
// servidor: o modelo nunca recebe as credenciais do banco ou da Evolution.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "./loadEnv.ts";
import { describeAction } from "./actionDescriptions.ts";
import { getDb, addTaskEvent, setTaskStatus, recordMessage } from "./store.ts";
import { searchKnowledge } from "./knowledge.ts";
import { loadContacts, matchContacts, resolveContact, registerMember } from "./contacts.ts";
import { getPostStatus, recentArts, instagramPerformance, listInstagramAccounts, publishInstagramPost, resolveArtPath, resolveVideoPath, cancelScheduledPost, updateScheduledPost, uploadImage, listLinkedInAccounts, listLinkedInOrganizations, linkedinPerformance, publishLinkedInPost, listInstagramStories, getStoryInsights, searchInstagramAudio, getInstagramAudioDetail, getFollowStatus, listInboxConversations, getConversationMessages, dmWindowOpen, sendInboxMessage, listCommentAutomations, getCommentAutomation, createCommentAutomation, setCommentAutomationActive, deleteCommentAutomation, getCommentAutomationLogs, type InstagramPostKind } from "./integrations/zernio.ts";
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
  const action = describeAction(tool, input);
  const approval = await createApproval(db, { kind: "ferramenta", toolName: tool, summary: action.slice(0, 500), taskId });
  await setTaskStatus(db, taskId, "aguardando_aprovacao");
  await addTaskEvent(db, taskId, "approval_requested", tool, null);
  const who = requester();
  // Decisão do owner (10/10/2026): nunca mostrar nome de ferramenta nem JSON no pedido de OK.
  const notice = `Pedido de aprovação (#${approval.id})${inGroup ? ` feito por ${who.name || "alguém"} no grupo` : ""}: ${action} (${verdict.reason}).\n\nResponda OK para aprovar ou NÃO para recusar.`;
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
  server.registerTool(t.name, { description: t.description, inputSchema: t.schema.shape, annotations: { readOnlyHint:t.name === "tarefas_listar", destructiveHint:false, openWorldHint:false } }, async (args: Record<string, unknown>) =>
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

async function singleInstagramAccount() {
  const accounts = (await listInstagramAccounts()).filter((account) => account.active);
  if (accounts.length !== 1) throw new Error(accounts.length ? "Há mais de uma conta Instagram ativa; escolha explícita ainda não é suportada." : "Nenhuma conta Instagram ativa.");
  return accounts[0];
}

server.registerTool("instagram_stories", { description: "Lista Stories ativos da conta Instagram conectada. Somente leitura.", inputSchema: {} }, async () => guarded("mcp__maia__instagram_stories", {}, async () => {
  const account = await singleInstagramAccount();
  const stories = await listInstagramStories(account.id);
  return stories.length ? stories.map((story) => `${story.id} (${story.mediaType ?? "story"})${story.permalink ? ` | ${story.permalink}` : ""}`).join("\n") : "Nenhum Story ativo.";
}));
server.registerTool("instagram_stories_metricas", { description: "Consulta métricas de um Story ativo. Somente leitura.", inputSchema: { story_id: z.string().min(1).max(80) } }, async ({ story_id }) => guarded("mcp__maia__instagram_stories_metricas", { story_id }, async () => JSON.stringify(await getStoryInsights((await singleInstagramAccount()).id, story_id))));
server.registerTool("instagram_musica_buscar", { description: "Pesquisa músicas ou sons no catálogo Instagram. Pode exigir reconexão da conta por Facebook Login.", inputSchema: { tipo: z.enum(["music", "original_sound"]), busca: z.string().max(100).optional() } }, async ({ tipo, busca }) => guarded("mcp__maia__instagram_musica_buscar", { tipo, busca }, async () => {
  const tracks = await searchInstagramAudio((await singleInstagramAccount()).id, tipo, busca);
  return tracks.length ? tracks.map((track) => `${track.id}: ${track.title ?? "sem título"} — ${track.artist ?? "artista desconhecido"}`).join("\n") : "Nenhum áudio encontrado.";
}));
server.registerTool("instagram_musica_detalhar", { description: "Consulta detalhes e disponibilidade de uma faixa. Somente leitura.", inputSchema: { audio_id: z.string().min(1).max(100) } }, async ({ audio_id }) => guarded("mcp__maia__instagram_musica_detalhar", { audio_id }, async () => JSON.stringify(await getInstagramAudioDetail((await singleInstagramAccount()).id, audio_id))));
server.registerTool("instagram_seguidor_status", { description: "Consulta se um perfil segue ou é seguido pela conta Instagram conectada. Somente leitura; não autoriza DM.", inputSchema: { usuario_id: z.string().min(1).max(100) } }, async ({ usuario_id }) => guarded("mcp__maia__instagram_seguidor_status", { usuario_id }, async () => JSON.stringify(await getFollowStatus((await singleInstagramAccount()).id, usuario_id))));
server.registerTool("instagram_conversas_listar", { description: "Lista conversas do Direct Instagram. Somente leitura.", inputSchema: {} }, async () => guarded("mcp__maia__instagram_conversas_listar", {}, async () => {
  const conversations = await listInboxConversations((await singleInstagramAccount()).id);
  return conversations.length ? conversations.map((conversation) => `${conversation.id}: ${conversation.participantName ?? "sem nome"}`).join("\n") : "Nenhuma conversa no Direct.";
}));
server.registerTool("instagram_conversa_mensagens", { description: "Lê mensagens recentes de uma conversa do Direct. Somente leitura.", inputSchema: { conversa_id: z.string().min(1).max(80) } }, async ({ conversa_id }) => guarded("mcp__maia__instagram_conversa_mensagens", { conversa_id }, async () => {
  const messages = await getConversationMessages(conversa_id, (await singleInstagramAccount()).id, { limit: 20, sortOrder: "desc" });
  return messages.map((message) => `[${message.direction === "incoming" ? "recebida" : "enviada"} ${message.createdAt}] ${message.senderName ?? ""}: ${message.message}`).join("\n") || "Nenhuma mensagem encontrada.";
}));
server.registerTool("instagram_direct_responder", { description: "Responde uma conversa elegível do Direct. Requer aprovação e janela de 24h desde a mensagem recebida.", inputSchema: { conversa_id: z.string().min(1).max(80), texto: z.string().min(1).max(1000) } }, async ({ conversa_id, texto }) => guarded("mcp__maia__instagram_direct_responder", { conversa_id, texto }, async () => {
  const account = await singleInstagramAccount();
  const messages = await getConversationMessages(conversa_id, account.id, { limit: 20, sortOrder: "desc" });
  if (!dmWindowOpen(messages)) throw new Error("A janela de resposta de 24h está fechada; não enviei a mensagem.");
  const sent = await sendInboxMessage(conversa_id, account.id, texto, randomUUID());
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_direct_responder", sent.messageId).catch(() => {});
  return `Mensagem enviada no Direct (${sent.messageId ?? "sem id devolvido"}).`;
}));
server.registerTool("instagram_automacoes_listar", { description: "Lista automações de comentário→DM. Somente leitura.", inputSchema: {} }, async () => guarded("mcp__maia__instagram_automacoes_listar", {}, async () => {
  const automations = await listCommentAutomations();
  return automations.length ? automations.map((automation) => `${automation.id}: ${automation.name} — ${automation.isActive ? "ativa" : "pausada"}`).join("\n") : "Nenhuma automação cadastrada.";
}));
server.registerTool("instagram_automacao_detalhar", { description: "Consulta detalhes de uma automação. Somente leitura.", inputSchema: { automacao_id: z.string().min(1).max(80) } }, async ({ automacao_id }) => guarded("mcp__maia__instagram_automacao_detalhar", { automacao_id }, async () => JSON.stringify(await getCommentAutomation(automacao_id))));
server.registerTool("instagram_automacao_criar", { description: "Cria automação de comentário→DM pausada. Requer aprovação.", inputSchema: { nome: z.string().min(1).max(100), mensagem_direct: z.string().min(1).max(1000), resposta_publica: z.string().max(500).optional(), palavras_chave: z.array(z.string().min(1).max(60)).max(20).optional(), post_id: z.string().max(80).optional(), gatilho: z.enum(["comment", "story_reply", "story_mention"]).optional() } }, async (args) => guarded("mcp__maia__instagram_automacao_criar", args, async () => {
  const account = await singleInstagramAccount();
  const automation = await createCommentAutomation({ profileId: account.profileId, accountId: account.id, name: args.nome, dmMessage: args.mensagem_direct, commentReply: args.resposta_publica, keywords: args.palavras_chave, platformPostId: args.post_id, trigger: args.gatilho });
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_automacao_criar", automation.id).catch(() => {});
  return `Automação “${automation.name}” criada pausada (id ${automation.id}).`;
}));
server.registerTool("instagram_automacao_ativar", { description: "Ativa ou pausa automação de comentário→DM. Requer aprovação.", inputSchema: { automacao_id: z.string().min(1).max(80), ativar: z.boolean() } }, async ({ automacao_id, ativar }) => guarded("mcp__maia__instagram_automacao_ativar", { automacao_id, ativar }, async () => {
  const automation = await setCommentAutomationActive(automacao_id, ativar);
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_automacao_ativar", automation.id).catch(() => {});
  return `Automação “${automation.name}” ${automation.isActive ? "ativa" : "pausada"}.`;
}));
server.registerTool("instagram_automacao_excluir", { description: "Exclui automação de comentário→DM. Requer aprovação.", inputSchema: { automacao_id: z.string().min(1).max(80) } }, async ({ automacao_id }) => guarded("mcp__maia__instagram_automacao_excluir", { automacao_id }, async () => {
  await deleteCommentAutomation(automacao_id);
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_automacao_excluir", automacao_id).catch(() => {});
  return "Automação excluída.";
}));
server.registerTool("instagram_automacao_logs", { description: "Consulta os logs de disparo de uma automação. Somente leitura.", inputSchema: { automacao_id: z.string().min(1).max(80) } }, async ({ automacao_id }) => guarded("mcp__maia__instagram_automacao_logs", { automacao_id }, async () => JSON.stringify((await getCommentAutomationLogs(automacao_id)).slice(0, 20))));

server.registerTool("linkedin_contas", { description: "Lista contas LinkedIn conectadas na Zernio. Somente leitura.", inputSchema: {} }, async () => guarded("mcp__maia__linkedin_contas", {}, async () => {
  const accounts = await listLinkedInAccounts();
  return accounts.length ? accounts.map((account) => `${account.name} (${account.id}) — ${account.active ? "ativa" : "inativa"}`).join("\n") : "Nenhuma conta LinkedIn conectada na Zernio.";
}));

server.registerTool("linkedin_organizacoes", { description: "Lista páginas de empresas administradas por uma conta LinkedIn. Somente leitura.", inputSchema: { conta: z.string().min(1).max(100) } }, async ({ conta }) => guarded("mcp__maia__linkedin_organizacoes", { conta }, async () => {
  const organizations = await listLinkedInOrganizations(conta);
  return organizations.length ? organizations.map((organization) => `${organization.name} (${organization.id})${organization.url ? ` — ${organization.url}` : ""}`).join("\n") : "Nenhuma organização LinkedIn encontrada para essa conta.";
}));

server.registerTool("linkedin_desempenho", { description: "Mostra desempenho dos posts recentes do LinkedIn. Somente leitura.", inputSchema: { limite: z.number().int().min(1).max(20).optional() } }, async ({ limite }) => guarded("mcp__maia__linkedin_desempenho", { limite }, async () => {
  const { posts, totalPosts } = await linkedinPerformance(limite ?? 5);
  return posts.length ? `Total: ${totalPosts ?? "—"}\n${posts.map((post) => `${post.publishedAt?.slice(0, 10) ?? "sem data"}: ${post.caption} | alcance ${post.alcance ?? "—"}, curtidas ${post.curtidas ?? "—"}`).join("\n")}` : "Nenhum post LinkedIn encontrado.";
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

server.registerTool("instagram_publicar", { description: "Publica ou agenda foto, carrossel, Reels ou Story. Sempre pede aprovação.", inputSchema: { legenda: z.string().min(1).max(2200), arte: z.string().min(3).max(200).optional(), artes: z.array(z.string().min(3).max(200)).min(1).max(10).optional(), tipo: z.enum(["foto", "carrossel", "reels", "story"]).optional(), agendar_para: z.string().max(40).optional() } }, async ({ legenda, arte, artes, tipo, agendar_para }) => guarded("mcp__maia__instagram_publicar", { legenda, arte, artes, tipo, agendar_para }, async () => {
  if (arte && artes) throw new Error("Informe arte ou artes, não os dois.");
  const paths = artes ?? (arte ? [arte] : []);
  if (!paths.length) throw new Error("Informe uma arte ou uma lista de artes.");
  const kind: InstagramPostKind = tipo ?? (paths.length > 1 ? "carrossel" : "foto");
  const resolved = paths.map((path) => kind === "reels" ? resolveVideoPath(path) : resolveArtPath(path));
  const bad = resolved.find((item) => !item.ok) as { ok: false; error: string } | undefined;
  if (bad) throw new Error(bad.error);
  const mediaUrls = await Promise.all(resolved.map((item) => uploadImage((item as { ok: true; path: string }).path)));
  const accounts = (await listInstagramAccounts()).filter((a) => a.active); if (accounts.length !== 1) throw new Error("É necessário haver exatamente uma conta Instagram ativa.");
  const post = await publishInstagramPost({ accountId: accounts[0].id, caption: legenda, mediaUrls, kind, scheduledFor: agendar_para ?? null });
  const check = post.postId ? await getPostStatus(post.postId).catch(() => null) : null;
  const verified = check && (post.scheduled ? ["scheduled", "published"].includes(check.status) : check.status === "published");
  await recordActionEvidence(getDb(), taskId, "instagram_publicar", post.postId, verified ? post.postId : null);
  return `${post.scheduled ? "Agendamento aceito" : "Post criado"} no Instagram (@${accounts[0].username}). Status: ${check?.status ?? post.status}.${verified ? " Conferido na Zernio." : " Não consegui conferir o estado final; confirme no Instagram antes de tentar novamente."}`;
}));
server.registerTool("instagram_post_cancelar", { description: "Cancela um post Instagram ainda não publicado. Requer aprovação.", inputSchema: { post_id: z.string().min(1).max(60) } }, async ({ post_id }) => guarded("mcp__maia__instagram_post_cancelar", { post_id }, async () => {
  await cancelScheduledPost(post_id);
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_post_cancelar", post_id).catch(() => {});
  return "Post cancelado.";
}));
server.registerTool("instagram_post_editar", { description: "Edita legenda ou horário de post Instagram ainda não publicado. Requer aprovação.", inputSchema: { post_id: z.string().min(1).max(60), legenda: z.string().min(1).max(2200).optional(), agendar_para: z.string().min(10).max(40).optional() } }, async (args) => guarded("mcp__maia__instagram_post_editar", args, async () => {
  if (!args.legenda && !args.agendar_para) throw new Error("Informe a nova legenda ou o novo horário.");
  await updateScheduledPost(args.post_id, { caption: args.legenda, scheduledFor: args.agendar_para });
  await addTaskEvent(getDb(), taskId, "external_done", "instagram_post_editar", args.post_id).catch(() => {});
  return "Post atualizado.";
}));

server.registerTool("linkedin_publicar", { description: "Publica ou agenda um texto ou uma arte no LinkedIn. Sempre pede aprovação.", inputSchema: { conteudo: z.string().min(1).max(2200), arte: z.string().min(3).max(200).optional(), conta: z.string().max(100).optional(), organizacao: z.string().max(100).optional(), agendar_para: z.string().max(40).optional() } }, async ({ conteudo, arte, conta, organizacao, agendar_para }) => guarded("mcp__maia__linkedin_publicar", { conteudo, arte, conta, organizacao, agendar_para }, async () => {
  const accounts = (await listLinkedInAccounts()).filter((account) => account.active);
  const selected = conta ? accounts.find((account) => account.id === conta) : accounts.length === 1 ? accounts[0] : null;
  if (!selected) throw new Error(conta ? "A conta LinkedIn informada não está conectada ou ativa." : "É necessário haver exatamente uma conta LinkedIn ativa, ou informar conta.");
  let imageUrl: string | null = null;
  if (arte) { const art = resolveArtPath(arte); if (!art.ok) throw new Error(art.error); imageUrl = await uploadImage(art.path); }
  const post = await publishLinkedInPost({ accountId: selected.id, content: conteudo, imageUrl, organizationId: organizacao ?? null, scheduledFor: agendar_para ?? null });
  const check = post.postId && !post.scheduled ? await getPostStatus(post.postId).catch(() => null) : null;
  await recordActionEvidence(getDb(), taskId, "linkedin_publicar", post.postId, check?.status === "published" ? post.postId : null);
  return `${post.scheduled ? "Agendamento aceito" : "Post criado"} no LinkedIn (${selected.name}). Status: ${check?.status ?? post.status}.${post.url ? ` Link: ${post.url}` : ""}`;
}));

await server.connect(new StdioServerTransport());
