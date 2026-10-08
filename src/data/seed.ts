import type {
  ActionTemplate,
  AuditEvent,
  ChatMessage,
  DemoGroup,
  Integration,
  Member,
  Metric,
  PermissionId,
} from "../lib/types";

export const DEMO_LABEL = "AMBIENTE DE DEMONSTRAÇÃO · DADOS FICTÍCIOS";

export const permissionCatalog: { id: PermissionId; label: string; area: string }[] = [
  { id: "metrics.read", label: "Consultar indicadores", area: "Dados" },
  { id: "campaigns.read", label: "Consultar campanhas e aulas", area: "Marketing" },
  { id: "ads.report", label: "Ler relatórios de anúncios", area: "Tráfego pago" },
  { id: "ads.manage", label: "Alterar campanha ou orçamento", area: "Tráfego pago" },
  { id: "crm.read", label: "Consultar CRM", area: "Comercial" },
  { id: "crm.update", label: "Atualizar dados de CRM", area: "Comercial" },
  { id: "instagram.read", label: "Consultar caixa do Instagram", area: "Social" },
  { id: "instagram.reply", label: "Enviar resposta no Instagram", area: "Social" },
  { id: "calendar.read", label: "Consultar agenda", area: "Agenda" },
  { id: "calendar.create", label: "Criar agendamento", area: "Agenda" },
  { id: "voice.review", label: "Revisar tom de voz", area: "Conteúdo" },
  { id: "operations.read", label: "Consultar operação", area: "Operação" },
  { id: "operations.manage", label: "Alterar regras e permissões", area: "Operação" },
];

export const seedMembers: Member[] = [
  {
    id: "alex",
    name: "Herickson Maia",
    initials: "HM",
    title: "Owner · todas as áreas",
    color: "#74572c",
    groupIds: ["principal", "trafego", "aprovacao-alex"],
    permissions: permissionCatalog.map((permission) => permission.id),
    isOwner: true,
  },
  {
    id: "gessica",
    name: "Gessica",
    initials: "GE",
    title: "Participante · operação",
    color: "#5d7890",
    groupIds: ["principal"],
    permissions: ["metrics.read", "campaigns.read"],
  },
];

export const seedGroups: DemoGroup[] = [
  {
    id: "principal",
    name: "Operação principal",
    description: "Grupo demonstrativo · owner e uma participante",
    memberIds: ["alex", "gessica"],
  },
  {
    id: "trafego",
    name: "Tráfego pago",
    description: "Grupo demonstrativo de tráfego",
    memberIds: ["alex"],
  },
  {
    id: "aprovacao-alex",
    name: "Aprovação · Herickson Maia",
    description: "Escalonamentos de demonstração para o owner",
    memberIds: ["alex"],
  },
];

// Métricas zeradas: sem valores de demonstração. Cada indicador aparece como "Sem dado" até uma fonte ser conectada.
export const seedMetrics: Metric[] = [
  { label: "Cadastros na campanha", value: "—", helper: "Sem dado · fonte não conectada", status: "sem_dado" },
  { label: "Investimento em mídia", value: "—", helper: "Sem dado · fonte não conectada", status: "sem_dado" },
  { label: "Custo por cadastro", value: "—", helper: "Sem dado · fonte não conectada", status: "sem_dado" },
  { label: "Conversas aguardando", value: "—", helper: "Sem dado · fila não conectada", status: "sem_dado" },
  { label: "Vendas atribuídas", value: "—", helper: "Sem dado · fonte não conectada", status: "sem_dado" },
  { label: "Origem sem dado", value: "—", helper: "Sem dado · fonte não conectada", status: "sem_dado" },
];

export const seedWeeklyBars: { label: string; value: number; auxiliary: number }[] = [];

export const seedSalesByRegion: { region: string; registrations: number; sales: number }[] = [];

export const seedObjections: { topic: string; count: number; color: string }[] = [];

export const actionCatalog: ActionTemplate[] = [
  {
    id: "ads-report",
    title: "Consultar relatório de anúncios",
    system: "Meta Ads (simulado)",
    permission: "ads.report",
    keywords: ["relatório de anúncio", "relatorio de anuncio", "relatório dos anúncios", "campanha", "tráfego", "trafego", "cpc", "custo por cadastro", "desempenho dos anúncios"],
    risk: "leitura",
    summary: "Consultar métricas agregadas de mídia fictícias.",
  },
  {
    id: "ads-budget",
    title: "Alterar orçamento de campanha",
    system: "Meta Ads (simulado)",
    permission: "ads.manage",
    keywords: ["aumentar orçamento", "aumenta o orçamento", "aumente o orçamento", "aumentar o orçamento", "diminuir orçamento", "pausar anúncio", "pausar campanha", "mudar orçamento", "alterar orçamento"],
    risk: "financeiro",
    summary: "Simular uma alteração de orçamento, sem alterar uma conta real.",
  },
  {
    id: "crm-read",
    title: "Consultar informações agregadas do CRM",
    system: "Kommo (simulado)",
    permission: "crm.read",
    keywords: ["crm", "kommo", "lead", "leads", "funil", "reunião agendada", "reuniao agendada"],
    risk: "leitura",
    summary: "Consultar somente totais e estágios fictícios, sem mostrar contatos.",
  },
  {
    id: "crm-update",
    title: "Atualizar um registro demonstrativo do CRM",
    system: "Kommo (simulado)",
    permission: "crm.update",
    keywords: ["mover card", "atualizar card", "adicionar tag", "registrar venda", "alterar etapa"],
    risk: "alteracao",
    summary: "Simular uma atualização não destrutiva, com alvo fictício.",
  },
  {
    id: "instagram-reply",
    title: "Enviar uma resposta demonstrativa no Instagram",
    system: "Instagram (desativado)",
    permission: "instagram.reply",
    keywords: ["instagram", "dm", "direct", "responder mensagem", "enviar mensagem"],
    risk: "alteracao",
    summary: "Demonstrar o fluxo de aprovação sem enviar mensagem real.",
  },
  {
    id: "calendar-read",
    title: "Consultar disponibilidade demonstrativa",
    system: "Google Agenda (simulado)",
    permission: "calendar.read",
    keywords: ["agenda", "horário livre", "horario livre", "disponibilidade", "próxima semana", "proxima semana"],
    risk: "leitura",
    summary: "Consultar uma agenda fictícia, sem inferir disponibilidade real.",
  },
  {
    id: "calendar-create",
    title: "Criar agendamento demonstrativo",
    system: "Google Agenda (desativado)",
    permission: "calendar.create",
    keywords: ["marcar call", "agendar", "criar reunião", "criar reuniao", "marcar reunião", "marcar reuniao"],
    risk: "alteracao",
    summary: "Simular um evento de agenda sem criar um compromisso real.",
  },
  {
    id: "operations-change",
    title: "Alterar uma regra operacional",
    system: "Políticas (simulado)",
    permission: "operations.manage",
    keywords: ["mudar permissão", "mudar permissao", "alterar regra", "dar acesso", "remover acesso"],
    risk: "irreversivel",
    summary: "Propor uma alteração de política, sem aplicar permissão real.",
  },
];

export const integrations: Integration[] = [
  { id: "evolution", name: "Evolution API · WhatsApp", category: "Mensageria", description: "Grupo principal, tráfego pago e escalonamento", icon: "message", color: "green" },
  { id: "kommo", name: "Kommo", category: "CRM", description: "Leitura e ações comerciais com limites", icon: "pipeline", color: "plum" },
  { id: "instagram", name: "Instagram", category: "Social", description: "Leitura e respostas conforme política", icon: "instagram", color: "rose" },
  { id: "calendar", name: "Google Agenda", category: "Agenda", description: "Disponibilidade e solicitações de horário", icon: "calendar", color: "blue" },
  { id: "sheets", name: "Google Sheets / Forms", category: "Dados", description: "Importação controlada de formulários e métricas", icon: "sheet", color: "green" },
  { id: "meta", name: "Meta Ads", category: "Mídia", description: "Relatórios e, futuramente, ações aprovadas", icon: "ads", color: "gold" },
];

// Auditoria começa vazia: eventos aparecem conforme as ações são feitas na demo.
export const seedAudit: AuditEvent[] = [];

export const seedChatMessages: ChatMessage[] = [
  {
    id: "message-welcome",
    at: "Agora",
    actor: "maia",
    text: "Olá. Sou a Maia em modo de demonstração. Vou conferir grupo, pessoa, permissão e escopo antes de propor qualquer ação. Nada daqui se conecta a contas reais.",
  },
];
