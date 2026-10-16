import { ArrowUpRight, BarChart3, CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

export type IndicatorTone = "neutral" | "attention" | "danger";
const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function IndicatorCard({ label, value, unit, helper, category, tone = "neutral", onClick, selected = false }: {
  label: string; value: number | string | null; unit?: string; helper: string;
  category?: string; tone?: IndicatorTone; onClick?: () => void; selected?: boolean;
}) {
  const available = value !== null;
  const content = <>
    <span className="work-indicator-top"><span>{category ?? "Indicador"}</span>{available ? <BarChart3 size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}</span>
    <span className="work-indicator-label">{label}</span>
    <span className="work-indicator-measure"><strong>{available ? typeof value === "number" ? numberFormat.format(value) : value : "—"}</strong>{available && unit && <span>{unit}</span>}</span>
    <span className="work-indicator-helper">{available ? helper : `Indisponível · ${helper}`}</span>
    {onClick && <span className="work-indicator-link">{selected ? "Ocultar registros" : "Ver registros"}<ArrowUpRight size={14} aria-hidden="true" /></span>}
  </>;
  const className = `work-indicator work-indicator-${available ? tone : "unavailable"}`;
  return onClick ? <button type="button" className={className} aria-pressed={selected} onClick={onClick}>{content}</button> : <article className={className}>{content}</article>;
}

export function IndicatorGrid({ children, compact = false, label }: { children: ReactNode; compact?: boolean; label: string }) {
  return <div className={`work-indicator-grid${compact ? " work-indicator-grid-compact" : ""}`} role="group" aria-label={label}>{children}</div>;
}

export function MeasureBar({ value, total, label, attention = false }: { value: number; total: number; label: string; attention?: boolean }) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0 || value < 0) return null;
  return <div className={`work-measure-bar${attention ? " work-measure-bar-attention" : ""}`}><progress max={total} value={Math.min(value, total)} aria-label={label} /><span className="work-measure-description">{label}</span></div>;
}
