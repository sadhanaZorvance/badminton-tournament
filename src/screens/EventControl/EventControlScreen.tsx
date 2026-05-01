import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminHeader from '../../components/AdminHeader';
import CourtBadge from '../../components/CourtBadge';
import ErrorBanner from '../../components/ErrorBanner';
import EventPicker from '../../components/EventPicker';
import FormatChip from '../../components/FormatChip';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import StatusBadge from '../../components/StatusBadge';
import { withDemoQuery } from '../../lib/demo';
import { supabase } from '../../lib/supabase';
import type {
  AuditLogEntry,
  EntrantType,
  Event,
  Match,
  MatchRound,
  MatchSet,
  Player,
  Team,
} from '../../types';
import BLPTriggerPanel from './BLPTriggerPanel';
import ConsolationPoolTriggerPanel from './ConsolationPoolTriggerPanel';
import E8DrawForm from './E8DrawForm';
import E8DrawPanel from './E8DrawPanel';

interface EventControlScreenProps {
  basePath: string;
  loginPath: string;
}

const ROUND_ORDER: MatchRound[] = ['R1', 'RR', 'QF', 'SF', 'F', '3P', 'BLP', 'ConRR', 'ConF'];

const ROUND_LABEL: Record<MatchRound, string> = {
  R1: 'Round 1',
  RR: 'Round Robin',
  QF: 'Quarter Finals',
  SF: 'Semi Finals',
  F: 'Final',
  '3P': '3rd Place',
  BLP: 'Best Loser Playoff',
  ConRR: 'Consolation Pool',
  ConF: 'Consolation Final',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function entrantName(
  id: string | null,
  type: EntrantType | null,
  fallback: string,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string {
  if (!id || !type) return fallback || 'TBD';
  if (type === 'team') return teamMap[id]?.display_name ?? fallback ?? 'TBD';
  return playerMap[id]?.display_name ?? fallback ?? 'TBD';
}

function scoreSummary(match: Match): string {
  if (match.status === 'walkover') return 'Walkover';
  if (match.status === 'retired') return 'Retired';
  const sets = match.score_sets ?? [];
  if (sets.length === 0) return '';
  return sets.map((s) => `${s.p1}–${s.p2}`).join(', ');
}

export default function EventControlScreen({
  basePath,
  loginPath,
}: EventControlScreenProps) {
  const navigate = useNavigate();

  const [events, setEvents] = useState<Event[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [drawFormOpen, setDrawFormOpen] = useState(false);

  const [openMatchId, setOpenMatchId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [eventsRes, matchesRes, playersRes, teamsRes] = await Promise.all([
        supabase.from('events').select('*').order('code'),
        supabase.from('matches').select('*'),
        supabase.from('players').select('*'),
        supabase.from('teams').select('*'),
      ]);
      if (eventsRes.error) throw eventsRes.error;
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;
      if (teamsRes.error) throw teamsRes.error;

      const evList = (eventsRes.data ?? []) as Event[];
      setEvents(evList);
      setMatches((matchesRes.data ?? []) as Match[]);
      setPlayers((playersRes.data ?? []) as Player[]);
      setTeams((teamsRes.data ?? []) as Team[]);

      setSelectedEventId((current) => {
        if (current && evList.some((e) => e.id === current)) return current;
        const firstActive = evList.find((e) => e.status === 'active');
        return firstActive?.id ?? evList[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
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

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const eventMatches = useMemo(
    () =>
      selectedEventId
        ? matches.filter((m) => m.event_id === selectedEventId)
        : [],
    [matches, selectedEventId],
  );

  const openMatch = useMemo(
    () => (openMatchId ? matches.find((m) => m.id === openMatchId) ?? null : null),
    [openMatchId, matches],
  );

  // Gate: read event.depends_on, find any blockers that are not complete or
  // published. Used to surface "Waiting for E1" / "Ready ✓" status (TA-04 etc.).
  const gateStatus = useMemo<{
    ready: boolean;
    waitingFor: string[];
  } | null>(() => {
    if (!selectedEvent) return null;
    const deps = selectedEvent.depends_on ?? [];
    if (deps.length === 0) return { ready: true, waitingFor: [] };
    const waiting: string[] = [];
    for (const depId of deps) {
      const dep = eventMap[depId];
      if (!dep) continue;
      if (dep.status !== 'complete' && dep.status !== 'published') {
        waiting.push(dep.code);
      }
    }
    return { ready: waiting.length === 0, waitingFor: waiting.sort() };
  }, [selectedEvent, eventMap]);

  return (
    <div className="min-h-screen bg-navy text-white flex flex-col">
      <AdminHeader
        basePath={basePath}
        loginPath={loginPath}
        onRefresh={() => void load(true)}
        refreshing={refreshing}
      />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 space-y-6">
        <h1 className="font-display text-2xl text-gold-bright">Event Control</h1>

        {error && <ErrorBanner message={error} onRetry={() => void load()} />}

        {loading ? (
          <LoadingSkeleton rows={3} height="3rem" />
        ) : (
          <>
            <EventPicker
              events={events}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
            />

            {selectedEvent ? (
              <section className="space-y-5">
                <header className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="font-display text-xl text-white">
                      {selectedEvent.name}
                    </h2>
                    <StatusBadge status={selectedEvent.status} />
                  </div>
                  <p className="font-body text-xs uppercase tracking-[0.2em] text-slate">
                    {selectedEvent.code} · {selectedEvent.format_type}
                  </p>
                  {gateStatus && <GateStatus status={gateStatus} />}
                </header>

                {selectedEvent.code === 'E1' && (
                  <div className="space-y-4">
                    <BLPTriggerPanel eventId={selectedEvent.id} />
                    <ConsolationPoolTriggerPanel eventId={selectedEvent.id} />
                  </div>
                )}
                {selectedEvent.code === 'E8' && (
                  <E8DrawPanel
                    eventId={selectedEvent.id}
                    drawLocked={selectedEvent.draw_locked}
                    onOpenForm={() => setDrawFormOpen(true)}
                  />
                )}

                <MatchList
                  matches={eventMatches}
                  formatType={selectedEvent.format_type}
                  playerMap={playerMap}
                  teamMap={teamMap}
                  onSelect={(id) => setOpenMatchId(id)}
                />
              </section>
            ) : (
              <p className="font-body text-sm text-slate-light">
                No events to display.
              </p>
            )}
          </>
        )}
      </main>

      {selectedEvent?.code === 'E8' && (
        <E8DrawForm
          eventId={selectedEvent.id}
          open={drawFormOpen}
          onClose={() => setDrawFormOpen(false)}
          onLocked={() => void load(true)}
        />
      )}

      {openMatch && (
        <MatchDetailPanel
          match={openMatch}
          event={eventMap[openMatch.event_id] ?? null}
          playerMap={playerMap}
          teamMap={teamMap}
          onClose={() => setOpenMatchId(null)}
          onEdit={() => {
            setOpenMatchId(null);
            navigate(withDemoQuery(`${basePath}/score/${openMatch.id}`));
          }}
        />
      )}
    </div>
  );
}

function GateStatus({ status }: { status: { ready: boolean; waitingFor: string[] } }) {
  if (status.ready) {
    return (
      <p className="font-body text-sm text-emerald-300">
        <span aria-hidden="true">✓</span> Gate: Ready
      </p>
    );
  }
  return (
    <p className="font-body text-sm text-amber-warning">
      Waiting for {status.waitingFor.join(', ')} to complete
    </p>
  );
}

interface MatchListProps {
  matches: Match[];
  formatType: Event['format_type'];
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onSelect: (matchId: string) => void;
}

function MatchList({ matches, formatType, playerMap, teamMap, onSelect }: MatchListProps) {
  if (matches.length === 0) {
    return (
      <section className="rounded-lg border border-navy-light bg-navy-light/30 p-4">
        <p className="font-body text-sm text-slate-light">
          No matches yet for this event.
        </p>
      </section>
    );
  }

  if (formatType === 'rr') {
    const sorted = [...matches].sort((a, b) =>
      a.bracket_slot.localeCompare(b.bracket_slot, undefined, { numeric: true }),
    );
    return (
      <section className="space-y-2">
        <h3 className="font-body text-xs uppercase tracking-[0.2em] text-slate">
          Matches
        </h3>
        <ul className="space-y-2">
          {sorted.map((m) => (
            <MatchRow
              key={m.id}
              match={m}
              playerMap={playerMap}
              teamMap={teamMap}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </section>
    );
  }

  // knockout / hybrid: group by round in canonical order.
  const grouped: Partial<Record<MatchRound, Match[]>> = {};
  for (const m of matches) {
    const list = grouped[m.round] ?? [];
    list.push(m);
    grouped[m.round] = list;
  }
  for (const r of Object.keys(grouped) as MatchRound[]) {
    grouped[r]!.sort((a, b) =>
      a.bracket_slot.localeCompare(b.bracket_slot, undefined, { numeric: true }),
    );
  }

  return (
    <div className="space-y-5">
      {ROUND_ORDER.map((round) => {
        const list = grouped[round];
        if (!list || list.length === 0) return null;
        return (
          <section key={round} className="space-y-2">
            <h3 className="font-body text-xs uppercase tracking-[0.2em] text-slate">
              {ROUND_LABEL[round]}
            </h3>
            <ul className="space-y-2">
              {list.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  playerMap={playerMap}
                  teamMap={teamMap}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

interface MatchRowProps {
  match: Match;
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onSelect: (matchId: string) => void;
}

function MatchRow({ match, playerMap, teamMap, onSelect }: MatchRowProps) {
  const p1Name = entrantName(match.p1_id, match.p1_type, match.p1_ref, playerMap, teamMap);
  const p2Name = entrantName(match.p2_id, match.p2_type, match.p2_ref, playerMap, teamMap);
  const score = scoreSummary(match);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(match.id)}
        className="w-full text-left rounded-lg border border-navy-light bg-navy-light/40 hover:bg-navy-light hover:border-gold/40 transition-colors px-3 py-3 min-h-[64px]"
      >
        <div className="flex items-center gap-3">
          <MatchStatusIcon match={match} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="font-body text-[11px] uppercase tracking-wider text-slate">
                {match.bracket_slot}
              </span>
              {match.court && <CourtBadge court={match.court} />}
              {match.handicap_applied && (
                <span className="text-amber-warning text-xs" title="Handicap match" aria-label="Handicap">
                  ★
                </span>
              )}
              {match.inconsistent && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-body font-semibold bg-amber-warning/20 text-amber-warning"
                  title="Flagged as inconsistent"
                >
                  ⚠ Inconsistent
                </span>
              )}
            </div>
            <p className="font-body text-sm text-white truncate">
              {p1Name} <span className="text-slate">vs</span> {p2Name}
            </p>
          </div>
          {score && (
            <span className="font-body text-sm text-gold-bright tabular-nums shrink-0">
              {score}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

function MatchStatusIcon({ match }: { match: Match }) {
  if (match.inconsistent) {
    return (
      <span
        className="w-6 h-6 rounded-full bg-amber-warning/20 text-amber-warning inline-flex items-center justify-center text-sm shrink-0"
        aria-label="Inconsistent"
      >
        ⚠
      </span>
    );
  }
  switch (match.status) {
    case 'in_progress':
      return (
        <span
          className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-300 inline-flex items-center justify-center shrink-0"
          aria-label="In progress"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </span>
      );
    case 'complete':
      return (
        <span
          className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-300 inline-flex items-center justify-center text-sm shrink-0"
          aria-label="Complete"
        >
          ✓
        </span>
      );
    case 'walkover':
    case 'retired':
      return (
        <span
          className="w-6 h-6 rounded-full bg-amber-warning/20 text-amber-warning inline-flex items-center justify-center text-xs shrink-0"
          aria-label={match.status}
        >
          {match.status === 'walkover' ? 'W' : 'R'}
        </span>
      );
    case 'ready':
      return (
        <span
          className="w-6 h-6 rounded-full bg-gold/20 text-gold-bright inline-flex items-center justify-center text-xs font-semibold shrink-0"
          aria-label="Ready"
        >
          •
        </span>
      );
    default:
      return (
        <span
          className="w-6 h-6 rounded-full bg-navy-dark text-slate inline-flex items-center justify-center shrink-0"
          aria-label="Pending"
        >
          <span className="w-2.5 h-2.5 rounded-full border border-slate" />
        </span>
      );
  }
}

interface MatchDetailPanelProps {
  match: Match;
  event: Event | null;
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onClose: () => void;
  onEdit: () => void;
}

function MatchDetailPanel({
  match,
  event,
  playerMap,
  teamMap,
  onClose,
  onEdit,
}: MatchDetailPanelProps) {
  const [sets, setSets] = useState<MatchSet[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [setsRes, auditRes] = await Promise.all([
        supabase
          .from('sets')
          .select('*')
          .eq('match_id', match.id)
          .order('set_number'),
        supabase
          .from('audit_log')
          .select('*')
          .eq('match_id', match.id)
          .order('timestamp', { ascending: true }),
      ]);
      if (setsRes.error) throw setsRes.error;
      if (auditRes.error) throw auditRes.error;
      setSets((setsRes.data ?? []) as MatchSet[]);
      setAuditLog((auditRes.data ?? []) as AuditLogEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load match detail');
    } finally {
      setLoading(false);
    }
  }, [match.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const p1Name = entrantName(match.p1_id, match.p1_type, match.p1_ref, playerMap, teamMap);
  const p2Name = entrantName(match.p2_id, match.p2_type, match.p2_ref, playerMap, teamMap);

  const canEdit =
    match.status === 'complete' &&
    event !== null &&
    event.status !== 'published';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-detail-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-lg bg-navy-light border border-navy-light sm:rounded-xl rounded-t-xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-up-fade">
        <header className="px-5 pt-5 pb-3 border-b border-navy-dark/50 sticky top-0 bg-navy-light z-10">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 id="match-detail-title" className="font-display text-lg text-gold-bright">
              {match.bracket_slot} · {ROUND_LABEL[match.round]}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 -m-2 text-slate hover:text-gold-bright"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FormatChip format={match.match_format} />
            {match.court && <CourtBadge court={match.court} />}
            <StatusBadge status={match.status} />
            {match.inconsistent && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-body font-semibold bg-amber-warning/20 text-amber-warning">
                ⚠ Inconsistent
              </span>
            )}
          </div>
          <p className="font-body text-sm text-white mt-3">
            {p1Name} <span className="text-slate">vs</span> {p2Name}
          </p>
          <p className="font-body text-[11px] uppercase tracking-wider text-slate mt-1">
            {event?.name ?? ''}
            {match.started_by && <> · started by {match.started_by}</>}
            {match.completed_at && <> · finished {formatTime(match.completed_at)}</>}
          </p>
        </header>

        <div className="px-5 py-4 space-y-5">
          {error && <ErrorBanner message={error} onRetry={() => void load()} />}

          <section>
            <h3 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-2">
              Sets
            </h3>
            {loading ? (
              <LoadingSkeleton rows={1} height="2.5rem" />
            ) : sets.length === 0 ? (
              <p className="font-body text-sm text-slate-light">
                No sets recorded.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {sets.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md bg-navy-dark/40 border border-navy-dark px-3 py-2"
                  >
                    <span className="font-body text-xs text-slate uppercase tracking-wider">
                      Set {s.set_number} · to {s.target_score}
                    </span>
                    <span className="font-body text-sm text-white tabular-nums">
                      {s.p1_score}–{s.p2_score}
                      {!s.complete && (
                        <span className="ml-2 text-amber-warning text-[10px] uppercase">
                          incomplete
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-2">
              Audit Log
            </h3>
            {loading ? (
              <LoadingSkeleton rows={3} height="2rem" />
            ) : auditLog.length === 0 ? (
              <p className="font-body text-sm text-slate-light">No actions yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {auditLog.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex gap-3 text-sm font-body text-slate-light"
                  >
                    <span className="text-slate tabular-nums shrink-0">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className="text-white">
                      {auditLineText(entry)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
            >
              Close
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="px-4 py-2.5 rounded-md bg-gold text-navy-dark font-body font-semibold hover:bg-gold-bright transition-colors min-h-[44px]"
              >
                Edit Result
              </button>
            )}
            {match.status === 'complete' && event?.status === 'published' && (
              <p className="text-center sm:text-right text-xs font-body text-slate sm:self-center">
                Locked — unpublish the podium first.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function auditLineText(entry: AuditLogEntry): string {
  const actor = entry.actor_name || 'system';
  const p = entry.payload ?? {};
  switch (entry.action_type) {
    case 'match_started': {
      const court = (p as { court?: string }).court;
      return court
        ? `${actor} started match on ${court}`
        : `${actor} started match`;
    }
    case 'set_entered': {
      const setNum = (p as { set_number?: number }).set_number;
      const after = (p as { after?: { p1?: number; p2?: number } }).after;
      if (setNum && after) {
        return `${actor} entered Set ${setNum}: ${after.p1}–${after.p2}`;
      }
      return `${actor} entered a set`;
    }
    case 'set_edited': {
      const setNum = (p as { set_number?: number }).set_number;
      const before = (p as { before?: { p1?: number; p2?: number } }).before;
      const after = (p as { after?: { p1?: number; p2?: number } }).after;
      if (setNum && before && after) {
        return `${actor} edited Set ${setNum}: ${before.p1}–${before.p2} → ${after.p1}–${after.p2}`;
      }
      return `${actor} edited a set`;
    }
    case 'match_completed':
      return `${actor} marked match complete`;
    case 'match_walkover':
      return `${actor} recorded walkover`;
    case 'match_retired':
      return `${actor} recorded retirement`;
    case 'match_cascaded': {
      const choice = (p as { choice?: string }).choice;
      const setNum = (p as { set_number?: number }).set_number;
      const before = (p as { before?: { p1?: number; p2?: number } }).before;
      const after = (p as { after?: { p1?: number; p2?: number } }).after;
      const change =
        setNum && before && after
          ? ` Set ${setNum}: ${before.p1}–${before.p2} → ${after.p1}–${after.p2}`
          : '';
      const choiceLabel = choice ? ` (${choice})` : '';
      return `${actor} edited match${change}${choiceLabel}`;
    }
    case 'match_inconsistent_flagged':
      return `${actor} flagged downstream as inconsistent`;
    case 'trigger_blp':
      return `${actor} ran BLP computation`;
    case 'trigger_consolation_pools':
      return `${actor} generated consolation pools`;
    case 'trigger_e8_draw':
      return `${actor} locked the E8 draw`;
    case 'podium_drafted':
      return `Podium auto-drafted`;
    case 'podium_published':
      return `${actor} published podium`;
    case 'podium_unpublished':
      return `${actor} unpublished podium`;
    default:
      return `${actor} ${entry.action_type}`;
  }
}
