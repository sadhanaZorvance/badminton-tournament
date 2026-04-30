import type { MatchFormat } from '../types';

interface FormatChipProps {
  format: MatchFormat;
}

const FORMAT_LABELS: Record<MatchFormat, string> = {
  set21: 'Set 21',
  set30: 'Set 30',
  best_of_3x15: 'Best of 3',
};

export default function FormatChip({ format }: FormatChipProps) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-body font-medium bg-navy-light text-slate-light border border-navy-light">
      {FORMAT_LABELS[format]}
    </span>
  );
}
