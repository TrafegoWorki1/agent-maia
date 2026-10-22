import { useState } from "react";
import { Panel } from "../../components/ui";
import type { MissionPlan, MissionEvidence, NucleusCommand } from "../../lib/nucleusApi";

const states: Record<string, string> = { working: "Em execução", waiting_external: "Aguardando resposta", waiting_owner: "Precisa de você", paused: "Pausada", done: "Concluída", cancelled: "Cancelada" };
const effects: Record<string, string> = { message: "Mensagem ao contato", calendar: "Evento na agenda", group: "Mensagem no grupo", notice: "Resumo ao proprietário" };
function MissionRow({ row, receipts, busy, act }: { row: MissionPlan; receipts: MissionEvidence[]; busy: boolean; act: (command: NucleusCommand) => Promise<void> }) {
  const [note, setNote] = useState("");
  const control = (operation: "pause" | "resume" | "cancel" | "correct") => act({ action: "mission_control", id: row.id, revision: row.revision!, operation, ...(operation === "correct" ? { note } : {}) });
  return <article aria-label={`Missão ${row.id}`} style={{ paddingBlock: 16, borderBottom: "1px solid var(--border)", overflowWrap: "anywhere" }}>
    <p><strong>#{row.id} · {row.title}</strong> · {states[row.mission_state ?? ""] ?? row.status}</p>
    <p>{row.interaction_count ?? 0} de {row.max_interactions ?? 0} mensagens · Validade: {row.expires_at ? new Date(row.expires_at).toLocaleString("pt-BR") : "—"}</p>
    {row.mission_notice && <p role="status">{row.mission_notice}</p>}
    {typeof row.context?.outcome === "string" && <p>{row.context.outcome}</p>}
    {row.status === "active" && <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {["working", "waiting_external"].includes(row.mission_state ?? "") && <button type="button" disabled={busy} onClick={() => void control("pause")}>Pausar missão</button>}
        {["paused", "waiting_owner"].includes(row.mission_state ?? "") && <button type="button" disabled={busy} onClick={() => void control("resume")}>Retomar missão</button>}
        <button type="button" disabled={busy} onClick={() => void control("cancel")}>Cancelar próximos passos</button>
      </div>
      <details><summary>Corrigir orientação</summary><form onSubmit={event => { event.preventDefault(); void control("correct"); }}>
        <label htmlFor={`mission-note-${row.id}`}>Nova orientação dentro dos limites delegados</label>
        <textarea id={`mission-note-${row.id}`} value={note} onChange={event => setNote(event.target.value)} required minLength={3} maxLength={2000} style={{ display: "block", width: "100%", boxSizing: "border-box" }} />
        <button type="submit" disabled={busy}>Salvar correção</button>
      </form></details>
    </>}
    <details><summary>Evidências ({receipts.length})</summary>
      {receipts.length ? receipts.map(receipt => <p key={receipt.id}>{effects[receipt.kind] ?? receipt.kind}: {receipt.state === "confirmed" ? receipt.kind === "calendar" ? "Conferido" : "Envio aceito" : "Resultado incerto; conferir"} · {new Date(receipt.created_at).toLocaleString("pt-BR")} {receipt.evidence && <>· ID {String(receipt.evidence.messageId ?? receipt.evidence.id ?? "—")}</>}</p>) : <p>Ainda não há efeitos registrados.</p>}
    </details>
  </article>;
}
export function MissionPanel({ plans, receipts, busy, act }: { plans: MissionPlan[]; receipts: MissionEvidence[]; busy: boolean; act: (command: NucleusCommand) => Promise<void> }) {
  const missions = plans.filter(row => row.kind && row.kind !== "general");
  return <Panel title="Missões delegadas" caption="Conversas, reuniões e avisos acompanhados pela Maia. Pausar ou cancelar impede os próximos passos; ações já realizadas permanecem.">
    {busy && <p role="status">Salvando alteração…</p>}
    {missions.length ? missions.map(row => <MissionRow key={row.id} row={row} receipts={receipts.filter(r => r.plan_id === row.id)} busy={busy} act={act} />) : <p>Nenhuma missão registrada. Peça à Maia no WhatsApp para conduzir uma conversa ou agendar uma reunião.</p>}
  </Panel>;
}
