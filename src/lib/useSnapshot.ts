import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchSnapshot, type Snapshot } from "./snapshotApi";

const POLL_MS = 30_000;

// Uma leitura compartilhada a cada 30 segundos, local ou autenticada na Vercel.
// enabled=false impede a consulta para contas sem acesso ao snapshot.
type SnapshotState = { snapshot: Snapshot | null; error: string | null; reload: () => Promise<void> };
const SnapshotContext = createContext<SnapshotState | null>(null);
export function SnapshotProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const value = useSnapshotState(enabled);
  return createElement(SnapshotContext.Provider, { value }, children);
}
export function useSnapshot(enabled = true): SnapshotState {
  const shared = useContext(SnapshotContext);
  const local = useSnapshotState(enabled && !shared);
  return shared ?? local;
}
function useSnapshotState(enabled = true): SnapshotState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSnapshot(await fetchSnapshot());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar o painel");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [reload, enabled]);

  return { snapshot, error, reload };
}

// Resumo das conexões para a barra superior: quantas estão ativas e se alguma tem erro.
export function connectionSummary(snapshot: Snapshot | null): { tone: "green" | "gold" | "red" | "gray"; label: string } {
  if (!snapshot) return { tone: "gray", label: "Verificando conexões…" };
  const whatsappConnected = ["open", "connected", "conectado"].includes(snapshot.whatsapp.state?.trim().toLowerCase() ?? "");
  const checks = [
    whatsappConnected,
    Boolean(snapshot.webhook.host),
    ...Object.values(snapshot.sources).map((s) => s?.status === "ok" && Date.parse(snapshot.generatedAt)-Date.parse(s.fetched_at)<=60*60_000),
  ];
  const errors = [
    snapshot.whatsapp.error !== null,
    ...Object.values(snapshot.sources).map((s) => s?.status === "error"),
  ].filter(Boolean).length;
  const active = checks.filter(Boolean).length;
  const label = `${active} de ${checks.length} conexões ativas`;
  if (errors > 0) return { tone: "red", label: `${label} · ${errors} com erro` };
  return { tone: active === checks.length ? "green" : "gold", label };
}
