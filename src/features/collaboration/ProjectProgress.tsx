import { MeasureBar } from "../../components/WorkIndicators";
import { EmptyState, Panel } from "../../components/ui";
import type { CollaborationData, CollaborationTask } from "../../lib/collaborationApi";

const statusNames: Record<string, string> = { planned: "Planejado", active: "Ativo", on_hold: "Em espera", completed: "Concluído", cancelled: "Cancelado" };
export function ProjectProgress({ data, tasks, onOpen }: { data: CollaborationData; tasks: CollaborationTask[]; onOpen: (id: string) => void }) {
  return <Panel title="Acompanhamento dos projetos" caption="Contagem de entregáveis concluídos, sem ponderação por esforço. Abra um projeto para consultar seus registros.">
    {data.projects.length ? <div className="work-project-grid">{data.projects.map(project => {
      const deliverables = data.deliverables.filter(row => row.project_id === project.id && row.status !== "cancelled");
      const completed = deliverables.filter(row => row.status === "completed").length;
      const blocked = tasks.filter(task => task.project_ref_id === project.id && task.workflow_status === "blocked").length;
      return <article className="work-project-card" key={String(project.id)}><div className="work-group-heading"><span>{statusNames[String(project.status)] ?? String(project.status)}</span><span>{blocked > 0 ? `${blocked} bloqueios` : "Sem bloqueios registrados"}</span></div><h3><button type="button" onClick={() => onOpen(String(project.id))}>{String(project.name)}</button></h3>
        <p>{data.clients.find(client => client.id === project.client_id)?.name ?? "Cliente autorizado"}</p><p>Prazo: {project.due_on ? String(project.due_on).split("-").reverse().join("/") : "Não informado"}</p>
        {deliverables.length ? <MeasureBar value={completed} total={deliverables.length} label={`${completed} de ${deliverables.length} entregáveis concluídos`} /> : <p className="work-source-note">Sem entregáveis cadastrados para medir avanço.</p>}
      </article>;
    })}</div> : <EmptyState title="Nenhum projeto neste recorte" detail="A carteira autorizada aparecerá após o cadastro de projetos." />}
  </Panel>;
}
