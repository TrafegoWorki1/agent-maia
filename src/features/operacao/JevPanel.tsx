import { Panel } from "../../components/ui";
import type { JevData } from "../../lib/snapshotApi";

// Triagem do Jev em modo sombra: mostra a concordância com as ações da Maia. Não altera nenhuma resposta.
export function JevPanel({ data }: { data: JevData }) {
  if (data.error) {
    return (
      <Panel title="Triagem Jev (modo sombra)" caption="Não foi possível ler a triagem agora.">
        <p className="empty-note">{data.error}</p>
      </Panel>
    );
  }
  const below = data.concordancia !== null && data.concordancia < data.meta;
  return (
    <Panel title="Triagem Jev (modo sombra)" caption="Classifica cada mensagem do dono em paralelo à Maia. Não altera nenhuma resposta. Últimos 7 dias.">
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <span>Triadas: <strong>{data.triadas}</strong></span>
        <span>Comparáveis: <strong>{data.comparaveis}</strong></span>
        <span style={{ color: below ? "var(--red, #b42318)" : undefined }}>
          Concordância: <strong>{data.concordancia === null ? "sem dado" : `${data.concordancia}%`}</strong> (meta {data.meta}%)
        </span>
        <span>Alertas de manipulação: <strong>{data.alertasManipulacao}</strong></span>
        <span>Falhas do Jev: <strong>{data.falhas}</strong></span>
      </div>
      {data.ultimas.length === 0 ? (
        <p className="empty-note">Nenhuma mensagem triada ainda.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Canal</th>
                <th>Jev</th>
                <th>Confiança</th>
                <th>Manipulação</th>
                <th>A Maia usou</th>
                <th>Concordou</th>
              </tr>
            </thead>
            <tbody>
              {data.ultimas.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td>{new Date(r.at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  <td>{r.canal}</td>
                  <td>{r.erro ? `falhou: ${r.erro}` : r.categoria ?? "—"}</td>
                  <td>{r.confianca === null ? "—" : `${Math.round(r.confianca * 100)}%`}</td>
                  <td>{r.manipulacao === null ? "—" : `${Math.round(r.manipulacao * 100)}%`}</td>
                  <td>{r.ferramentas.length ? r.ferramentas.join(", ") : "só conversa"}</td>
                  <td>{r.concordou === null ? "sem comparação" : r.concordou ? "sim" : "não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
