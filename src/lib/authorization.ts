import { actionCatalog, seedGroups } from "../data/seed";
import type { ActionTemplate, GroupId, Member } from "./types";

const fallbackAction: ActionTemplate = {
  id: "needs-clarification",
  title: "Pedido a esclarecer",
  system: "Operação (demonstração)",
  permission: "operations.manage",
  keywords: [],
  risk: "alteracao",
  summary: "O pedido não corresponde a um cenário demonstrativo conhecido.",
};

export interface AuthorizationDecision {
  status: "permitido" | "aguardando_aprovacao" | "bloqueado";
  rule: string;
  explanation: string;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

// Casa a palavra-chave só no início de uma palavra, para que "dm" não dispare em "admissões".
function containsKeyword(normalized: string, keyword: string): boolean {
  const escaped = normalizeText(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}`).test(normalized);
}

export function classifyRequest(text: string): ActionTemplate {
  const normalized = normalizeText(text);
  const matches = actionCatalog.flatMap((action) =>
    action.keywords
      .filter((keyword) => containsKeyword(normalized, keyword))
      .map((keyword) => ({ action, specificity: normalizeText(keyword).length })),
  );
  matches.sort((left, right) => right.specificity - left.specificity);
  return matches[0]?.action ?? fallbackAction;
}

export function authorizeRequest(
  member: Member,
  groupId: GroupId,
  action: ActionTemplate,
): AuthorizationDecision {
  const group = seedGroups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return {
      status: "bloqueado",
      rule: "grupo_desconhecido",
      explanation: "Este grupo não faz parte do cenário demonstrativo. Nada foi executado.",
    };
  }

  if (groupId === "aprovacao-alex" && !member.isOwner) {
    return {
      status: "bloqueado",
      rule: "canal_owner_restrito",
      explanation: "Só Herickson Maia participa do canal de aprovação demonstrativo.",
    };
  }

  if (!group.memberIds.includes(member.id)) {
    return {
      status: "aguardando_aprovacao",
      rule: "membro_fora_do_grupo",
      explanation: `${member.name} não consta neste grupo demonstrativo. O pedido foi direcionado para revisão de Herickson Maia.`,
    };
  }

  if (member.isOwner) {
    return {
      status: "permitido",
      rule: "owner_autorizado",
      explanation: "Herickson Maia é o owner deste cenário. A ação ainda será apenas simulada após a prévia.",
    };
  }

  const hasPermission = member.permissions.includes(action.permission);
  const ownerGate = action.risk === "financeiro" || action.risk === "irreversivel";

  if (ownerGate) {
    return {
      status: "aguardando_aprovacao",
      rule: "aprovacao_owner_para_acao_sensivel",
      explanation: `${action.risk === "financeiro" ? "Alteração financeira" : "Mudança de regra"} exige decisão pontual de Herickson Maia neste protótipo, mesmo que o membro tenha outra permissão relacionada.`,
    };
  }

  if (!hasPermission) {
    return {
      status: "aguardando_aprovacao",
      rule: `permissao_ausente:${action.permission}`,
      explanation: `${member.name} não tem a permissão “${action.permission}”. A execução foi bloqueada e o pedido segue para aprovação de Herickson Maia.`,
    };
  }

  return {
    status: "permitido",
    rule: `permissao_concedida:${action.permission}`,
    explanation: `A permissão “${action.permission}” está concedida a ${member.name} neste grupo. A ação aguardará a escolha de simular; não há chamada externa.`,
  };
}

export function statusLabel(status: AuthorizationDecision["status"]): string {
  switch (status) {
    case "permitido":
      return "Permitido para simulação";
    case "aguardando_aprovacao":
      return "Aguardando Herickson Maia";
    case "bloqueado":
      return "Bloqueado";
  }
}
