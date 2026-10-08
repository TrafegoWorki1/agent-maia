import {
  Activity,
  CalendarDays,
  Camera,
  Check,
  CircleHelp,
  LockKeyhole,
  MessageCircle,
  Megaphone,
  RotateCcw,
  ShieldCheck,
  Table2,
  ToggleLeft,
} from "lucide-react";
import { integrations, permissionCatalog, seedGroups } from "../../data/seed";
import type { GroupId, Member, PermissionId } from "../../lib/types";
import { Avatar, PageHeader, Panel, Rule } from "../../components/ui";

const iconByName = {
  message: MessageCircle,
  pipeline: Activity,
  instagram: Camera,
  calendar: CalendarDays,
  sheet: Table2,
  ads: Megaphone,
};

export function OperationsPage({
  members,
  currentMember,
  onTogglePermission,
  onReset,
}: {
  members: Member[];
  currentMember: Member;
  onTogglePermission: (memberId: string, permission: PermissionId) => void;
  onReset: () => void;
}) {
  const ownerCanEdit = Boolean(currentMember.isOwner);
  return (
    <>
      <PageHeader eyebrow="Operação" title="Operação" subtitle="Membros reais e regras de escrita. As permissões abaixo são de referência: quem decide escrita é o aprovador, por ação." action={<button className="button button-outline" onClick={onReset}><RotateCcw size={15} /> Restaurar padrão</button>} />
      <Rule><strong>Controle de escrita:</strong> a Maia só altera dados reais com SIM do aprovador, por ação. Esta tela não concede acesso a nenhuma conta.</Rule>
      <div className="content-grid content-grid-wide">
        <Panel title="Mapa de grupos" caption="Membros reais · conversa pelo WhatsApp do dono">
          <div className="group-cards">{seedGroups.map((group) => (
            <article className={`group-card ${group.id === "aprovacao-alex" ? "group-card-approval" : ""}`} key={group.id}>
              <div className="group-card-icon">{group.id === "aprovacao-alex" ? <ShieldCheck size={17} /> : <MessageCircle size={17} />}</div>
              <div><strong>{group.name}</strong><p>{group.description}</p><small>{group.memberIds.length} perfil{group.memberIds.length === 1 ? "" : "s"} · simulado</small></div>
            </article>
          ))}</div>
        </Panel>
        <Panel title="Como a Maia decide" caption="Validação em cada pedido">
          <ol className="operation-steps"><li><span>1</span><div><strong>Grupo e remetente</strong><small>Confere se a pessoa está no grupo de origem.</small></div></li><li><span>2</span><div><strong>Permissão e escopo</strong><small>Permissão precisa cobrir a ação pedida.</small></div></li><li><span>3</span><div><strong>Risco e aprovação</strong><small>Fora do escopo vai para Herickson Maia; nada roda antes da decisão.</small></div></li><li><span>4</span><div><strong>Registro</strong><small>Guarda a regra, decisão e resultado demonstrativo.</small></div></li></ol>
        </Panel>
      </div>
      <Panel title="Permissões por pessoa" caption="Apenas Herickson Maia edita neste cenário · alterações ficam no armazenamento local do navegador">
        {!ownerCanEdit && <div className="owner-only-banner"><LockKeyhole size={15} /> Você está visualizando como {currentMember.name}. Selecione Herickson Maia no cabeçalho para testar a edição local.</div>}
        <div className="permission-list">
          {members.map((member) => (
            <div className="permission-member" key={member.id}>
              <div className="member-info"><Avatar initials={member.initials} color={member.color} /><div><strong>{member.name}{member.isOwner && <span className="owner-tag">OWNER</span>}</strong><small>{member.title}</small></div></div>
              <div className="permission-groups">{member.groupIds.map((groupId: GroupId) => <span key={groupId}>{seedGroups.find((group) => group.id === groupId)?.name}</span>)}</div>
              <div className="permission-chips">
                {permissionCatalog.map((permission) => {
                  const enabled = member.permissions.includes(permission.id);
                  return <button key={permission.id} type="button" className={`permission-chip ${enabled ? "permission-enabled" : ""}`} aria-pressed={enabled} aria-label={`${member.name}: ${permission.label} ${enabled ? "concedida" : "não concedida"}`} title={`${permission.area} · ${permission.label}`} disabled={!ownerCanEdit || member.isOwner} onClick={() => onTogglePermission(member.id, permission.id)}>
                    {enabled ? <Check size={12} /> : <ToggleLeft size={13} />}{permission.label}
                  </button>;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="permission-footnote"><CircleHelp size={14} /> Novos membros são cadastrados pelo owner. Conexões de dados ficam em Conexões e dados.</div>
      </Panel>
      <Panel title="Conexões" caption="Status em tempo real">
        <p className="connector-note">Os conectores ativos (WhatsApp, Gmail, Meta Ads, Sheets e Agenda) aparecem com status real em Conexões e dados.</p>
      </Panel>
      <div className="ops-footer"><span><ShieldCheck size={14} /> Regras verificadas localmente</span><span>Persistência: navegador atual</span><span>Versão: protótipo 0.1</span></div>
    </>
  );
}
