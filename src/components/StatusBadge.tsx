import type { EventStatus, MatchStatus } from '../types';

type Status = MatchStatus | EventStatus;

interface StatusBadgeProps {
  status: Status;
}

const STATUS_STYLES: Record<Status, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-navy-light text-slate' },
  ready: { label: 'Ready', className: 'bg-gold/20 text-gold-bright' },
  in_progress: { label: 'Live', className: 'bg-emerald-500/20 text-emerald-300' },
  complete: { label: 'Complete', className: 'bg-sky-500/20 text-sky-300' },
  walkover: { label: 'Walkover', className: 'bg-amber-warning/20 text-amber-warning' },
  retired: { label: 'Retired', className: 'bg-amber-warning/20 text-amber-warning' },
  active: { label: 'Active', className: 'bg-emerald-500/20 text-emerald-300' },
  published: { label: 'Published', className: 'bg-gold/30 text-gold-bright' },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const style = STATUS_STYLES[status];
  if (!style) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-body font-medium uppercase tracking-wider ${style.className}`}
    >
      {style.label}
    </span>
  );
}
