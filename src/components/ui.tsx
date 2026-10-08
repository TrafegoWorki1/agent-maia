import type { ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Minus,
} from "lucide-react";
import type { Metric } from "../lib/types";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}

export function Panel({
  title,
  caption,
  action,
  children,
  className = "",
}: {
  title?: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || caption || action) && (
        <div className="panel-heading">
          <div>
            {title && <h2>{title}</h2>}
            {caption && <p>{caption}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const statusMap = {
  alvo: { label: "No alvo", Icon: CircleCheck, className: "status-good" },
  atencao: { label: "Atenção", Icon: CircleAlert, className: "status-warn" },
  critico: { label: "Crítico", Icon: CircleX, className: "status-bad" },
  sem_dado: { label: "Sem dado", Icon: CircleHelp, className: "status-muted" },
} as const;

export function StatusPill({ status, label }: { status: Metric["status"]; label?: string }) {
  const config = statusMap[status];
  const Icon = config.Icon;
  return (
    <span className={`status-pill ${config.className}`}>
      <Icon size={13} strokeWidth={2.3} aria-hidden="true" />
      {label ?? config.label}
    </span>
  );
}

export function MetricCard({ metric, index = 0 }: { metric: Metric; index?: number }) {
  const trend = metric.change?.startsWith("−") ? "down" : "up";
  return (
    <article className={`metric-card metric-${metric.status}`} style={{ "--stagger": `${index * 45}ms` } as React.CSSProperties}>
      <div className="metric-topline">
        <span className="metric-label">{metric.label}</span>
        <StatusPill status={metric.status} />
      </div>
      <div className="metric-value-row">
        <strong className="metric-value">{metric.value}</strong>
        {metric.change && (
          <span className={`metric-change ${trend === "down" ? "change-down" : "change-up"}`}>
            {trend === "down" ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
            {metric.change.replace(/[+−]/, "")}
          </span>
        )}
      </div>
      <p className="metric-helper">{metric.helper}</p>
    </article>
  );
}

export interface BarPoint {
  label: string;
  value: number;
  auxiliary?: number;
}

export function MiniBars({
  points,
  primaryLabel = "Atual",
  secondaryLabel = "Período anterior",
  compact = false,
}: {
  points: BarPoint[];
  primaryLabel?: string;
  secondaryLabel?: string;
  compact?: boolean;
}) {
  const max = Math.max(1, ...points.flatMap((point) => [point.value, point.auxiliary ?? 0]));
  return (
    <div className={`mini-bars ${compact ? "mini-bars-compact" : ""}`}>
      <div className="chart-legend">
        <span><i className="legend-dot legend-current" />{primaryLabel}</span>
        {points.some((point) => point.auxiliary !== undefined) && (
          <span><i className="legend-dot legend-prior" />{secondaryLabel}</span>
        )}
      </div>
      <div className="bar-list">
        {points.map((point) => (
          <div className="bar-row" key={point.label}>
            <span className="bar-label">{point.label}</span>
            <div className="bar-track" aria-label={`${point.label}: ${point.value}`}>
              {point.auxiliary !== undefined && (
                <span className="bar-fill bar-prior" style={{ width: `${(point.auxiliary / max) * 100}%` }} />
              )}
              <span className="bar-fill bar-current" style={{ width: `${(point.value / max) * 100}%` }} />
            </div>
            <strong className="bar-value">{point.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Avatar({
  initials,
  color,
  size = "md",
}: {
  initials: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className={`avatar avatar-${size}`} style={{ "--avatar-color": color } as React.CSSProperties} aria-hidden="true">
      {initials}
    </span>
  );
}

export function EmptyState({
  title,
  detail,
  icon,
}: {
  title: string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon ?? <Activity size={19} />}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function SmallStat({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="small-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </div>
  );
}

export function Rule({ children }: { children: ReactNode }) {
  return <div className="rule-note">{children}</div>;
}

export function DotStatus({ tone = "green" }: { tone?: "green" | "gold" | "red" | "gray" | "blue" }) {
  return <span className={`dot-status dot-${tone}`} aria-hidden="true" />;
}

export function NumberMark({ children }: { children: ReactNode }) {
  return <span className="number-mark">{children}</span>;
}

export function MutedDash() {
  return <span className="muted-dash"><Minus size={13} /></span>;
}
