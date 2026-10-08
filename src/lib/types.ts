export type PageId =
  | "resumo"
  | "indicadores"
  | "campanhas"
  | "vendas"
  | "insights"
  | "tom"
  | "ocorrencias"
  | "operacao"
  | "conexoes"
  | "grupos"
  | "agente"
  | "pessoas";

export type GroupId = "principal" | "trafego" | "aprovacao-alex";

export type PermissionId =
  | "metrics.read"
  | "campaigns.read"
  | "ads.report"
  | "ads.manage"
  | "crm.read"
  | "crm.update"
  | "instagram.read"
  | "instagram.reply"
  | "calendar.read"
  | "calendar.create"
  | "voice.review"
  | "operations.read"
  | "operations.manage";

export interface Member {
  id: string;
  name: string;
  initials: string;
  title: string;
  color: string;
  groupIds: GroupId[];
  permissions: PermissionId[];
  isOwner?: boolean;
}

export interface DemoGroup {
  id: GroupId;
  name: string;
  description: string;
  memberIds: string[];
}

export interface ActionTemplate {
  id: string;
  title: string;
  system: string;
  permission: PermissionId;
  keywords: string[];
  risk: "leitura" | "alteracao" | "financeiro" | "irreversivel";
  summary: string;
  safeByDefault?: boolean;
}

export type ActionStatus =
  | "permitido"
  | "bloqueado"
  | "aguardando_aprovacao"
  | "aprovado"
  | "recusado"
  | "simulado";

export interface AgentAction {
  id: string;
  requesterId: string;
  requesterName: string;
  originGroupId: GroupId;
  title: string;
  system: string;
  permission: PermissionId;
  risk: ActionTemplate["risk"];
  originalRequest: string;
  policyReason: string;
  status: ActionStatus;
  createdAt: string;
  approvalId?: string;
}

export interface ApprovalRequest {
  id: string;
  actionId: string;
  requesterId: string;
  requesterName: string;
  originGroupId: GroupId;
  destinationGroupId: "aprovacao-alex";
  title: string;
  system: string;
  risk: ActionTemplate["risk"];
  originalRequest: string;
  policyReason: string;
  status: "aguardando" | "aprovado" | "recusado";
  createdAt: string;
  decidedAt?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorName: string;
  groupName: string;
  event: string;
  rule: string;
  outcome: string;
  status: ActionStatus;
  actionId?: string;
}

export interface ChatMessage {
  id: string;
  at: string;
  actor: "maia" | "membro" | "sistema";
  actorName?: string;
  text: string;
  actionId?: string;
  // "claude" marca respostas redigidas pelo Claude via Agent SDK; ações continuam simuladas.
  source?: "local" | "claude";
}

export interface DemoState {
  members: Member[];
  actions: AgentAction[];
  approvals: ApprovalRequest[];
  audit: AuditEvent[];
  messages: ChatMessage[];
}

export interface Metric {
  label: string;
  value: string;
  helper: string;
  status: "alvo" | "atencao" | "critico" | "sem_dado";
  change?: string;
}

export interface Integration {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  color: string;
}
