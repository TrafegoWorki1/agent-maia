import { useCallback, useEffect, useState } from "react";
import { fetchSnapshot, type Snapshot } from "./snapshotApi";

const POLL_MS = 30_000;

// Lê o snapshot do servidor local a cada 30 segundos. Mantém o último dado bom se uma leitura falhar.
// enabled=false: não consulta o servidor local (usado na Vercel).
export function useSnapshot(enabled = true): { snapshot: Snapshot | null; error: string | null; reload: () => Promise<void> } {
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
  const checks = [
    snapshot.whatsapp.state === "open",
    Boolean(snapshot.webhook.host),
    ...Object.values(snapshot.sources).map((s) => s?.status === "ok"),
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
