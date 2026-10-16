import { lazy, Suspense, useEffect, useState } from "react";
import { Activity, Bot, BriefcaseBusiness, CircleHelp, Home, KeyRound, Landmark, Layers, Megaphone, Menu, Plug, ShieldCheck, TrendingUp, Users, X } from "lucide-react";
import { Avatar, DotStatus } from "./components/ui";
import { connectionSummary, SnapshotProvider, useSnapshot } from "./lib/useSnapshot";
import { supabase } from "./lib/supabaseBrowser";
import { fetchPanelIdentity } from "./lib/collaborationApi";
import { parseRoute, routeHash, sections, type PanelRoute, type ScreenId } from "./lib/navigation";
const PeoplePage = lazy(() => import("./features/people/PeoplePage").then((m) => ({ default: m.PeoplePage })));
const GruposPage = lazy(() => import("./features/operacao/GruposPage").then((m) => ({ default: m.GruposPage })));
const ClientsPage = lazy(() => import("./features/organization/ClientsPage").then((m) => ({ default: m.ClientsPage })));
const AccessGroupsPage = lazy(() => import("./features/organization/AccessGroupsPage").then((m) => ({ default: m.AccessGroupsPage })));
const RegrasPage = lazy(() => import("./features/operacao/RegrasPage").then((m) => ({ default: m.RegrasPage })));
const ModelosPage = lazy(() => import("./features/operacao/ModelosPage").then((m) => ({ default: m.ModelosPage })));
const MemoriaPage = lazy(() => import("./features/operacao/MemoriaPage").then((m) => ({ default: m.MemoriaPage })));
const NucleoPage = lazy(() => import("./features/operacao/NucleoPage").then((m) => ({ default: m.NucleoPage })));
const ConnectionsPage = lazy(() => import("./features/connections/ConnectionsPage").then((m) => ({ default: m.ConnectionsPage })));
const TarefasPage = lazy(() => import("./features/operacao/TarefasPage").then((m) => ({ default: m.TarefasPage })));
const ResumoPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.ResumoPage })));
const IndicadoresPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.IndicadoresPage })));
const CampanhasPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.CampanhasPage })));
const VendasPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.VendasPage })));
const InsightsPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.InsightsPage })));
const TomPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.TomPage })));
const OcorrenciasPage = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.OcorrenciasPage })));
const ManualOperadorPanel = lazy(() => import("./features/operacao/OperacaoPages").then((m) => ({ default: m.ManualOperadorPanel })));
const OportunidadesPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.OportunidadesPage })));
const FunilPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.FunilPage })));
const ProjetosListaPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.ProjetosListaPage })));
const ImplementacoesPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.ImplementacoesPage })));
const ReceitasPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.ReceitasPage })));
const CustosPage = lazy(() => import("./features/departments/DepartmentPages").then((m) => ({ default: m.CustosPage })));
const CollaborationPage = lazy(() => import("./features/collaboration/CollaborationPage").then((m) => ({ default: m.CollaborationPage })));
const HOSTED = import.meta.env.VITE_MAIA_HOSTED === "1";
const icons = { work: BriefcaseBusiness, home: Home, marketing: Megaphone, execution: ShieldCheck, groups: Users, access: KeyRound, agent: Bot, system: Plug, comercial: TrendingUp, projetos: Layers, financeiro: Landmark };
type AppIdentity = { owner:boolean;name:string;screens:string[];accessVersion:string };

export default function App() {
  const [identity, setIdentity] = useState<AppIdentity | null>(null);
  const [identityError,setIdentityError]=useState("");
  useEffect(() => {
    let active = true,generation=0;let controller:AbortController|undefined;
    async function load() {
      const current=++generation;controller?.abort();const request=new AbortController();controller=request;
      if (!supabase) { if (active) setIdentityError("Painel colaborativo exige autenticação configurada."); return; }
      try {
        const data=await fetchPanelIdentity(request.signal);
        if(active&&current===generation){setIdentity({owner:data.owner,name:data.name,screens:data.screens,accessVersion:data.accessVersion});setIdentityError("");}
      } catch(error) { if(active&&current===generation){setIdentity(null);setIdentityError(error instanceof Error?error.message:"Não foi possível carregar seu acesso.");} }
    }
    void load();const timer=setInterval(()=>void load(),30_000);const online=()=>void load();window.addEventListener("online",online);
    const auth=supabase?.auth.onAuthStateChange(()=>{setIdentity(null);void load();});
    return () => { active = false;controller?.abort();clearInterval(timer);window.removeEventListener("online",online);auth?.data.subscription.unsubscribe(); };
  }, []);
  if (!identity) return <p className="empty-note" role={identityError?"alert":"status"}>{identityError||"Carregando seu painel…"}</p>;
  return <SnapshotProvider key={identity.accessVersion} enabled={identity.owner}><PanelShell identity={identity} /></SnapshotProvider>;
}
function PanelShell({ identity }: { identity: AppIdentity }) {
  const routeAccess=identity.owner?true:identity.screens;
  const [route, setRoute] = useState<PanelRoute>(() => parseRoute(window.location.hash, routeAccess));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { snapshot } = useSnapshot(identity.owner);
  const status = connectionSummary(snapshot);
  const current = sections.find((s) => s.id === route.section)!;
  const activePage = current.pages.find((p) => p.id === route.screen)!;
  const Icon = icons[current.icon];
  useEffect(() => {
    const change = () => {
      const next = parseRoute(window.location.hash, routeAccess);
      setRoute(next); setMobileOpen(false);
      if (window.location.hash !== routeHash(next)) window.history.replaceState(null, "", routeHash(next));
    };
    change(); window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, [identity.owner,identity.screens.join("|")]);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);
  const nav = sections.filter((s) => identity.owner || (s.id==="trabalho"&&s.pages.some((page)=>identity.screens.includes(page.id))));
  return <div className="app-frame">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><div className="brand-mark"><span /><span /><i /></div><div className="brand-wordmark"><strong>Maia</strong><small>WORKI DIGITAL</small></div><button type="button" className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar navegação"><X size={18} /></button></div>
      <div className="workspace-switcher"><span className="workspace-icon"><Bot size={17} /></span><span><strong>Operação Maia</strong><small>{HOSTED ? "Painel da operação" : "Painel local"}</small></span></div>
      <div className="nav-section-label">SEU PAINEL</div>
      <nav className="primary-nav" aria-label="Navegação principal">{nav.map((section) => {
        const NavIcon = icons[section.icon];
        return <a key={section.id} className={`nav-link ${route.section === section.id ? "nav-link-active" : ""}`} href={routeHash({ section: section.id, screen: section.pages[0].id })} onClick={() => setMobileOpen(false)} aria-current={route.section === section.id ? "page" : undefined}><NavIcon size={17} /><span>{section.label}</span></a>;
      })}</nav>
      <div className="sidebar-spacer" />
      {identity.owner && <><a href="#sistema/conexoes" className="sidebar-status"><span className="status-orbit"><Activity size={16} /></span><div><strong>Sistema</strong><small>{status.label}</small></div><DotStatus tone={status.tone} /></a><a className="sidebar-help" href="#agente-maia/manual"><CircleHelp size={16} /> Manual de continuidade</a></>}
      <div className="sidebar-footer"><span>WORKI DIGITAL</span><span>MAIA</span></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
    <main className="main-area"><header className="topbar"><div className="topbar-left"><button type="button" className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir navegação" aria-expanded={mobileOpen}><Menu size={20} /></button><div className="breadcrumb"><span>{current.label}</span><span className="breadcrumb-separator">/</span><strong><Icon size={14} /> {activePage.label}</strong></div></div><div className="topbar-right"><span className="account-name">{identity.name}<small>{identity.owner ? "Proprietário" : "Seu acesso"}</small></span><Avatar initials={identity.name.trim().split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase()} color="#74572c" size="sm" /></div></header>
      <div className="page-content"><nav className="section-nav" aria-label={`Páginas de ${current.label}`}>{current.pages.filter((p) => identity.owner || identity.screens.includes(p.id)).map((page) => <a key={page.id} href={routeHash({ section: current.id, screen: page.id })} aria-current={route.screen === page.id ? "page" : undefined}>{page.label}</a>)}</nav>
        <Suspense fallback={<p role="status" className="empty-note">Carregando página…</p>}><Screen id={route.screen} /></Suspense>
        <footer className="page-footer"><span>Maia · Worki Digital</span><span>{snapshot ? `Última leitura: ${new Date(snapshot.generatedAt).toLocaleTimeString("pt-BR")}` : "Dados da operação"}</span></footer>
      </div></main>
  </div>;
}
function Screen({ id }: { id: ScreenId }) {
  switch (id) {
    case "meu-dia": return <CollaborationPage mode="meu-dia" />;
    case "minha-equipe": return <CollaborationPage mode="minha-equipe" />;
    case "coordenacao": return <CollaborationPage mode="coordenacao" />;
    case "direcao": return <CollaborationPage mode="direcao" />;
    case "planejamento": return <CollaborationPage mode="planejamento" />;
    case "metricas": return <CollaborationPage mode="metricas" />;
    case "resumo": return <ResumoPage />;
    case "indicadores": return <IndicadoresPage />;
    case "campanhas": return <CampanhasPage />;
    case "vendas": return <VendasPage />;
    case "insights": return <InsightsPage />;
    case "tom": return <TomPage />;
    case "tarefas": return <TarefasPage />;
    case "ocorrencias": return <OcorrenciasPage />;
    case "oportunidades": return <OportunidadesPage />;
    case "funil": return <FunilPage />;
    case "projetos-lista": return <ProjetosListaPage />;
    case "implementacoes": return <ImplementacoesPage />;
    case "receitas": return <ReceitasPage />;
    case "custos": return <CustosPage />;
    case "grupos": return <GruposPage />;
    case "clientes": return <ClientsPage />;
    case "pessoas": return <PeoplePage />;
    case "grupos-acesso": return <AccessGroupsPage />;
    case "regras": return <RegrasPage />;
    case "memoria": return <MemoriaPage />;
    case "nucleo": return <NucleoPage />;
    case "manual": return <ManualOperadorPanel />;
    case "conexoes": return <ConnectionsPage />;
    case "modelos": return <ModelosPage />;
  }
}
