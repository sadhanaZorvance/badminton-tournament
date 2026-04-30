import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { computeStandings, type StandingRow } from '../../lib/standings';
import { supabase } from '../../lib/supabase';
import type { Event, Match, MatchSet, Player, Pool, PoolEntrant } from '../../types';

interface PoolStandings {
  pool: Pool;
  event: Event | null;
  rows: StandingRow[];
}

interface StandingsScreenProps {
  // Optional injected data lets Phase E and tests reuse this screen with
  // pre-fetched fixtures instead of hitting Supabase.
  initialData?: {
    pools: Pool[];
    poolEntrants: PoolEntrant[];
    matches: Match[];
    sets: MatchSet[];
    events: Event[];
    players: Player[];
  };
}

export default function StandingsScreen({ initialData }: StandingsScreenProps = {}) {
  const [pools, setPools] = useState<Pool[]>(initialData?.pools ?? []);
  const [poolEntrants, setPoolEntrants] = useState<PoolEntrant[]>(
    initialData?.poolEntrants ?? [],
  );
  const [matches, setMatches] = useState<Match[]>(initialData?.matches ?? []);
  const [sets, setSets] = useState<MatchSet[]>(initialData?.sets ?? []);
  const [events, setEvents] = useState<Event[]>(initialData?.events ?? []);
  const [players, setPlayers] = useState<Player[]>(initialData?.players ?? []);

  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [poolsRes, entrantsRes, matchesRes, setsRes, eventsRes, playersRes] =
      await Promise.all([
        supabase.from('pools').select('*'),
        supabase.from('pool_entrants').select('*'),
        supabase.from('matches').select('*').not('pool_id', 'is', null),
        supabase.from('sets').select('*'),
        supabase.from('events').select('*'),
        supabase.from('players').select('*'),
      ]);

    if (poolsRes.error) throw poolsRes.error;
    if (entrantsRes.error) throw entrantsRes.error;
    if (matchesRes.error) throw matchesRes.error;
    if (setsRes.error) throw setsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (playersRes.error) throw playersRes.error;

    setPools((poolsRes.data ?? []) as Pool[]);
    setPoolEntrants((entrantsRes.data ?? []) as PoolEntrant[]);
    setMatches((matchesRes.data ?? []) as Match[]);
    setSets((setsRes.data ?? []) as MatchSet[]);
    setEvents((eventsRes.data ?? []) as Event[]);
    setPlayers((playersRes.data ?? []) as Player[]);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load standings');
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    if (!initialData) void load();
  }, [initialData, load]);

  const playerMap = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of players) map[p.id] = p;
    return map;
  }, [players]);

  const eventById = useMemo(() => {
    const map = new Map<string, Event>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  const poolStandings: PoolStandings[] = useMemo(() => {
    return pools.map((pool) => {
      const entrantIds = poolEntrants
        .filter((pe) => pe.pool_id === pool.id && pe.entrant_type === 'player')
        .map((pe) => pe.entrant_id);
      const poolMatches = matches.filter((m) => m.pool_id === pool.id);
      const matchIds = new Set(poolMatches.map((m) => m.id));
      const poolSets = sets.filter((s) => matchIds.has(s.match_id));
      const rows = computeStandings(poolMatches, poolSets, entrantIds, playerMap);
      return { pool, event: eventById.get(pool.event_id) ?? null, rows };
    });
  }, [pools, poolEntrants, matches, sets, playerMap, eventById]);

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl text-gold-bright">Standings</h1>
        <LoadingSkeleton rows={3} height="6rem" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-gold-bright">Standings</h1>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {poolStandings.length === 0 ? (
        <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-10 text-center">
          <p className="font-body text-slate-light text-sm">
            Standings will appear as matches are played
          </p>
        </div>
      ) : (
        poolStandings.map(({ pool, event, rows }) => {
          const headingParts = [
            event ? event.name : `Pool ${pool.label}`,
            pool.label === 'Main' ? null : `Pool ${pool.label}`,
          ].filter(Boolean);
          const heading = headingParts.join(' · ');
          return (
            <section key={pool.id} aria-labelledby={`pool-${pool.id}-heading`}>
              <h2
                id={`pool-${pool.id}-heading`}
                className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3"
              >
                {heading}
              </h2>

              {rows.length === 0 ? (
                <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-6 text-center">
                  <p className="font-body text-slate-light text-sm">
                    No entrants yet
                  </p>
                </div>
              ) : (
                <div className="rounded-lg overflow-hidden border border-navy-light">
                  <table className="w-full text-left font-body text-sm">
                    <thead className="bg-navy-dark/60 text-slate uppercase text-[11px] tracking-wider">
                      <tr>
                        <th className="px-3 py-2 w-10">Pos</th>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-2 py-2 w-10 text-right">W</th>
                        <th className="px-2 py-2 w-10 text-right">L</th>
                        <th className="px-2 py-2 w-12 text-right">PF</th>
                        <th className="px-2 py-2 w-12 text-right">PA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const rowKey = `${pool.id}:${row.entrantId}`;
                        const isExpanded = expandedRow === rowKey;
                        const tiedRow = row.isTied;
                        const baseClass = row.isCircularTie
                          ? 'bg-amber-warning/10'
                          : tiedRow
                            ? 'bg-navy-light/40'
                            : 'bg-navy-light/20';
                        return (
                          <tr
                            key={rowKey}
                            className={`${baseClass} border-t border-navy-light ${
                              tiedRow ? 'cursor-pointer' : ''
                            }`}
                            onClick={() =>
                              tiedRow ? setExpandedRow(isExpanded ? null : rowKey) : null
                            }
                          >
                            <td className="px-3 py-2 align-top">
                              <span className="font-semibold text-white">
                                {row.position}
                              </span>
                              {tiedRow && (
                                <span
                                  aria-label="Tied position"
                                  className="ml-1 text-amber-warning"
                                >
                                  ↕
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-white">
                              <div>{row.entrantName}</div>
                              {tiedRow && isExpanded && row.tiebreakerReason && (
                                <div
                                  className={`mt-1 text-xs ${
                                    row.isCircularTie
                                      ? 'text-amber-warning'
                                      : 'text-slate-light'
                                  }`}
                                >
                                  ↳ {row.tiebreakerReason}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 align-top text-right tabular-nums">
                              {row.wins}
                            </td>
                            <td className="px-2 py-2 align-top text-right tabular-nums">
                              {row.losses}
                            </td>
                            <td className="px-2 py-2 align-top text-right tabular-nums">
                              {row.pointsFor}
                            </td>
                            <td className="px-2 py-2 align-top text-right tabular-nums">
                              {row.pointsAgainst}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {rows.some((r) => r.isCircularTie) && (
                    <p className="px-3 py-2 text-xs text-amber-warning bg-amber-warning/5 border-t border-amber-warning/30 font-body">
                      Three-way tie — Top Admin will resolve if pool progression is
                      affected.
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
