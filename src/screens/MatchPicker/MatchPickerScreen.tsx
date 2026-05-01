import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminHeader from '../../components/AdminHeader';
import ConfirmModal from '../../components/ConfirmModal';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import MatchCard from '../../components/MatchCard';
import Toast from '../../components/Toast';
import FormatChip from '../../components/FormatChip';
import { getSession } from '../../lib/auth';
import { isDemoMode, runSimulatedMatch, withDemoQuery } from '../../lib/demo';
import { supabase } from '../../lib/supabase';
import type {
  Event,
  Match,
  MatchRound,
  Player,
  Team,
} from '../../types';

interface MatchPickerScreenProps {
  basePath: string;
  loginPath: string;
}

type CourtFilter = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'All';
const COURT_FILTERS: CourtFilter[] = ['All', 'C1', 'C2', 'C3', 'C4', 'C5'];

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

interface DisplayName {
  id: string;
  name: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parseRpcErrorCode(message: string | undefined): string | null {
  if (!message) return null;
  const match = message.match(/^([A-Z_]+):/);
  return match ? match[1] : null;
}

export default function MatchPickerScreen({ basePath, loginPath }: MatchPickerScreenProps) {
  const navigate = useNavigate();
  const session = getSession();
  const adminName = session?.name ?? '';

  const [matches, setMatches] = useState<Match[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [selectedCourt, setSelectedCourt] = useState<CourtFilter>('All');

  const [pendingStart, setPendingStart] = useState<{
    match: Match;
    court: Exclude<CourtFilter, 'All'>;
    occupiedBy: Match | null;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const demo = isDemoMode();
  const [simulatingId, setSimulatingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [matchesRes, eventsRes, playersRes, teamsRes] = await Promise.all([
      supabase
        .from('matches')
        .select('*')
        .in('status', ['ready', 'in_progress']),
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

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        await fetchAll();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load matches';
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetchAll],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const eventById = useMemo(() => {
    const map = new Map<string, Event>();
    events.forEach((e) => map.set(e.id, e));
    return map;
  }, [events]);

  const playerById = useMemo(() => {
    const map = new Map<string, DisplayName>();
    players.forEach((p) => map.set(p.id, { id: p.id, name: p.display_name }));
    return map;
  }, [players]);

  const teamById = useMemo(() => {
    const map = new Map<string, DisplayName>();
    teams.forEach((t) => map.set(t.id, { id: t.id, name: t.display_name }));
    return map;
  }, [teams]);

  function nameFor(id: string | null, type: Match['p1_type'], fallback: string): string {
    if (!id) return fallback || 'TBD';
    if (type === 'team') return teamById.get(id)?.name ?? fallback ?? 'TBD';
    return playerById.get(id)?.name ?? fallback ?? 'TBD';
  }

  function eventLabel(match: Match): string {
    const ev = eventById.get(match.event_id);
    const code = ev?.code ?? '';
    const name = ev?.name ?? '';
    const round = match.round;
    return [code && name ? `${name} · ${round}` : `${code || round}`].join('');
  }

  const inProgressMatches = useMemo(
    () => matches.filter((m) => m.status === 'in_progress'),
    [matches],
  );

  const readyMatches = useMemo(() => {
    const list = matches.filter((m) => m.status === 'ready');
    return list.sort((a, b) => {
      const phase = (PHASE_ORDER[a.round] ?? 99) - (PHASE_ORDER[b.round] ?? 99);
      if (phase !== 0) return phase;
      const aEvent = eventById.get(a.event_id);
      const bEvent = eventById.get(b.event_id);
      const eventCmp = (aEvent?.code ?? '').localeCompare(bEvent?.code ?? '');
      if (eventCmp !== 0) return eventCmp;
      return (a.bracket_slot ?? '').localeCompare(b.bracket_slot ?? '', undefined, {
        numeric: true,
      });
    });
  }, [matches, eventById]);

  const filteredInProgress = useMemo(() => {
    if (selectedCourt === 'All') return inProgressMatches;
    return inProgressMatches.filter((m) => m.court === selectedCourt);
  }, [inProgressMatches, selectedCourt]);

  const courtOccupancy = useMemo(() => {
    const map = new Map<string, Match>();
    inProgressMatches.forEach((m) => {
      if (m.court) map.set(m.court, m);
    });
    return map;
  }, [inProgressMatches]);

  function handleResume(match: Match) {
    navigate(withDemoQuery(`${basePath}/score/${match.id}`));
  }

  function handleStartTap(match: Match) {
    if (selectedCourt === 'All') return;
    const court = selectedCourt;
    const occupiedBy = courtOccupancy.get(court) ?? null;
    if (occupiedBy && occupiedBy.id !== match.id) {
      setPendingStart({ match, court, occupiedBy });
      return;
    }
    void doStart(match, court);
  }

  async function doStart(match: Match, court: Exclude<CourtFilter, 'All'>) {
    setStarting(true);
    try {
      const { error: rpcError } = await supabase.rpc('start_match', {
        p_match_id: match.id,
        p_court: court,
        p_admin_name: adminName,
      });
      if (rpcError) {
        const code = parseRpcErrorCode(rpcError.message);
        if (code === 'MATCH_ALREADY_CLAIMED') {
          setToast('Match already started by another admin');
          await load('refresh');
          return;
        }
        setError(rpcError.message || 'Could not start match');
        return;
      }
      navigate(withDemoQuery(`${basePath}/score/${match.id}`));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start match';
      setError(message);
    } finally {
      setStarting(false);
      setPendingStart(null);
    }
  }

  function handleConfirmOccupiedStart() {
    if (!pendingStart) return;
    void doStart(pendingStart.match, pendingStart.court);
  }

  async function handleSimulate(match: Match) {
    if (simulatingId) return;
    const ev = eventById.get(match.event_id);
    if (!ev) {
      setError('Could not resolve event for simulated match');
      return;
    }
    setSimulatingId(match.id);
    setError(null);
    try {
      await runSimulatedMatch({ match, eventCode: ev.code, adminName });
      await load('refresh');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Simulation failed';
      setError(message);
    } finally {
      setSimulatingId(null);
    }
  }

  const occupiedMatchLabel = pendingStart?.occupiedBy
    ? `${eventLabel(pendingStart.occupiedBy)} (${nameFor(
        pendingStart.occupiedBy.p1_id,
        pendingStart.occupiedBy.p1_type,
        pendingStart.occupiedBy.p1_ref,
      )} vs ${nameFor(
        pendingStart.occupiedBy.p2_id,
        pendingStart.occupiedBy.p2_type,
        pendingStart.occupiedBy.p2_ref,
      )})`
    : '';

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader
        basePath={basePath}
        loginPath={loginPath}
        onRefresh={() => void load('refresh')}
        refreshing={refreshing}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6">
        <h1 className="font-display text-2xl text-gold-bright mb-4">Match Picker</h1>

        <div
          className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 mb-6 scrollbar-thin"
          role="tablist"
          aria-label="Court filter"
        >
          {COURT_FILTERS.map((court) => {
            const isSelected = selectedCourt === court;
            const hasActive = court !== 'All' && courtOccupancy.has(court);
            return (
              <button
                key={court}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedCourt(court)}
                className={`shrink-0 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border min-h-[44px] font-body text-sm transition-colors ${
                  isSelected
                    ? 'bg-gold text-navy-dark border-gold'
                    : 'bg-navy-light/50 text-slate-light border-navy-light hover:bg-navy-light'
                }`}
              >
                <span className="font-semibold tracking-wide">{court}</span>
                {hasActive && (
                  <span
                    aria-label="Active match on this court"
                    className="w-2 h-2 rounded-full bg-emerald-400"
                  />
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <ErrorBanner message={error} onRetry={() => void load('refresh')} />
        )}

        {loading ? (
          <LoadingSkeleton rows={3} height="5rem" />
        ) : (
          <>
            {filteredInProgress.length > 0 && (
              <section className="mb-8">
                <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
                  In Progress
                </h2>
                <div className="space-y-3">
                  {filteredInProgress.map((match) => (
                    <div key={match.id} className="space-y-2">
                      <MatchCard
                        match={match}
                        variant="live"
                        eventLabel={eventLabel(match)}
                        p1Name={nameFor(match.p1_id, match.p1_type, match.p1_ref)}
                        p2Name={nameFor(match.p2_id, match.p2_type, match.p2_ref)}
                        onClick={() => handleResume(match)}
                      />
                      {demo && (
                        <button
                          type="button"
                          onClick={() => void handleSimulate(match)}
                          disabled={simulatingId === match.id}
                          className="w-full h-10 rounded-md border border-amber-warning/60 bg-amber-warning/10 text-amber-warning font-body text-xs uppercase tracking-wider hover:bg-amber-warning/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {simulatingId === match.id ? 'Simulating…' : 'Simulate Match (demo)'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-6">
              <h2 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3">
                Ready to Start
              </h2>

              {readyMatches.length === 0 ? (
                <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-8 text-center">
                  <p className="font-body text-slate-light text-sm">
                    No matches ready — check back soon
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {readyMatches.map((match) => {
                    const p1 = nameFor(match.p1_id, match.p1_type, match.p1_ref);
                    const p2 = nameFor(match.p2_id, match.p2_type, match.p2_ref);
                    const startDisabled = selectedCourt === 'All' || starting;
                    const startLabel =
                      selectedCourt === 'All'
                        ? 'Pick a court first'
                        : `Start on ${selectedCourt}`;
                    return (
                      <div
                        key={match.id}
                        className="rounded-lg bg-navy-light/60 border border-navy-light px-4 py-3"
                      >
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <span className="text-xs font-body text-slate uppercase tracking-wider truncate">
                            {eventLabel(match)}
                          </span>
                          <div className="flex items-center gap-2">
                            {match.handicap_applied && (
                              <span
                                title="Handicap match"
                                className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-body font-semibold bg-amber-warning/20 text-amber-warning"
                              >
                                ★ Handicap
                              </span>
                            )}
                            <FormatChip format={match.match_format} />
                          </div>
                        </div>
                        <div className="font-body text-white text-base mb-3">
                          {p1}
                          {match.handicap_applied && (
                            <span className="text-amber-warning ml-1">★</span>
                          )}
                          <span className="text-slate mx-2">vs</span>
                          {p2}
                          {match.handicap_applied && (
                            <span className="text-amber-warning ml-1">★</span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={startDisabled}
                          onClick={() => handleStartTap(match)}
                          className="w-full h-11 rounded-md bg-gold text-navy-dark font-body font-semibold tracking-wide uppercase text-sm transition disabled:bg-navy-light disabled:text-slate disabled:cursor-not-allowed hover:bg-gold-bright"
                        >
                          {startLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        {lastUpdated && !loading && (
          <p className="text-slate text-xs font-body text-center mt-4">
            Last updated {formatTime(lastUpdated)}
          </p>
        )}
      </main>

      {pendingStart && (
        <ConfirmModal
          title={`Court ${pendingStart.court} occupied`}
          body={
            <>
              Court {pendingStart.court} has{' '}
              <span className="text-white">{occupiedMatchLabel}</span> in progress.
              Start the new match anyway?
            </>
          }
          confirmLabel={starting ? 'Starting…' : 'Start anyway'}
          cancelLabel="Cancel"
          onConfirm={handleConfirmOccupiedStart}
          onCancel={() => setPendingStart(null)}
          variant="destructive"
        />
      )}

      {toast && (
        <Toast message={toast} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}
