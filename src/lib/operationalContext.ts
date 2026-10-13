// Contrato compartilhado entre Plano 01 (Inteligência) e Plano 02 (Painel por Departamentos).
// Toda tarefa, plano, automação e ação da Maia pode ter contexto organizacional quando
// apropriado; nunca adivinhar cliente a partir do texto.

export type OperationalArea =
  | 'marketing'
  | 'comercial'
  | 'projetos'
  | 'implementacoes'
  | 'clientes_cs'
  | 'financeiro'
  | 'administracao'
  | 'agente_sistema';

export interface OperationalContext {
  area: OperationalArea | null;
  clientId: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  sourceTaskId: number | null;
}

export interface DataProvenance {
  source: string;
  collectedAt: string;
  periodStart?: string;
  periodEnd?: string;
  status: 'ok' | 'stale' | 'missing' | 'error';
  externalId?: string;
}

export const AREA_LABELS: Record<OperationalArea, string> = {
  marketing: 'Marketing',
  comercial: 'Comercial',
  projetos: 'Projetos',
  implementacoes: 'Implementações',
  clientes_cs: 'Clientes e CS',
  financeiro: 'Financeiro',
  administracao: 'Administração',
  agente_sistema: 'Agente e Sistema',
};

// DB-safe string list for check constraints / Zod enums
export const AREA_VALUES: OperationalArea[] = [
  'marketing', 'comercial', 'projetos', 'implementacoes',
  'clientes_cs', 'financeiro', 'administracao', 'agente_sistema',
];
