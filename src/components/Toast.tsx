import { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  durationMs?: number;
  onDismiss?: () => void;
}

export default function Toast({ message, durationMs = 3000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, message, onDismiss]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-navy-dark border border-gold/40 text-gold-bright px-4 py-2 rounded-md shadow-lg font-body text-sm animate-slide-up-fade"
    >
      {message}
    </div>
  );
}
