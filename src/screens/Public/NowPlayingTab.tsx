import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import MatchCard from '../../components/MatchCard';
import { supabase } from '../../lib/supabase';
import type {
  Event,
  Match,
  MatchRound,
  Player,
  Team,
} from '../../types';

interface NowPlayingTabProps {
  refreshTick: number;
}

const PHASE_ORDER: Record<MatchRound, number> = {
  R1: 1,
  RR: 1,
  BLP: 2,
  ConRR: 3,
  QF: 4,
  SF: 5,
  '3P': 6,
  ConF: 7,
  F: 8,
};

const UP_NEXT_LIMIT = 5;
const POLL_INTERVAL_MS = 30_000;

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ShuttlecockIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="w-12 h-12 text-slate"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="24" cy="38" rx="5" ry="5" />
      <path d="M24 33 L24 9" />
      <path d="M19 33 L14 10" />
      <path d="M29 33 L34 10" />
      <path d="M16 18 L32 18" strokeDasharray="2 2" />
      <path d="M14 26 L34 26" strokeDasharray="2 2" />
    </svg>
  );
}

export default function NowPlayingTab({ refreshTick }: NowPlayingTabProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const isInitial = useRef(true);

  const fetchAll = useCallback(async () => {
    const [matchesRes, eventsRes, playersRes, teamsRes] = await Promise.all([
      supabase.from('matches').select('*').in('status', ['ready', 'in_progress']),
      supabase.from('events').select('*'),
      supabase.from('players').select('*'),
      supabase.from('teams').select('*'),
    ]);
    if (matchesRes.error) throw matchesRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    setMatches((matchesRes.data ?? []) as Match[]);
    setEvents((eventsRes.data ?? []) as Event[]);
    setPlayers((playersRes.data ?? []) as Player[]);
    setTeams((teamsRes.data ?? []) as Team[]);
    setLastUpdated(new Date());
  }, []);

  const load = useCallback(async () => {
    if (isInitial.current) setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load matches';
      setError(msg);
    } finally {
      setLoading(false);
      isInitial.current = false;
    }
  }, [fetchAll]);

  // Initial fetch + manual refresh (parent bumps refreshTick)
  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  // Polling fallback: 30s alongside Realtime, never instead of it
  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Realtime subscription on matches table
  useEffect(() => {
    const channel = supabase
      .channel('public-now-playing')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const eventById = useMemo(() => {
    const map = new Map<string, Event>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const playerNameById = useMemo(() => {
    const map = new Map<string, string>();
    players.forEach((p) => map.set(p.id, p.display_name));
    return map;
  }, [players]);

  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.display_name));
    return map;
  }, [teams]);

  const nameFor = useCallback(
    (id: string | null, type: Match['p1_type'], fallback: string) => {
      if (!id) return fallback || 'TBD';
      if (type === 'team') return teamNameById.get(id) ?? fallback ?? 'TBD';
      return playerNameById.get(id) ?? fallback ?? 'TBD';
    },
    [playerNameById, teamNameById],
  );

  const eventLabel = useCallback(
    (match: Match) => {
      const ev = eventById.get(match.event_id);
      if (!ev) return match.round;
      return `${ev.name} · ${match.round}`;
    },
    [eventById],
  );

  const inProgress = useMemo(
    () => matches.filter((m) => m.status === 'in_progress'),
    [matches],
  );

  const upNext = useMemo(() => {
    const list = matches.filter((m) => m.status === 'ready');
    list.sort((a, b) => {
      const phase = (PHASE_ORDER[a.round] ?? 99) - (PHASE_ORDER[b.round] ?? 99);
      if (phase !== 0) return phase;
      const aEv = eventById.get(a.event_id);
      const bEv = eventById.get(b.event_id);
      const evCmp = (aEv?.code ?? '').localeCompare(bEv?.code ?? '');
      if (evCmp !== 0) return evCmp;
      return (a.bracket_slot ?? '').localeCompare(b.bracket_slot ?? '', undefined, {
        numeric: true,
      });
    });
    return list.slice(0, UP_NEXT_LIMIT);
  }, [matches, eventById]);

  if (loading) {
    return (
      <div>
        <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">Live</h2>
        <LoadingSkeleton rows={2} height="6rem" />
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full bg-error animate-pulse"
          />
          <h2 className="font-body text-xs uppercase tracking-[0.2em] text-error font-semibold">
            Live
          </h2>
        </div>

        {inProgress.length === 0 ? (
          <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-10 flex flex-col items-center gap-3 text-center">
            <ShuttlecockIcon />
            <p className="font-body text-white text-base">
              No matches in play right now
            </p>
            <p className="font-body text-slate text-sm">
              Check back soon or see what's Up Next below
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {inProgress.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                variant="live"
                eventLabel={eventLabel(m)}
                p1Name={nameFor(m.p1_id, m.p1_type, m.p1_ref)}
                p2Name={nameFor(m.p2_id, m.p2_type, m.p2_ref)}
              />
            ))}
          </div>
        )}
      </section>

      {upNext.length > 0 && (
        <section className="mb-6">
          <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
            Up Next
          </h2>
          <div className="space-y-3">
            {upNext.map((m) => (
              <MatchCard
                key={m.id}
                match={m}
                variant="ready"
                eventLabel={eventLabel(m)}
                p1Name={nameFor(m.p1_id, m.p1_type, m.p1_ref)}
                p2Name={nameFor(m.p2_id, m.p2_type, m.p2_ref)}
              />
            ))}
          </div>
        </section>
      )}

      {lastUpdated && (
        <p className="text-slate text-xs font-body text-center mt-4">
          Last updated {formatTime(lastUpdated)}
        </p>
      )}
    </div>
  );
}
