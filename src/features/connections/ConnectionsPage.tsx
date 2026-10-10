import { useCallback, useEffect, useState } from "react";
import { PageHeader, Panel, StatusPill } from "../../components/ui";
import { fetchSnapshot, formatWhen, requestRefresh, type Snapshot } from "../../lib/snapshotApi";

const SOURCE_LABELS = { gmail: "Gmail", meta: "Meta Ads", sheets: "Google Sheets", calendar: "Google Agenda" } as const;

function whatsappState(state: string | null, error: string | null): { status: "alvo" | "atencao" | "critico"; label: string } {
  const normalized = state?.trim().toLowerCase() ?? "";
  if (["open", "connected", "conectado"].includes(normalized)) return { status: "alvo", label: "Conectado" };
  if (["close", "closed", "disconnected", "desconectado"].includes(normalized)) return { status: "critico", label: "Desconectado" };
  if (error) return { status: "critico", label: "Falha ao consultar Evolution" };
  if (["connecting", "connecting...", "conectando"].includes(normalized)) return { status: "atencao", label: "Conectando" };
  return { status: "atencao", label: "Sem leitura do estado" };
}

export function ConnectionsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setSnapshot(await fetchSnapshot()); setLoadError(null); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Falha ao carregar o painel"); }
  }, []);
  const refreshing = snapshot?.refreshing ?? false;
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), refreshing ? 5_000 : 30_000);
    return () => clearInterval(timer);
  }, [load, refreshing]);

  async function refreshNow() {
    try {
      const started = await requestRefresh();
      setNotice(started ? "Atualização das fontes solicitada. Acompanhe o resultado abaixo." : "Já existe uma atualização em andamento.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao atualizar"); }
  }

  const whatsapp = whatsappState(snapshot?.whatsapp.state ?? null, snapshot?.whatsapp.error ?? null);

  return (
    <>
      <PageHeader eyebrow="Integrações" title="Conexões e dados" subtitle="Disponibilidade, atualização e erros das fontes. O painel consulta o estado a cada 30 segundos."
        action={<button type="button" className="button button-outline" onClick={refreshNow} disabled={refreshing}>{refreshing ? "Atualizando…" : "Atualizar fontes"}</button>} />
      {loadError && <p role="alert" className="empty-note">Não foi possível atualizar o estado: {loadError}{snapshot ? " Exibindo a última leitura disponível." : ""}</p>}
      {notice && <p role="status" className="empty-note">{notice}</p>}
      {!snapshot && !loadError && <p className="empty-note">Carregando conexões…</p>}
      {snapshot && <>
        <Panel title="Serviços da Maia" caption={`Estado consultado em ${formatWhen(snapshot.generatedAt)}. Uma execução bem-sucedida não confirma a entrega no WhatsApp.`}>
          <div className="table-wrap"><table>
            <thead><tr><th>Serviço</th><th>Estado observado</th><th>Última atividade</th><th>Diagnóstico</th></tr></thead>
            <tbody>
              <tr><td>WhatsApp · Evolution</td><td><StatusPill status={whatsapp.status} label={whatsapp.label} /></td><td>{formatWhen(snapshot.generatedAt)}</td><td>{snapshot.whatsapp.error ?? (whatsapp.status === "alvo" ? "Estado da instância consultado na Evolution" : snapshot.whatsapp.state ?? "A Evolution não retornou o estado da instância")}</td></tr>
              <tr><td>Recebimento de eventos</td><td><StatusPill status={snapshot.webhook.lastEventAt ? "alvo" : "sem_dado"} label={snapshot.webhook.lastEventAt ? "Evento registrado" : "Sem registro"} /></td><td>{formatWhen(snapshot.webhook.lastEventAt)}</td><td>{snapshot.webhook.host ?? "Endereço não informado; consulte o horário do último evento"}</td></tr>
              <tr><td>Agente da Maia</td><td><StatusPill status={snapshot.chat?.status === "ok" ? "alvo" : snapshot.chat?.status === "error" ? "critico" : "sem_dado"} label={snapshot.chat?.status === "ok" ? "Última execução OK" : snapshot.chat?.status === "error" ? "Última execução falhou" : snapshot.chat ? "Em execução" : "Sem execução"} /></td><td>{formatWhen(snapshot.chat?.started_at)}</td><td>{snapshot.chat?.error ?? "Resultado do processamento pelo modelo"}</td></tr>
            </tbody>
          </table></div>
        </Panel>
        <Panel title="Redes sociais · Zernio" caption="A Maia tem acesso às contas conectadas e usa a integração com aprovação para ações públicas.">
          <div className="table-wrap"><table>
            <thead><tr><th>Conexão</th><th>Status</th><th>Objetivo atual</th></tr></thead>
            <tbody><tr>
              <td>Instagram da Worki</td>
              <td><StatusPill status="alvo" label="Conectado" /></td>
              <td>Consultar desempenho; publicar ou agendar uma arte com legenda e aprovação. Mensagens e ações em massa não estão disponíveis.</td>
            </tr><tr>
              <td>LinkedIn da Worki</td>
              <td><StatusPill status="alvo" label="Conectado" /></td>
              <td>Consultar conta, organizações e métricas; publicar ou agendar posts com aprovação. DMs/InMail não estão disponíveis.</td>
            </tr></tbody>
          </table></div>
        </Panel>
        <Panel title="Sincronização das fontes" caption="Coleta prevista a cada 30 minutos. Após 60 minutos sem leitura bem-sucedida, a fonte requer atenção.">
          <div className="table-wrap"><table>
            <thead><tr><th>Fonte</th><th>Estado da coleta</th><th>Última tentativa</th><th>Diagnóstico</th></tr></thead>
            <tbody>{Object.entries(SOURCE_LABELS).map(([key, label]) => {
              const source = snapshot.sources[key as keyof typeof SOURCE_LABELS];
              const age = source ? Date.parse(snapshot.generatedAt) - Date.parse(source.fetched_at) : NaN;
              const stale = !Number.isFinite(age) || age > 60 * 60_000;
              const usable = source?.status === "ok" && source.data !== null;
              const status = source?.status === "error" ? "critico" : usable ? stale ? "atencao" : "alvo" : "sem_dado";
              return <tr key={key}><td>{label}</td><td><StatusPill status={status} label={source?.status === "error" ? "Falha na coleta" : usable ? stale ? "Desatualizada" : "Atualizada" : "Sem coleta válida"} /></td><td>{formatWhen(source?.fetched_at)}</td><td>{source?.error ?? (usable ? stale ? "Solicite uma atualização da fonte" : "Dados disponíveis para consulta" : "Aguardando primeira coleta válida")}</td></tr>;
            })}</tbody>
          </table></div>
          <p className="empty-note">Em caso de falha, o horário indica a tentativa mais recente. A idade do último dado preservado não é informada pelo registro atual.</p>
        </Panel>
      </>}
    </>
  );
}
