interface CourtBadgeProps {
  court: string;
}

export default function CourtBadge({ court }: CourtBadgeProps) {
  return (
    <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full bg-gold/20 text-gold-bright text-xs font-body font-semibold tracking-wider min-w-[36px]">
      {court}
    </span>
  );
}
