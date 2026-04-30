import { useEffect } from 'react';
import type { ReactNode } from 'react';

export type ConfirmVariant = 'default' | 'destructive';

interface ConfirmModalProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: ConfirmVariant;
}

export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  const confirmClass =
    variant === 'destructive'
      ? 'bg-amber-warning text-navy-dark hover:bg-amber-warning/90'
      : 'bg-gold text-navy-dark hover:bg-gold-bright';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md bg-navy-light border border-navy-light rounded-xl shadow-2xl p-6 animate-slide-up-fade">
        <h2
          id="confirm-modal-title"
          className="font-display text-xl text-gold-bright mb-3"
        >
          {title}
        </h2>
        <div className="font-body text-slate-light text-sm mb-6">{body}</div>
        <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2.5 rounded-md font-body font-semibold transition-colors min-h-[44px] ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
