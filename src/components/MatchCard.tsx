import type { Match } from '../types';
import CourtBadge from './CourtBadge';
import FormatChip from './FormatChip';

export type MatchCardVariant = 'live' | 'ready' | 'compact';

interface MatchCardProps {
  match: Match;
  variant: MatchCardVariant;
  p1Name?: string;
  p2Name?: string;
  eventLabel?: string;
  onClick?: () => void;
}

function nameFor(match: Match, side: 'p1' | 'p2', explicit?: string): string {
  if (explicit) return explicit;
  return side === 'p1' ? match.p1_ref || 'TBD' : match.p2_ref || 'TBD';
}

function roundLabel(match: Match): string {
  return match.round;
}

export default function MatchCard({
  match,
  variant,
  p1Name,
  p2Name,
  eventLabel,
  onClick,
}: MatchCardProps) {
  const p1 = nameFor(match, 'p1', p1Name);
  const p2 = nameFor(match, 'p2', p2Name);
  const handicap = match.handicap_applied;

  const Wrapper = onClick ? 'button' : 'div';
  const wrapperProps = onClick
    ? { type: 'button' as const, onClick, className: 'w-full text-left' }
    : {};

  const lastSet = match.score_sets?.[match.score_sets.length - 1];

  if (variant === 'live') {
    return (
      <Wrapper {...wrapperProps}>
        <div className="relative rounded-lg bg-navy-light border border-navy-light pl-4 pr-4 py-3 animate-pulse-gold overflow-hidden">
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 bottom-0 w-1 bg-gold-bright"
          />
          <div className="flex items-center justify-between mb-2 gap-2">
            <div className="flex items-center gap-2">
              {match.court && <CourtBadge court={match.court} />}
              <span className="text-xs font-body text-slate uppercase tracking-wider">
                {eventLabel ?? roundLabel(match)}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-body font-semibold text-emerald-300 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-body text-white text-base flex-1 truncate">
              {p1}
              {handicap && (
                <span
                  className="text-amber-warning ml-1"
                  title="Handicap match"
                  aria-label="Handicap match"
                >
                  ★
                </span>
              )}
            </span>
            <div className="font-display text-gold-bright text-2xl tabular-nums whitespace-nowrap">
              {lastSet ? `${lastSet.p1} – ${lastSet.p2}` : '— – —'}
            </div>
            <span className="font-body text-white text-base flex-1 truncate text-right">
              {p2}
              {handicap && (
                <span
                  className="text-amber-warning ml-1"
                  title="Handicap match"
                  aria-label="Handicap match"
                >
                  ★
                </span>
              )}
            </span>
          </div>
          {match.score_sets && match.score_sets.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {match.score_sets.map((s, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded bg-navy-dark text-slate text-[11px] font-body tabular-nums"
                >
                  {s.p1}-{s.p2}
                </span>
              ))}
            </div>
          )}
        </div>
      </Wrapper>
    );
  }

  if (variant === 'ready') {
    return (
      <Wrapper {...wrapperProps}>
        <div className="rounded-lg bg-navy-light/60 border border-navy-light px-4 py-3 hover:bg-navy-light transition-colors">
          <div className="flex items-center justify-between mb-2 gap-2">
            <span className="text-xs font-body text-slate uppercase tracking-wider truncate">
              {eventLabel ?? roundLabel(match)}
            </span>
            <FormatChip format={match.match_format} />
          </div>
          <div className="font-body text-white text-base">
            {p1}
            {handicap && <span className="text-amber-warning ml-1">★</span>}
            <span className="text-slate mx-2">vs</span>
            {p2}
            {handicap && <span className="text-amber-warning ml-1">★</span>}
          </div>
        </div>
      </Wrapper>
    );
  }

  // compact
  return (
    <Wrapper {...wrapperProps}>
      <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-navy-light/40 hover:bg-navy-light transition-colors text-sm font-body">
        <span className="text-slate text-xs uppercase tracking-wider w-12 shrink-0">
          {match.bracket_slot || roundLabel(match)}
        </span>
        <span className="text-white truncate flex-1">
          {p1} <span className="text-slate">vs</span> {p2}
        </span>
        {match.court && <CourtBadge court={match.court} />}
      </div>
    </Wrapper>
  );
}
