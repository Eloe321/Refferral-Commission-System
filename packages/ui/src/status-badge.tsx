import {
  AlertTriangle,
  Ban,
  Check,
  CircleDashed,
  Clock3,
  Pause,
  RotateCcw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

export type StatusBadgeProps = {
  status: string;
  label?: string;
};

const iconByStatus: Record<string, LucideIcon> = {
  active: Check,
  eligible: Check,
  sent: Check,
  settled: Check,
  completed: Check,
  held: ShieldAlert,
  suspended: Ban,
  failed: AlertTriangle,
  voided: Ban,
  pending: Clock3,
  processing: CircleDashed,
  paused: Pause,
  reversed: RotateCcw,
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function StatusBadge({ status, label = humanize(status) }: StatusBadgeProps) {
  const Icon = iconByStatus[status] ?? CircleDashed;
  return (
    <span className={`ui-status ui-status--${status}`} data-status={status}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.4} />
      <span>{label}</span>
    </span>
  );
}
