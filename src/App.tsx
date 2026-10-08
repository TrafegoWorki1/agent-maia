import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Home,
  Menu,
  Megaphone,
  MessageCircle,
  Mic2,
  Plug,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { seedGroups } from "./data/seed";
import { LiveChatPage } from "./features/chat/LiveChatPage";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { GruposPage } from "./features/operacao/GruposPage";
import { PeoplePage } from "./features/people/PeoplePage";
import {
  CampanhasPage,
  IndicadoresPage,
  InsightsPage,
  ManualOperadorPanel,
  OcorrenciasPage,
  ResumoPage,
  TomPage,
  VendasPage,
} from "./features/operacao/OperacaoPages";
import { OperationsPage } from "./features/operations/OperationsPage";
import { connectionSummary, useSnapshot } from "./lib/useSnapshot";
import { authorizeRequest, classifyRequest } from "./lib/authorization";
import { createInitialState, loadDemoState, saveDemoState } from "./lib/persistence";
import { askMaiaAgent } from "./lib/maiaApi";
import type { ActionStatus, AuditEvent, GroupId, PageId, PermissionId } from "./lib/types";
import { Avatar, DotStatus } from "./components/ui";

interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { id: "resumo", label: "Resumo", icon: Home },
  { id: "indicadores", label: "Indicadores", icon: BarChart3 },
  { id: "campanhas", label: "Campanhas / aulas", icon: Megaphone },
  { id: "vendas", label: "Vendas e comunidade", icon: CircleDollarSign },
  { id: "insights", label: "Customer insights", icon: Users },
  { id: "tom", label: "Tom de voz", icon: Mic2 },
  { id: "ocorrencias", label: "Ocorrências", icon: AlertTriangle },
  { id: "operacao", label: "Operação", icon: Settings },
  { id: "conexoes", label: "Conexões e dados", icon: Plug },
  { id: "grupos", label: "Grupos", icon: Users },
  { id: "agente", label: "Conversa com Maia", icon: Bot },
  { id: "pessoas", label: "Pessoas", icon: Users },
];

const pageNames: Record<PageId, string> = Object.fromEntries(navItems.map((item) => [item.id, item.label])) as Record<PageId, string>;
// Publicado na Vercel (VITE_MAIA_HOSTED=1): só a página Pessoas, porque as outras dependem do computador.
const HOSTED_ONLY = import.meta.env.VITE_MAIA_HOSTED === "1";
const visibleNavItems = HOSTED_ONLY ? navItems.filter((item) => item.id === "pessoas") : navItems;
const validPageIds = new Set<string>(visibleNavItems.map((item) => item.id));

function pageFromHash(): PageId {
  const value = window.location.hash.replace(/^#/, "");
  return validPageIds.has(value) ? (value as PageId) : HOSTED_ONLY ? "pessoas" : "resumo";
}

function makeId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `${prefix}-${random}`;
}

function timeLabel(): string {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function dateLabel(): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function groupName(id: GroupId): string {
  return seedGroups.find((group) => group.id === id)?.name ?? "Grupo desconhecido";
}

export default function App() {
  const [state, setState] = useState(loadDemoState);
  const [activePage, setActivePage] = useState<PageId>(pageFromHash);
  const live = useSnapshot(!HOSTED_ONLY);
  const liveConnections = connectionSummary(live.snapshot);
  const [memberId, setMemberId] = useState("alex");
  const [groupId, setGroupId] = useState<GroupId>("trafego");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState("");

  const currentMember = useMemo(
    () => state.members.find((member) => member.id === memberId) ?? state.members[0],
    [state.members, memberId],
  );
  const pendingApprovalCount = state.approvals.filter((approval) => approval.status === "aguardando").length;

  useEffect(() => {
    saveDemoState(state);
  }, [state]);

  useEffect(() => {
    const onHashChange = () => setActivePage(pageFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(page: PageId) {
    setActivePage(page);
    setMobileNavOpen(false);
    if (window.location.hash !== `#${page}`) window.history.replaceState(null, "", `#${page}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function sendRequest(requestText: string) {
    const text = requestText.trim();
    if (!text) return;
    const template = classifyRequest(text);
    const decision = authorizeRequest(currentMember, groupId, template);
    const id = makeId("action");
    const approvalId = decision.status === "aguardando_aprovacao" ? makeId("approval") : undefined;
    const status: ActionStatus = decision.status === "permitido" ? "permitido" : decision.status;
    const action = {
      id,
      requesterId: currentMember.id,
      requesterName: currentMember.name,
      originGroupId: groupId,
      title: template.title,
      system: template.system,
      permission: template.permission,
      risk: template.risk,
      originalRequest: text,
      policyReason: decision.explanation,
      status,
      createdAt: new Date().toISOString(),
      approvalId,
    };
    const userMessage = {
      id: makeId("message"),
      at: timeLabel(),
      actor: "membro" as const,
      text,
      actorName: currentMember.name,
    };
    const replyText = decision.status === "permitido"
      ? `Plano: ${template.summary} Conferi ${currentMember.name}, ${groupName(groupId)} e a permissão “${template.permission}”. Posso simular agora. Nenhum sistema de negócio será acionado.`
      : decision.status === "aguardando_aprovacao"
        ? `Não executei. ${decision.explanation} Registrei a solicitação para Herickson Maia no canal separado de aprovação. A decisão, se aprovada, vale só para esta ação.`
        : `Não executei. ${decision.explanation}`;
    const agentMessage = {
      id: makeId("message"),
      at: timeLabel(),
      actor: "maia" as const,
      text: replyText,
      actionId: id,
    };
    const auditEvent: AuditEvent = {
      id: makeId("audit"),
      at: dateLabel(),
      actorName: currentMember.name,
      groupName: groupName(groupId),
      event: text,
      rule: decision.rule,
      outcome: decision.status === "permitido" ? "Prévia apresentada; aguardando escolha de simular" : decision.status === "aguardando_aprovacao" ? "Bloqueado até decisão de Herickson Maia; nenhuma execução" : "Bloqueado pela política",
      status: decision.status === "permitido" ? "permitido" : decision.status,
      actionId: id,
    };

    setState((previous) => ({
      ...previous,
      messages: [...previous.messages, userMessage, agentMessage],
      actions: [...previous.actions, action],
      approvals: approvalId ? [...previous.approvals, {
        id: approvalId,
        actionId: id,
        requesterId: currentMember.id,
        requesterName: currentMember.name,
        originGroupId: groupId,
        destinationGroupId: "aprovacao-alex",
        title: template.title,
        system: template.system,
        risk: template.risk,
        originalRequest: text,
        policyReason: decision.explanation,
        status: "aguardando",
        createdAt: new Date().toISOString(),
      }] : previous.approvals,
      audit: [auditEvent, ...previous.audit],
    }));
    setToast(decision.status === "permitido" ? "Prévia registrada. Nenhum sistema de negócio foi acionado." : decision.status === "aguardando_aprovacao" ? "Pedido encaminhado a Herickson Maia no grupo demonstrativo." : "Pedido bloqueado pela política.");

    // A decisão já foi tomada localmente; o Claude só redige a resposta exibida no chat.
    void askMaiaAgent({
      requesterName: currentMember.name,
      groupName: groupName(groupId),
      request: text,
      decisionStatus: decision.status,
      decisionExplanation: decision.explanation,
    }).then((reply) => {
      if (!reply) return;
      setState((previous) => ({
        ...previous,
        messages: [...previous.messages, {
          id: makeId("message"),
          at: timeLabel(),
          actor: "maia" as const,
          text: reply,
          actionId: id,
          source: "claude" as const,
        }],
      }));
    });
  }

  function decideApproval(approvalId: string, approved: boolean) {
    if (!currentMember.isOwner) {
      setToast("Somente Herickson Maia pode decidir no canal de aprovação demonstrativo.");
      return;
    }
    const nextStatus = approved ? "aprovado" : "recusado";
    const decisionWord = approved ? "aprovou" : "recusou";
    setState((previous) => {
      const approval = previous.approvals.find((item) => item.id === approvalId);
      if (!approval || approval.status !== "aguardando") return previous;
      const at = new Date().toISOString();
      const action = previous.actions.find((item) => item.id === approval.actionId);
      const audit: AuditEvent = {
        id: makeId("audit"),
        at: dateLabel(),
        actorName: "Herickson Maia",
        groupName: groupName("aprovacao-alex"),
        event: `${decisionWord}: ${approval.title}`,
        rule: "decisão explícita e pontual do owner",
        outcome: approved ? "Ação liberada apenas para simulação local; permissões permanentes não mudaram" : "Ação recusada; nenhuma execução",
        status: approved ? "aprovado" : "recusado",
        actionId: approval.actionId,
      };
      const message = {
        id: makeId("message"),
        at: timeLabel(),
        actor: "sistema" as const,
        text: approved
          ? `Herickson Maia aprovou pontualmente “${approval.title}”. A permissão do solicitante não foi alterada. A ação segue disponível somente para simulação local.`
          : `Herickson Maia recusou “${approval.title}”. A solicitação foi encerrada sem execução.`,
        actionId: approval.actionId,
      };
      return {
        ...previous,
        approvals: previous.approvals.map((item) => item.id === approvalId ? { ...item, status: nextStatus, decidedAt: at } : item),
        actions: previous.actions.map((item) => item.id === approval.actionId ? { ...item, status: approved ? "aprovado" : "recusado", policyReason: approved ? "Aprovado pontualmente por Herickson Maia. Nenhuma integração real está conectada." : "Recusado por Herickson Maia. Nenhuma ação foi executada." } : item),
        audit: [audit, ...previous.audit],
        messages: [...previous.messages, message],
      };
    });
    setToast(approved ? "Aprovação pontual registrada. Próxima etapa: simulação local." : "Recusa registrada. Nenhuma ação foi executada.");
  }

  function simulateAction(actionId: string) {
    const action = state.actions.find((item) => item.id === actionId);
    if (!action || !["permitido", "aprovado"].includes(action.status)) return;
    if (!currentMember.isOwner && currentMember.id !== action.requesterId) {
      setToast("Só o solicitante ou Herickson Maia podem concluir esta simulação.");
      return;
    }
    if (action.status === "aprovado" && !state.approvals.some((item) => item.actionId === actionId && item.status === "aprovado")) {
      setToast("Não encontrei uma aprovação explícita de Herickson Maia para esta ação.");
      return;
    }
    if (action.status === "permitido") {
      const originalRequester = state.members.find((member) => member.id === action.requesterId);
      const template = classifyRequest(action.originalRequest);
      const decision = originalRequester
        ? authorizeRequest(originalRequester, action.originGroupId, template)
        : { status: "bloqueado" as const, rule: "solicitante_desconhecido", explanation: "O solicitante não existe mais neste cenário." };
      if (decision.status !== "permitido") {
        const approvalId = decision.status === "aguardando_aprovacao" ? makeId("approval") : undefined;
        const audit: AuditEvent = {
          id: makeId("audit"),
          at: dateLabel(),
          actorName: currentMember.name,
          groupName: groupName(action.originGroupId),
          event: `Revalidação antes da simulação: ${action.title}`,
          rule: decision.rule,
          outcome: approvalId ? "Permissão mudou; ação paralisada e encaminhada a Herickson Maia" : "Solicitante/grupo inválido; ação bloqueada",
          status: decision.status,
          actionId,
        };
        const message = {
          id: makeId("message"),
          at: timeLabel(),
          actor: "maia" as const,
          text: `Revalidei o escopo antes da simulação e não executei. ${decision.explanation}${approvalId ? " O pedido foi enviado novamente a Herickson Maia para decisão pontual." : ""}`,
          actionId,
        };
        setState((previous) => ({
          ...previous,
          actions: previous.actions.map((item) => item.id === actionId ? { ...item, status: decision.status, policyReason: decision.explanation, approvalId } : item),
          approvals: approvalId ? [...previous.approvals, {
            id: approvalId,
            actionId,
            requesterId: action.requesterId,
            requesterName: action.requesterName,
            originGroupId: action.originGroupId,
            destinationGroupId: "aprovacao-alex",
            title: action.title,
            system: action.system,
            risk: action.risk,
            originalRequest: action.originalRequest,
            policyReason: decision.explanation,
            status: "aguardando",
            createdAt: new Date().toISOString(),
          }] : previous.approvals,
          messages: [...previous.messages, message],
          audit: [audit, ...previous.audit],
        }));
        setToast("Revalidação impediu a simulação; a política foi aplicada novamente.");
        return;
      }
    }
    setState((previous) => {
      const existing = previous.actions.find((item) => item.id === actionId);
      if (!existing || !["permitido", "aprovado"].includes(existing.status)) return previous;
      const resultText = `Simulação concluída para “${existing.title}”. Resultado fictício registrado; nenhum sistema externo foi chamado e nenhuma conta foi alterada.`;
      const audit: AuditEvent = {
        id: makeId("audit"),
        at: dateLabel(),
        actorName: currentMember.name,
        groupName: groupName(existing.originGroupId),
        event: `Simulou: ${existing.title}`,
        rule: existing.status === "aprovado" ? "aprovação pontual de Herickson Maia verificada" : "permissão individual e escopo verificados",
        outcome: "Simulação local concluída; zero efeitos externos",
        status: "simulado",
        actionId,
      };
      return {
        ...previous,
        actions: previous.actions.map((item) => item.id === actionId ? { ...item, status: "simulado" } : item),
        messages: [...previous.messages, { id: makeId("message"), at: timeLabel(), actor: "maia", text: resultText, actionId }],
        audit: [audit, ...previous.audit],
      };
    });
    setToast("Resultado fictício registrado. Nenhum sistema foi chamado.");
  }

  function togglePermission(targetMemberId: string, permission: PermissionId) {
    if (!currentMember.isOwner) {
      setToast("Somente Herickson Maia pode editar permissões neste cenário.");
      return;
    }
    const target = state.members.find((member) => member.id === targetMemberId);
    if (!target || target.isOwner) return;
    const removing = target.permissions.includes(permission);
    const permissionName = permission.replaceAll(".", " · ");
    setState((previous) => ({
      ...previous,
      members: previous.members.map((member) => {
        if (member.id !== targetMemberId || member.isOwner) return member;
        const permissions = removing
          ? member.permissions.filter((item) => item !== permission)
          : [...member.permissions, permission];
        return { ...member, permissions };
      }),
      audit: [{
        id: makeId("audit"),
        at: dateLabel(),
        actorName: currentMember.name,
        groupName: groupName("aprovacao-alex"),
        event: `${removing ? "Removeu" : "Concedeu"} “${permissionName}” para ${target.name}`,
        rule: "alteração demonstrativa feita pelo owner",
        outcome: "Permissão local atualizada neste navegador; sem alteração em sistema real",
        status: "simulado",
      }, ...previous.audit],
    }));
    setToast("Permissão demonstrativa atualizada neste navegador.");
  }

  function resetDemo() {
    setState(createInitialState());
    setMemberId("alex");
    setGroupId("trafego");
    setToast("Estado fictício inicial restaurado.");
  }

  function renderActivePage() {
    switch (activePage) {
      case "resumo": return <ResumoPage />;
      case "indicadores": return <IndicadoresPage />;
      case "campanhas": return <CampanhasPage />;
      case "vendas": return <VendasPage />;
      case "insights": return <InsightsPage />;
      case "tom": return <TomPage />;
      case "ocorrencias": return <OcorrenciasPage />;
      case "operacao": return (
        <>
          <ManualOperadorPanel />
          <OperationsPage members={state.members} currentMember={currentMember} onTogglePermission={togglePermission} onReset={resetDemo} />
        </>
      );
      case "conexoes": return <ConnectionsPage />;
      case "grupos": return <GruposPage />;
      case "agente": return <LiveChatPage />;
      case "pessoas": return <PeoplePage />;
    }
  }

  const selectedNav = navItems.find((item) => item.id === activePage)!;
  const ActiveIcon = selectedNav.icon;

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><i /></div>
          <div className="brand-wordmark"><strong>Maia</strong><small>OPERAÇÃO</small></div>
          <button className="mobile-close" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Fechar navegação"><X size={18} /></button>
        </div>
        <div className="workspace-switcher"><span className="workspace-icon"><Building2 size={16} /></span><span><strong>Operação Maia</strong><small>Painel local</small></span><ChevronDown size={14} /></div>
        <div className="nav-section-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Navegação principal">{visibleNavItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} type="button" className={`nav-link ${activePage === item.id ? "nav-link-active" : ""} ${item.id === "agente" ? "nav-link-agent" : ""}`} onClick={() => navigate(item.id)} aria-current={activePage === item.id ? "page" : undefined}>
            <Icon size={17} strokeWidth={activePage === item.id ? 2.2 : 1.8} /><span>{item.label}</span>{item.id === "agente" && pendingApprovalCount > 0 && <span className="nav-badge">{pendingApprovalCount}</span>}
          </button>;
        })}</nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-status"><span className="status-orbit"><Activity size={16} /></span><div><strong>Conexões</strong><small>{liveConnections.label}</small></div><DotStatus tone={liveConnections.tone} /></div>
        <button type="button" className="sidebar-help" onClick={() => navigate("operacao")}><CircleHelp size={16} /> Manual do operador <span>↗</span></button>
        <div className="sidebar-footer"><span>OPERAFLOW</span><span>PROTÓTIPO 0.1</span></div>
      </aside>

      {mobileNavOpen && <button aria-label="Fechar menu" className="mobile-scrim" onClick={() => setMobileNavOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button type="button" className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir navegação"><Menu size={20} /></button><div className="breadcrumb"><span>Operação</span><span className="breadcrumb-separator">/</span><strong><ActiveIcon size={14} /> {pageNames[activePage]}</strong></div></div>
          <div className="topbar-right"><div className="system-state"><DotStatus tone={liveConnections.tone} /><span>{liveConnections.label}</span></div><div className="topbar-divider" />
            <label className="actor-picker"><span>Perfil visualizado</span><select value={memberId} onChange={(event) => setMemberId(event.target.value)} aria-label="Simular usuário">{state.members.map((member) => <option key={member.id} value={member.id}>{member.name}{member.isOwner ? " · owner" : ""}</option>)}</select><ChevronDown size={13} /></label>
            <Avatar initials={currentMember.initials} color={currentMember.color} size="sm" />
          </div>
        </header>
        <div className="mobile-demo-note"><ShieldCheck size={14} /> Painel local · dados reais, só neste computador</div>
        <div className="page-content">
          <div className="selected-profile-note"><span className="profile-role"><span className="profile-dot" style={{ background: currentMember.color }} />{currentMember.title}</span><span className="profile-note-text">Permissões fictícias · editáveis por Herickson Maia na aba Operação</span></div>
          {renderActivePage()}
          <footer className="page-footer"><span>Maia · Operação</span><span>Dados reais · só neste computador</span><span>Atualizado localmente às {timeLabel()}</span></footer>
        </div>
      </main>
      <div className={`toast ${toast ? "toast-visible" : ""}`} role="status" aria-live="polite"><ShieldCheck size={16} />{toast}</div>
    </div>
  );
}
