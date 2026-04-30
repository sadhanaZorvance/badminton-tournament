interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="w-full bg-error/15 border border-error/40 rounded-md px-4 py-3 mb-4 flex items-center gap-3"
    >
      <span className="text-error font-body text-sm flex-1">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-md bg-error text-white text-sm font-body font-medium hover:bg-error/90 transition-colors min-h-[36px]"
      >
        Retry
      </button>
    </div>
  );
}
