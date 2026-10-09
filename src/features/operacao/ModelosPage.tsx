import { PageHeader, Panel } from "../../components/ui";
import { formatWhen } from "../../lib/snapshotApi";
import { useSnapshot } from "../../lib/useSnapshot";

// Modelos e Roteamento: quem executou cada tarefa, como se comportou e por que foi escolhido.
// Métricas que o provedor não informa aparecem como "—", nunca como valor inventado.
const STATE_LABEL: Record<string, string> = {
  healthy: "disponível",
  degraded: "instável",
  cooldown: "em pausa (limite)",
  unavailable: "indisponível",
  recovering: "recuperando",
};

function show(value: number | null | undefined, suffix = ""): string {
  return value === null || value === undefined ? "—" : `${value}${suffix}`;
}

export function ModelosPage() {
  const { snapshot, error } = useSnapshot();
  return (
    <>
      <PageHeader eyebrow="Operação" title="Modelos e Roteamento" subtitle="Quem executou cada tarefa nos últimos 7 dias, a saúde de cada provedor e as trocas de modelo." />
      {!snapshot ? (
        <p className="empty-note">{error ? "Ainda sem dados para esta tela. As informações da Maia chegam só pelo computador dela." : "Carregando…"}</p>
      ) : (
        <>
          {snapshot.modelos.error && <p role="alert" className="empty-note">Não consegui ler as métricas agora ({snapshot.modelos.error}).</p>}
          <Panel title="Saúde dos provedores" caption="Um provedor em pausa não recebe tarefas até o fim do cooldown.">
            {snapshot.modelos.saude.length === 0 ? (
              <p className="empty-note">Nenhuma ocorrência registrada: os provedores estão com o estado padrão (disponível).</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Provedor</th><th>Estado</th><th>Falhas seguidas</th><th>Último erro</th><th>Até</th></tr></thead>
                  <tbody>
                    {snapshot.modelos.saude.map((h) => (
                      <tr key={h.provider}>
                        <td>{h.provider}</td>
                        <td>{STATE_LABEL[h.state] ?? h.state}</td>
                        <td>{h.consecutive_failures}</td>
                        <td>{h.last_error_class ?? "—"}</td>
                        <td>{h.cooldown_until ? formatWhen(h.cooldown_until) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Execuções por modelo" caption={`${snapshot.modelos.total} execuções · fallback em ${snapshot.modelos.taxaFallback}%`}>
            {snapshot.modelos.porModelo.length === 0 ? (
              <p className="empty-note">Ainda sem execuções com provedor registrado. Elas aparecem depois que a Maia reiniciar com a versão nova.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Provedor</th><th>Modelo</th><th>Execuções</th><th>Sucesso</th><th>Tempo médio</th><th>Tokens (entrada/saída)</th><th>Custo informado</th></tr></thead>
                  <tbody>
                    {snapshot.modelos.porModelo.map((m) => (
                      <tr key={`${m.provider}-${m.model}`}>
                        <td>{m.provider}</td>
                        <td>{m.model}</td>
                        <td>{m.execucoes}</td>
                        <td>{m.sucesso}%</td>
                        <td>{m.duracaoMediaMs === null ? "—" : `${(m.duracaoMediaMs / 1000).toFixed(1)} s`}</td>
                        <td>{show(m.tokensEntrada)} / {show(m.tokensSaida)}</td>
                        <td>{m.custoUsd === null ? "—" : `US$ ${m.custoUsd.toFixed(3)}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Por categoria de tarefa">
            {Object.keys(snapshot.modelos.porCategoria).length === 0 ? (
              <p className="empty-note">Sem dados ainda.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {Object.entries(snapshot.modelos.porCategoria).map(([categoria, total]) => (
                  <li key={categoria}>{categoria}: <strong>{total}</strong></li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Trocas de provedor (fallback)" caption="Cada troca registra o motivo. Só ocorre sem efeito externo iniciado.">
            {snapshot.modelos.fallbacks.length === 0 ? (
              <p className="empty-note">Nenhuma troca de provedor nos últimos 7 dias.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {snapshot.modelos.fallbacks.map((f, i) => (
                  <li key={`${f.em}-${i}`}>{formatWhen(f.em)}: {f.de} → {f.para} ({f.motivo ?? "sem motivo registrado"})</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Artes">
            <p style={{ margin: 0 }}>
              {snapshot.modelos.imagensHoje ? `Hoje (${snapshot.modelos.imagensHoje.dia}): ${snapshot.modelos.imagensHoje.usadas} arte(s) usadas da cota diária.` : "Nenhuma arte gerada pela cota diária ainda."}
            </p>
          </Panel>
        </>
      )}
    </>
  );
}
