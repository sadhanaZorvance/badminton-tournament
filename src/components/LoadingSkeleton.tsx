interface LoadingSkeletonProps {
  rows?: number;
  height?: string;
}

export default function LoadingSkeleton({ rows = 3, height = '4rem' }: LoadingSkeletonProps) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg skeleton-shimmer"
          style={{ height }}
        />
      ))}
    </div>
  );
}
