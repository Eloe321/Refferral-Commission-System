import { Money } from "@referral-sandbox/ui";
import type { ReactNode } from "react";

export type MetricCardProps = {
  label: string;
  value: { amountMinor: string; currency: string } | ReactNode;
  note: string;
  tone?: "neutral" | "success" | "warning" | "danger";
};

function isMoney(
  value: MetricCardProps["value"],
): value is { amountMinor: string; currency: string } {
  return typeof value === "object" && value !== null && "amountMinor" in value;
}

export function MetricCard({ label, value, note, tone = "neutral" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-card__label">{label}</p>
      <strong className="metric-card__value">
        {isMoney(value) ? <Money {...value} /> : value}
      </strong>
      <p className="metric-card__note">{note}</p>
    </article>
  );
}
