import { PageHeader, Panel } from "../../components/ui";
import { formatWhen } from "../../lib/snapshotApi";
import { useSnapshot } from "../../lib/useSnapshot";

// Grupos do WhatsApp. Lista e atividade reais; ações são feitas pelo WhatsApp, com aprovação.

export function GruposPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader
        eyebrow="Operação"
        title="Grupos"
        subtitle="Grupos do WhatsApp com atividade real. Criar grupo e tarefas se faz pelo WhatsApp do dono."
      />
      {!snapshot ? (
        <p className="empty-note">{error ? `Não foi possível ler o painel: ${error}.` : "Carregando…"}</p>
      ) : (
        <>
          {snapshot.groups.error && (
            <p role="alert" className="empty-note">
              Não consegui atualizar a lista de grupos agora ({snapshot.groups.error}). Mostrando o último dado disponível.
            </p>
          )}
          <Panel title="Grupos" caption={`${snapshot.groups.total} grupo(s) · atividade dos últimos 7 dias. Sem o texto das mensagens.`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Grupo</th>
                    <th>Participantes</th>
                    <th>Mensagens · 7 dias</th>
                    <th>Última atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.groups.groups.map((g) => (
                    <tr key={g.jid}>
                      <td>{g.subject}</td>
                      <td>{g.size ?? "—"}</td>
                      <td>{g.messages7d}</td>
                      <td>{g.lastActivity ? formatWhen(g.lastActivity) : "sem atividade"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {snapshot.groups.total === 0 && <p className="empty-note">Nenhum grupo encontrado na Evolution.</p>}
            </div>
          </Panel>
          <Panel title="Comandos pelo WhatsApp do dono" caption="Criar grupo passa pela aprovação do aprovador.">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>criar grupo</strong> Nome do grupo | 5585999999999, 5585888888888
              </li>
              <li>
                <strong>tarefa</strong> Título da tarefa — ou <strong>tarefa</strong> Título grupo Nome do grupo
              </li>
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
