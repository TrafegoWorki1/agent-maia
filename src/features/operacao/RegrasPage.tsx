import { PageHeader, Panel } from "../../components/ui";
import { useSnapshot } from "../../lib/useSnapshot";

// Regras que a Maia segue. Vêm da tabela maia_rules; o prompt de sistema é montado a partir delas.
export function RegrasPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Regras da Maia" subtitle="O que a Maia segue, na ordem em que aparece no prompt. Leitura: a edição fica para a próxima etapa." />
      {!snapshot ? (
        <p className="empty-note">{error ? "Ainda sem dados para esta tela. As informações da Maia chegam só pelo computador dela." : "Carregando…"}</p>
      ) : (
        <Panel title="Regras ativas" caption={`${snapshot.regras.filter((r) => r.ativa).length} de ${snapshot.regras.length} regras ativas`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Categoria</th><th>Regra</th><th>Texto</th><th>Situação</th></tr></thead>
              <tbody>
                {snapshot.regras.map((r) => (
                  <tr key={r.codigo}>
                    <td>{r.ordem}</td>
                    <td>{r.categoria}</td>
                    <td>{r.titulo}</td>
                    <td>{r.texto}</td>
                    <td>{r.ativa ? "ativa" : "inativa"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}
