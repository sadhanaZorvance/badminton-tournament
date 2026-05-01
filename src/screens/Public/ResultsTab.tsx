import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { supabase } from '../../lib/supabase';
import type { EntrantType, Event, Match, Player, Team } from '../../types';

interface ResultsTabProps {
  refreshTick: number;
}

const POLL_INTERVAL_MS = 30_000;

const ROUND_LABEL: Record<string, string> = {
  R1: 'Round 1',
  RR: 'Round Robin',
  BLP: 'BLP',
  QF: 'Quarters',
  SF: 'Semis',
  F: 'Final',
  '3P': '3rd Place',
  ConRR: 'Consolation',
  ConF: 'Consolation Final',
};

const PHASE_ORDER: Record<string, number> = {
  F: 8, '3P': 7, ConF: 6, SF: 5, QF: 4, ConRR: 3, BLP: 2, RR: 1, R1: 1,
};

const FORMAT_LABEL: Record<string, string> = {
  set21: 'to 21',
  set30: 'to 30',
  best_of_3x15: 'Best of 3×15',
};

function nameFor(
  id: string | null,
  type: EntrantType | null,
  fallback: string,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string {
  if (!id) return fallback || 'TBD';
  if (type === 'team') return teamMap[id]?.display_name ?? fallback ?? 'TBD';
  return playerMap[id]?.display_name ?? fallback ?? 'TBD';
}

function scoreString(match: Match): string {
  const sets = match.score_sets ?? [];
  if (sets.length === 0) return '';
  return sets.map((s) => `${s.p1}–${s.p2}`).join('  ');
}

function matchSearchText(
  match: Match,
  eventMap: Record<string, Event>,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string {
  const ev = eventMap[match.event_id];
  const p1 = nameFor(match.p1_id, match.p1_type, match.p1_ref, playerMap, teamMap);
  const p2 = nameFor(match.p2_id, match.p2_type, match.p2_ref, playerMap, teamMap);
  const round = ROUND_LABEL[match.round] ?? match.round;
  const fmt = FORMAT_LABEL[match.match_format] ?? match.match_format;
  return [
    ev?.name ?? '',
    ev?.code ?? '',
    p1, p2, round, fmt,
    match.match_format,
  ].join(' ').toLowerCase();
}

export default function ResultsTab({ refreshTick }: ResultsTabProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const isInitial = useRef(true);

  const fetchAll = useCallback(async () => {
    const [matchesRes, playersRes, teamsRes, eventsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('*')
        .in('status', ['complete', 'walkover', 'retired']),
      supabase.from('players').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('events').select('*').order('code'),
    ]);
    if (matchesRes.error) throw matchesRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    setMatches((matchesRes.data ?? []) as Match[]);
    setPlayers((playersRes.data ?? []) as Player[]);
    setTeams((teamsRes.data ?? []) as Team[]);
    setEvents((eventsRes.data ?? []) as Event[]);
  }, []);

  const load = useCallback(async () => {
    if (isInitial.current) setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load results');
    } finally {
      setLoading(false);
      isInitial.current = false;
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  useEffect(() => {
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('public-results')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => {
        void load();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load]);

  const playerMap = useMemo(() => {
    const m: Record<string, Player> = {};
    for (const p of players) m[p.id] = p;
    return m;
  }, [players]);

  const teamMap = useMemo(() => {
    const m: Record<string, Team> = {};
    for (const t of teams) m[t.id] = t;
    return m;
  }, [teams]);

  const eventMap = useMemo(() => {
    const m: Record<string, Event> = {};
    for (const e of events) m[e.id] = e;
    return m;
  }, [events]);

  const sortedMatches = useMemo(() => {
    return [...matches].sort((a, b) => {
      const phaseA = PHASE_ORDER[a.round] ?? 0;
      const phaseB = PHASE_ORDER[b.round] ?? 0;
      if (phaseB !== phaseA) return phaseB - phaseA;
      const evA = eventMap[a.event_id]?.code ?? '';
      const evB = eventMap[b.event_id]?.code ?? '';
      if (evA !== evB) return evA.localeCompare(evB);
      return (a.bracket_slot ?? '').localeCompare(b.bracket_slot ?? '', undefined, { numeric: true });
    });
  }, [matches, eventMap]);

  const filteredMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedMatches;
    return sortedMatches.filter((m) =>
      matchSearchText(m, eventMap, playerMap, teamMap).includes(q),
    );
  }, [sortedMatches, query, eventMap, playerMap, teamMap]);

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton rows={1} height="2.5rem" />
        <LoadingSkeleton rows={4} height="4rem" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {/* Search box */}
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate pointer-events-none"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by player, event or round…"
          className="w-full rounded-full bg-navy-light/60 border border-navy-light pl-9 pr-10 py-2.5 font-body text-sm text-white placeholder:text-slate/50 focus:outline-none focus:border-gold/50 transition-colors"
          aria-label="Search completed matches"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-slate/20 text-slate hover:text-white transition-colors text-sm leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* Count */}
      <p className="font-body text-xs text-slate">
        {filteredMatches.length} result{filteredMatches.length !== 1 ? 's' : ''}
        {query.trim() ? ` for "${query.trim()}"` : ' (all completed matches)'}
      </p>

      {/* List */}
      {filteredMatches.length === 0 ? (
        <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-10 text-center">
          <p className="font-body text-slate-light text-sm">
            {query.trim() ? `No matches found for "${query.trim()}"` : 'No completed matches yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredMatches.map((m) => {
            const ev = eventMap[m.event_id];
            const p1 = nameFor(m.p1_id, m.p1_type, m.p1_ref, playerMap, teamMap);
            const p2 = nameFor(m.p2_id, m.p2_type, m.p2_ref, playerMap, teamMap);
            const winnerIsP1 = m.winner_id !== null && m.winner_id === m.p1_id;
            const winnerIsP2 = m.winner_id !== null && m.winner_id === m.p2_id;
            const score = scoreString(m);
            const roundLabel = ROUND_LABEL[m.round] ?? m.round;
            return (
              <li
                key={m.id}
                className="rounded-lg bg-navy-light/60 border border-white/[0.07] px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-body text-[10px] uppercase tracking-wider text-slate truncate">
                    {ev ? `${ev.code} · ${ev.name}` : ''} · {roundLabel}
                  </span>
                  {m.status === 'walkover' && (
                    <span className="shrink-0 text-[9px] font-body font-semibold text-amber-warning uppercase tracking-wider">
                      Walkover
                    </span>
                  )}
                  {m.status === 'retired' && (
                    <span className="shrink-0 text-[9px] font-body font-semibold text-amber-warning uppercase tracking-wider">
                      Retired
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className={`font-body text-sm leading-tight truncate ${winnerIsP1 ? 'text-white font-semibold' : 'text-slate'}`}>
                      {p1}
                      {m.handicap_applied && <span className="text-amber-warning ml-1 text-[10px]">★</span>}
                    </p>
                    <p className={`font-body text-sm leading-tight truncate ${winnerIsP2 ? 'text-white font-semibold' : 'text-slate'}`}>
                      {p2}
                      {m.handicap_applied && <span className="text-amber-warning ml-1 text-[10px]">★</span>}
                    </p>
                  </div>
                  {score && (
                    <div className="shrink-0 text-right">
                      <span className="font-body text-sm tabular-nums text-gold-bright font-semibold">
                        {score}
                      </span>
                    </div>
                  )}
                  {!score && m.winner_id && (
                    <span className="shrink-0 font-body text-xs text-slate">
                      {winnerIsP1 ? p1 : p2} wins
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
