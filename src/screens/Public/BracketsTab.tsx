import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import EventPicker from '../../components/EventPicker';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { computeStandings, type StandingRow } from '../../lib/standings';
import { supabase } from '../../lib/supabase';
import type {
  EntrantType,
  Event,
  Match,
  MatchRound,
  MatchSet,
  Player,
  Pool,
  PoolEntrant,
  Team,
} from '../../types';

interface BracketsTabProps {
  refreshTick: number;
}

const POLL_INTERVAL_MS = 30_000;

const ROUND_COLUMN_ORDER: MatchRound[] = ['R1', 'BLP', 'QF', 'SF', 'F', '3P'];

const ROUND_COLUMN_LABEL: Record<MatchRound, string> = {
  R1: 'Round 1',
  RR: 'Round Robin',
  BLP: 'BLP',
  QF: 'Quarters',
  SF: 'Semis',
  F: 'Final',
  '3P': '3rd Place',
  ConRR: 'Consolation',
  ConF: 'Con. Final',
};

const ROUND_FORMAT_HINT: Partial<Record<MatchRound, string>> = {
  R1: 'to 21',
  BLP: 'to 21',
  RR: 'to 21',
  QF: 'to 30',
  SF: 'to 30',
  F: '3×15',
  '3P': 'to 30',
  ConRR: 'to 21',
  ConF: 'to 30',
};

function getEventFormatRules(event: Event): string {
  if (event.format_type === 'rr') return 'Round Robin · first to 21';
  if (event.format_type === 'hybrid')
    return 'RR · to 21 · QF/SF/3P · to 30 · Final · best of 3×15';
  // knockout (E1 has BLP + Consolation)
  return event.code === 'E1'
    ? 'R1 & BLP · to 21 · QF/SF/3P · to 30 · Final · best of 3×15 · +Consolation'
    : 'R1 · to 21 · QF/SF/3P · to 30 · Final · best of 3×15';
}

function EventInfoBar({ event }: { event: Event }) {
  const formatBadge =
    event.format_type === 'rr'
      ? 'Round Robin'
      : event.format_type === 'hybrid'
        ? 'Hybrid'
        : 'Knockout';

  return (
    <div className="rounded-lg bg-navy-light/40 border border-white/[0.06] px-3 py-2.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm text-white leading-tight">{event.name}</h2>
        <span className="shrink-0 inline-block px-2 py-0.5 rounded-full bg-gold/10 border border-gold/30 text-[10px] font-body text-gold tracking-wide">
          {formatBadge}
        </span>
      </div>
      <p className="font-body text-[10px] text-slate leading-relaxed">
        {getEventFormatRules(event)}
      </p>
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function entrantName(
  id: string | null,
  type: EntrantType | null,
  fallback: string,
  playerMap: Record<string, Player>,
  teamMap: Record<string, Team>,
): string {
  if (!id) return 'TBD';
  if (type === 'team') return teamMap[id]?.display_name ?? fallback ?? 'TBD';
  return playerMap[id]?.display_name ?? fallback ?? 'TBD';
}

function compareSlot(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

// Reconstruct MatchSet rows from each match's score_sets jsonb snapshot.
// Standings only consume p1_score/p2_score and match_id — the other fields
// are filled with safe defaults so the typed shape is satisfied.
function synthSetsFromMatches(matches: Match[]): MatchSet[] {
  const out: MatchSet[] = [];
  for (const m of matches) {
    const sets = m.score_sets ?? [];
    for (let i = 0; i < sets.length; i += 1) {
      const s = sets[i];
      out.push({
        id: `${m.id}:${i}`,
        match_id: m.id,
        set_number: (i + 1) as 1 | 2 | 3,
        p1_score: s.p1,
        p2_score: s.p2,
        target_score: 21,
        complete: s.complete,
        created_at: '',
        updated_at: '',
      });
    }
  }
  return out;
}

export default function BracketsTab({ refreshTick }: BracketsTabProps) {
  const [events, setEvents] = useState<Event[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolEntrants, setPoolEntrants] = useState<PoolEntrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const isInitial = useRef(true);

  const fetchAll = useCallback(async () => {
    const [eventsRes, matchesRes, playersRes, teamsRes, poolsRes, entrantsRes] =
      await Promise.all([
        supabase.from('events').select('*').order('code'),
        supabase.from('matches').select('*'),
        supabase.from('players').select('*'),
        supabase.from('teams').select('*'),
        supabase.from('pools').select('*'),
        supabase.from('pool_entrants').select('*'),
      ]);
    if (eventsRes.error) throw eventsRes.error;
    if (matchesRes.error) throw matchesRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;
    if (poolsRes.error) throw poolsRes.error;
    if (entrantsRes.error) throw entrantsRes.error;
    setEvents((eventsRes.data ?? []) as Event[]);
    setMatches((matchesRes.data ?? []) as Match[]);
    setPlayers((playersRes.data ?? []) as Player[]);
    setTeams((teamsRes.data ?? []) as Team[]);
    setPools((poolsRes.data ?? []) as Pool[]);
    setPoolEntrants((entrantsRes.data ?? []) as PoolEntrant[]);
    setLastUpdated(new Date());
  }, []);

  const load = useCallback(async () => {
    if (isInitial.current) setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load brackets');
    } finally {
      setLoading(false);
      isInitial.current = false;
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load, refreshTick]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel('public-brackets')
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

  // Default-select first active event once events load (sticky after that).
  useEffect(() => {
    if (events.length === 0) return;
    setSelectedEventId((current) => {
      if (current && events.some((e) => e.id === current)) return current;
      const firstActive = events.find((e) => e.status === 'active');
      return firstActive?.id ?? events[0].id;
    });
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

  if (loading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton rows={1} height="2.5rem" />
        <LoadingSkeleton rows={3} height="6rem" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <EventPicker
        events={events}
        selectedEventId={selectedEventId}
        onSelect={setSelectedEventId}
      />

      {selectedEvent ? (
        <EventBracket
          event={selectedEvent}
          matches={eventMatches}
          pools={pools}
          poolEntrants={poolEntrants}
          playerMap={playerMap}
          teamMap={teamMap}
          onMatchClick={setOpenMatchId}
        />
      ) : (
        <p className="font-body text-sm text-slate-light">No events to display.</p>
      )}

      {lastUpdated && (
        <p className="text-slate text-xs font-body text-center mt-4">
          Last updated {formatTime(lastUpdated)}
        </p>
      )}

      {openMatch && (
        <MatchScoreModal
          match={openMatch}
          event={events.find((e) => e.id === openMatch.event_id) ?? null}
          p1Name={entrantName(
            openMatch.p1_id,
            openMatch.p1_type,
            openMatch.p1_ref,
            playerMap,
            teamMap,
          )}
          p2Name={entrantName(
            openMatch.p2_id,
            openMatch.p2_type,
            openMatch.p2_ref,
            playerMap,
            teamMap,
          )}
          winnerName={
            openMatch.winner_id
              ? entrantName(
                  openMatch.winner_id,
                  openMatch.winner_type,
                  '',
                  playerMap,
                  teamMap,
                )
              : null
          }
          onClose={() => setOpenMatchId(null)}
        />
      )}
    </div>
  );
}

interface EventBracketProps {
  event: Event;
  matches: Match[];
  pools: Pool[];
  poolEntrants: PoolEntrant[];
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onMatchClick: (matchId: string) => void;
}

function EventBracket({
  event,
  matches,
  pools,
  poolEntrants,
  playerMap,
  teamMap,
  onMatchClick,
}: EventBracketProps) {
  // E8 special: draw not yet posted (only hide when there are genuinely no matches)
  if (event.code === 'E8' && !event.draw_locked && matches.length === 0) {
    return (
      <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-12 text-center">
        <p className="font-body text-white text-base mb-1">
          Draw will be posted at 14:15
        </p>
        <p className="font-body text-slate text-sm">Check back soon</p>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-12 text-center">
        <p className="font-body text-slate text-sm">No matches yet for this event.</p>
      </div>
    );
  }

  const knockoutMatches = matches.filter(
    (m) => m.round !== 'ConRR' && m.round !== 'ConF',
  );
  const consolationMatches = matches.filter(
    (m) => m.round === 'ConRR' || m.round === 'ConF',
  );

  const eventPools = pools.filter((p) => p.event_id === event.id);

  if (event.format_type === 'rr') {
    return (
      <div className="space-y-4">
        <EventInfoBar event={event} />
        <RoundRobinView
          event={event}
          matches={matches}
          pools={eventPools}
          poolEntrants={poolEntrants}
          playerMap={playerMap}
          teamMap={teamMap}
          onMatchClick={onMatchClick}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EventInfoBar event={event} />
      <BracketTree
        matches={knockoutMatches}
        playerMap={playerMap}
        teamMap={teamMap}
        onMatchClick={onMatchClick}
      />
      {consolationMatches.length > 0 && (
        <ConsolationSection
          matches={consolationMatches}
          pools={eventPools}
          poolEntrants={poolEntrants}
          playerMap={playerMap}
          teamMap={teamMap}
          onMatchClick={onMatchClick}
        />
      )}
    </div>
  );
}

interface BracketTreeProps {
  matches: Match[];
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onMatchClick: (matchId: string) => void;
}

function BracketTree({ matches, playerMap, teamMap, onMatchClick }: BracketTreeProps) {
  const columns = useMemo(() => {
    return ROUND_COLUMN_ORDER.map((round) => {
      const list = matches
        .filter((m) => m.round === round)
        .sort((a, b) => compareSlot(a.bracket_slot, b.bracket_slot));
      return { round, label: ROUND_COLUMN_LABEL[round], matches: list };
    }).filter((c) => c.matches.length > 0);
  }, [matches]);

  if (columns.length === 0) {
    return (
      <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-10 text-center">
        <p className="font-body text-slate text-sm">No bracket matches yet.</p>
      </div>
    );
  }

  return (
    <div className="-mx-4 px-4 overflow-x-auto touch-pan-x" role="region" aria-label="Bracket">
      <div className="flex gap-2 pb-2 min-w-max">
        {columns.map((col) => (
          <div key={col.round} className="w-[156px] shrink-0 space-y-1.5">
            <div className="px-1">
              <h3 className="font-body text-[10px] uppercase tracking-[0.18em] text-slate leading-none">
                {col.label}
              </h3>
              {ROUND_FORMAT_HINT[col.round] && (
                <span className="font-body text-[9px] text-slate/50 leading-none">
                  {ROUND_FORMAT_HINT[col.round]}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {col.matches.map((m) => (
                <BracketCell
                  key={m.id}
                  match={m}
                  playerMap={playerMap}
                  teamMap={teamMap}
                  onClick={() => onMatchClick(m.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface BracketCellProps {
  match: Match;
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onClick: () => void;
}

function BracketCell({ match, playerMap, teamMap, onClick }: BracketCellProps) {
  const p1Name = entrantName(match.p1_id, match.p1_type, match.p1_ref, playerMap, teamMap);
  const p2Name = entrantName(match.p2_id, match.p2_type, match.p2_ref, playerMap, teamMap);
  const isLive = match.status === 'in_progress';
  const isCompleted =
    match.status === 'complete' ||
    match.status === 'walkover' ||
    match.status === 'retired';
  const isPending = match.status === 'pending' || match.status === 'ready';

  const winnerIsP1 = isCompleted && match.winner_id !== null && match.winner_id === match.p1_id;
  const winnerIsP2 = isCompleted && match.winner_id !== null && match.winner_id === match.p2_id;

  const sets = match.score_sets ?? [];
  const p1Scores = sets.map((s) => s.p1);
  const p2Scores = sets.map((s) => s.p2);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-md py-1.5 transition-colors hover:border-gold/60 min-h-[44px] relative ${
        isLive
          ? 'bg-navy-light border border-gold/40 pl-3 pr-2 shadow-glass-live'
          : 'bg-navy-light/70 border border-white/[0.07] px-2.5 shadow-glass'
      }`}
    >
      {isLive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-1 bg-gold-bright rounded-l-md"
        />
      )}
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="font-body text-[9px] uppercase tracking-wider text-slate/70 leading-none">
          {match.bracket_slot}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-0.5 text-[8px] font-body font-semibold text-gold-bright uppercase tracking-wider leading-none">
            <span className="w-1 h-1 rounded-full bg-gold-bright animate-pulse" />
            Live
          </span>
        )}
        {match.status === 'walkover' && (
          <span className="text-[8px] font-body text-amber-warning uppercase tracking-wider leading-none">WO</span>
        )}
        {match.status === 'retired' && (
          <span className="text-[8px] font-body text-amber-warning uppercase tracking-wider leading-none">Ret</span>
        )}
      </div>
      <PlayerRow
        name={p1Name}
        scores={p1Scores}
        isWinner={winnerIsP1}
        isLoser={isCompleted && !winnerIsP1}
        isPending={isPending}
        handicap={false}
      />
      <PlayerRow
        name={p2Name}
        scores={p2Scores}
        isWinner={winnerIsP2}
        isLoser={isCompleted && !winnerIsP2}
        isPending={isPending}
        handicap={false}
      />
    </button>
  );
}

interface PlayerRowProps {
  name: string;
  scores: number[];
  isWinner: boolean;
  isLoser: boolean;
  isPending: boolean;
  handicap: boolean;
}

function PlayerRow({ name, scores, isWinner, isLoser, isPending, handicap }: PlayerRowProps) {
  const nameClass = isWinner
    ? 'text-white font-semibold'
    : isLoser
      ? 'text-slate'
      : isPending
        ? 'text-slate-light'
        : 'text-white';
  const scoreClass = isWinner
    ? 'text-gold-bright font-semibold'
    : isLoser
      ? 'text-slate'
      : 'text-white';
  return (
    <div className="flex items-center justify-between gap-1.5">
      <span className={`font-body text-xs leading-tight truncate ${nameClass}`}>
        {name}
        {handicap && (
          <span
            className="text-amber-warning ml-0.5 text-[9px]"
            title="Handicap match"
            aria-label="Handicap"
          >
            ★
          </span>
        )}
      </span>
      {scores.length > 0 && (
        <span className={`font-body text-xs leading-tight tabular-nums shrink-0 ${scoreClass}`}>
          {scores.join(' ')}
        </span>
      )}
    </div>
  );
}

interface RoundRobinViewProps {
  event: Event;
  matches: Match[];
  pools: Pool[];
  poolEntrants: PoolEntrant[];
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onMatchClick: (matchId: string) => void;
}

function RoundRobinView({
  event,
  matches,
  pools,
  poolEntrants,
  playerMap,
  teamMap,
  onMatchClick,
}: RoundRobinViewProps) {
  const isTeamEvent = ['E2', 'E5', 'E8'].includes(event.code);

  if (pools.length === 0) {
    // No pool created yet (seeded dev data — lock_e8_draw creates the pool at runtime).
    // Derive entrants and standings directly from match participants.
    const entrantIds = [
      ...new Set(
        matches.flatMap((m) => [m.p1_id, m.p2_id]).filter((id): id is string => id !== null),
      ),
    ];
    const lookup: Record<string, Player> = { ...playerMap };
    if (isTeamEvent) {
      for (const id of entrantIds) {
        const team = teamMap[id];
        if (team) {
          lookup[id] = {
            id: team.id,
            code: '',
            full_name: team.display_name,
            first_name: team.display_name,
            middle_name: null,
            last_name: null,
            display_name: team.display_name,
            age_group: 'U15',
            gender: 'F',
            status: 'active',
            created_at: team.created_at,
          };
        }
      }
    }
    const setRows = synthSetsFromMatches(matches);
    const rows = computeStandings(matches, setRows, entrantIds, lookup);
    const sortedMatches = [...matches].sort((a, b) => compareSlot(a.bracket_slot, b.bracket_slot));
    return (
      <div className="space-y-3">
        <h3 className="font-body text-[11px] uppercase tracking-[0.2em] text-slate">
          {event.name}
        </h3>
        <RRStandingsTable rows={rows} entrantHeading={isTeamEvent ? 'Team' : 'Player'} />
        {sortedMatches.length > 0 && (
          <ul className="space-y-2">
            {sortedMatches.map((m) => (
              <li key={m.id}>
                <BracketCell
                  match={m}
                  playerMap={playerMap}
                  teamMap={teamMap}
                  onClick={() => onMatchClick(m.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {pools.map((pool) => {
        const entrantIds = poolEntrants
          .filter(
            (pe) =>
              pe.pool_id === pool.id &&
              (isTeamEvent ? pe.entrant_type === 'team' : pe.entrant_type === 'player'),
          )
          .map((pe) => pe.entrant_id);
        const poolMatches = matches.filter((m) => m.pool_id === pool.id);
        // score_sets jsonb is the denormalised snapshot maintained atomically
        // with the sets table — adequate for PF/PA aggregation here without an
        // extra round-trip to the sets table.
        const setRows = synthSetsFromMatches(poolMatches);
        // Build a name lookup that handles teams as well as players.
        const lookup: Record<string, Player> = { ...playerMap };
        if (isTeamEvent) {
          for (const id of entrantIds) {
            const team = teamMap[id];
            if (team) {
              // shape-compatible synthetic Player with the team's display name
              lookup[id] = {
                id: team.id,
                code: '',
                full_name: team.display_name,
                first_name: team.display_name,
                middle_name: null,
                last_name: null,
                display_name: team.display_name,
                age_group: 'U15',
                gender: 'F',
                status: 'active',
                created_at: team.created_at,
              };
            }
          }
        }
        const rows = computeStandings(poolMatches, setRows, entrantIds, lookup);
        const sortedMatches = [...poolMatches].sort((a, b) =>
          compareSlot(a.bracket_slot, b.bracket_slot),
        );
        const heading = pool.label === 'Main' ? event.name : `${event.name} · Pool ${pool.label}`;
        return (
          <section key={pool.id} className="space-y-3">
            <h3 className="font-body text-[11px] uppercase tracking-[0.2em] text-slate">
              {heading}
            </h3>
            <RRStandingsTable rows={rows} entrantHeading={isTeamEvent ? 'Team' : 'Player'} />
            {sortedMatches.length > 0 && (
              <ul className="space-y-2">
                {sortedMatches.map((m) => (
                  <li key={m.id}>
                    <BracketCell
                      match={m}
                      playerMap={playerMap}
                      teamMap={teamMap}
                      onClick={() => onMatchClick(m.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

interface RRStandingsTableProps {
  rows: StandingRow[];
  entrantHeading: string;
}

function RRStandingsTable({ rows, entrantHeading }: RRStandingsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-6 text-center">
        <p className="font-body text-slate-light text-sm">No entrants yet</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg overflow-hidden border border-navy-light">
      <table className="w-full text-left font-body text-sm">
        <thead className="bg-navy-dark/60 text-slate uppercase text-[11px] tracking-wider">
          <tr>
            <th className="px-3 py-2 w-10">Pos</th>
            <th className="px-3 py-2">{entrantHeading}</th>
            <th className="px-2 py-2 w-10 text-right">MP</th>
            <th className="px-2 py-2 w-10 text-right">W</th>
            <th className="px-2 py-2 w-10 text-right">L</th>
            <th className="px-2 py-2 w-12 text-right">PF</th>
            <th className="px-2 py-2 w-12 text-right">PA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.entrantId}
              className={`${
                row.isCircularTie
                  ? 'bg-amber-warning/10'
                  : row.isTied
                    ? 'bg-navy-light/40'
                    : 'bg-navy-light/20'
              } border-t border-navy-light`}
            >
              <td className="px-3 py-2 align-top">
                <span className="font-semibold text-white">{row.position}</span>
                {row.isTied && (
                  <span aria-label="Tied position" className="ml-1 text-amber-warning">
                    ↕
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-white truncate">{row.entrantName}</td>
              <td className="px-2 py-2 align-top text-right tabular-nums">{row.matchesPlayed}</td>
              <td className="px-2 py-2 align-top text-right tabular-nums">{row.wins}</td>
              <td className="px-2 py-2 align-top text-right tabular-nums">{row.losses}</td>
              <td className="px-2 py-2 align-top text-right tabular-nums">{row.pointsFor}</td>
              <td className="px-2 py-2 align-top text-right tabular-nums">{row.pointsAgainst}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ConsolationSectionProps {
  matches: Match[];
  pools: Pool[];
  poolEntrants: PoolEntrant[];
  playerMap: Record<string, Player>;
  teamMap: Record<string, Team>;
  onMatchClick: (matchId: string) => void;
}

function ConsolationSection({
  matches,
  pools,
  poolEntrants,
  playerMap,
  teamMap,
  onMatchClick,
}: ConsolationSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const conRRMatches = matches.filter((m) => m.round === 'ConRR');
  const conFMatches = matches.filter((m) => m.round === 'ConF');
  const totalMatches = conRRMatches.length + conFMatches.length;

  const eventConsolationPoolIds = new Set(
    conRRMatches.map((m) => m.pool_id).filter((id): id is string => !!id),
  );
  const consolationPools = pools.filter((p) => eventConsolationPoolIds.has(p.id));

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 w-full"
        aria-expanded={expanded}
      >
        <span aria-hidden="true" className="h-px flex-1 bg-navy-light" />
        <span className="flex items-center gap-1.5 shrink-0">
          <h2 className="font-display text-sm text-gold-bright tracking-wide">Consolation</h2>
          <span className="font-body text-[10px] text-slate">
            · {totalMatches} match{totalMatches !== 1 ? 'es' : ''}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`w-3.5 h-3.5 text-slate transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <span aria-hidden="true" className="h-px flex-1 bg-navy-light" />
      </button>

      {!expanded && (
        <p className="font-body text-[10px] text-slate/60 text-center -mt-1">
          Tap above to view consolation bracket
        </p>
      )}

      {expanded && (
        <div className="space-y-4">
          {consolationPools.length > 0 ? (
            consolationPools
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((pool) => {
                const entrantIds = poolEntrants
                  .filter((pe) => pe.pool_id === pool.id && pe.entrant_type === 'player')
                  .map((pe) => pe.entrant_id);
                const poolMatches = conRRMatches.filter((m) => m.pool_id === pool.id);
                const setRows = synthSetsFromMatches(poolMatches);
                const rows = computeStandings(poolMatches, setRows, entrantIds, playerMap);
                const heading =
                  pool.label === 'Main' ? 'Pool' : `Pool ${pool.label}`;
                return (
                  <div key={pool.id} className="space-y-2">
                    <h3 className="font-body text-[10px] uppercase tracking-[0.2em] text-slate">
                      {heading}
                    </h3>
                    <RRStandingsTable rows={rows} entrantHeading="Player" />
                  </div>
                );
              })
          ) : conRRMatches.length > 0 ? (
            // Pool not yet generated (e.g. R1 losers haven't cascaded into ConRR.main)
            <div className="space-y-1.5">
              {conRRMatches
                .sort((a, b) => compareSlot(a.bracket_slot, b.bracket_slot))
                .map((m) => (
                  <BracketCell
                    key={m.id}
                    match={m}
                    playerMap={playerMap}
                    teamMap={teamMap}
                    onClick={() => onMatchClick(m.id)}
                  />
                ))}
            </div>
          ) : null}

          {conFMatches.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="font-body text-[10px] uppercase tracking-[0.2em] text-slate">
                Consolation Final
              </h3>
              {conFMatches.map((m) => (
                <BracketCell
                  key={m.id}
                  match={m}
                  playerMap={playerMap}
                  teamMap={teamMap}
                  onClick={() => onMatchClick(m.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

interface MatchScoreModalProps {
  match: Match;
  event: Event | null;
  p1Name: string;
  p2Name: string;
  winnerName: string | null;
  onClose: () => void;
}

function MatchScoreModal({
  match,
  event,
  p1Name,
  p2Name,
  winnerName,
  onClose,
}: MatchScoreModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const sets = match.score_sets ?? [];
  const isLive = match.status === 'in_progress';
  const isComplete =
    match.status === 'complete' ||
    match.status === 'walkover' ||
    match.status === 'retired';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-score-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-navy-dark/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full sm:max-w-md bg-navy-light border border-navy-light sm:rounded-xl rounded-t-xl shadow-2xl max-h-[90vh] overflow-y-auto animate-slide-up-fade">
        <header className="px-5 pt-5 pb-3 border-b border-navy-dark/50">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2
              id="match-score-title"
              className="font-display text-lg text-gold-bright"
            >
              {match.bracket_slot} · {ROUND_COLUMN_LABEL[match.round]}
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
          {event && (
            <p className="font-body text-[11px] uppercase tracking-wider text-slate">
              {event.name}
            </p>
          )}
        </header>

        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-body text-base text-white truncate">
              {p1Name}
            </span>
            <span className="font-body text-slate text-sm">vs</span>
            <span className="font-body text-base text-white truncate text-right">
              {p2Name}
            </span>
          </div>

          {sets.length > 0 ? (
            <ul className="space-y-1.5">
              {sets.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-md bg-navy-dark/40 border border-navy-dark px-3 py-2"
                >
                  <span className="font-body text-xs text-slate uppercase tracking-wider">
                    Set {i + 1}
                  </span>
                  <span className="font-body text-base text-white tabular-nums">
                    {s.p1} – {s.p2}
                    {!s.complete && (
                      <span className="ml-2 text-amber-warning text-[10px] uppercase">
                        live
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-body text-sm text-slate-light text-center py-4">
              No sets yet.
            </p>
          )}

          {match.status === 'walkover' && (
            <p className="text-sm font-body text-amber-warning text-center">
              Walkover{winnerName ? ` — ${winnerName} advances` : ''}
            </p>
          )}
          {match.status === 'retired' && (
            <p className="text-sm font-body text-amber-warning text-center">
              Retired{winnerName ? ` — ${winnerName} advances` : ''}
            </p>
          )}
          {match.status === 'complete' && winnerName && (
            <p className="text-sm font-body text-gold-bright text-center font-semibold">
              {winnerName} wins
            </p>
          )}
          {isLive && (
            <p className="text-sm font-body text-gold-bright text-center">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-bright animate-pulse" />
                In play on {match.court ?? 'court'}
              </span>
            </p>
          )}

          {!isLive && !isComplete && match.status === 'ready' && (
            <p className="text-sm font-body text-slate-light text-center">
              Ready to start
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-md bg-navy-dark text-white font-body font-medium hover:bg-navy transition-colors min-h-[44px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
