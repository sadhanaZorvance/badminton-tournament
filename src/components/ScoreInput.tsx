import type { ChangeEvent } from 'react';

interface ScoreInputProps {
  value: number | '';
  onChange: (value: number | '') => void;
  playerName: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function ScoreInput({
  value,
  onChange,
  playerName,
  disabled = false,
  ariaLabel,
}: ScoreInputProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '') {
      onChange('');
      return;
    }
    const cleaned = raw.replace(/[^0-9]/g, '');
    if (cleaned === '') {
      onChange('');
      return;
    }
    const parsed = parseInt(cleaned, 10);
    if (!Number.isNaN(parsed)) onChange(parsed);
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <label className="font-body text-xs text-slate uppercase tracking-wider">
        {playerName}
      </label>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value === '' ? '' : String(value)}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel ?? `${playerName} score`}
        className="w-24 min-h-[56px] text-center font-display text-3xl text-white bg-navy-dark border-2 border-navy-light rounded-lg focus:outline-none focus:border-gold-bright tabular-nums disabled:opacity-50"
      />
    </div>
  );
}
