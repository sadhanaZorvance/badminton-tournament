import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner';
import LoadingSkeleton from '../../components/LoadingSkeleton';
import { resolvePoolGroups, type PoolGroup } from '../../lib/poolResolver';
import { computeStandings, type StandingRow } from '../../lib/standings';
import { supabase } from '../../lib/supabase';
import type { Event, Match, MatchSet, Player, Pool, PoolEntrant, Team } from '../../types';

interface GroupStandings {
  group: PoolGroup;
  rows: StandingRow[];
}

interface StandingsScreenProps {
  initialData?: {
    pools: Pool[];
    poolEntrants: PoolEntrant[];
    matches: Match[];
    sets: MatchSet[];
    events: Event[];
    players: Player[];
    teams: Team[];
  };
}

export default function StandingsScreen({ initialData }: StandingsScreenProps = {}) {
  const [pools, setPools] = useState<Pool[]>(initialData?.pools ?? []);
  const [poolEntrants, setPoolEntrants] = useState<PoolEntrant[]>(initialData?.poolEntrants ?? []);
  const [matches, setMatches] = useState<Match[]>(initialData?.matches ?? []);
  const [sets, setSets] = useState<MatchSet[]>(initialData?.sets ?? []);
  const [events, setEvents] = useState<Event[]>(initialData?.events ?? []);
  const [players, setPlayers] = useState<Player[]>(initialData?.players ?? []);
  const [teams, setTeams] = useState<Team[]>(initialData?.teams ?? []);

  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [poolsRes, entrantsRes, matchesRes, setsRes, eventsRes, playersRes, teamsRes] =
      await Promise.all([
        supabase.from('pools').select('*'),
        supabase.from('pool_entrants').select('*'),
        supabase.from('matches').select('*'),
        supabase.from('sets').select('*'),
        supabase.from('events').select('*'),
        supabase.from('players').select('*'),
        supabase.from('teams').select('*'),
      ]);

    if (poolsRes.error) throw poolsRes.error;
    if (entrantsRes.error) throw entrantsRes.error;
    if (matchesRes.error) throw matchesRes.error;
    if (setsRes.error) throw setsRes.error;
    if (eventsRes.error) throw eventsRes.error;
    if (playersRes.error) throw playersRes.error;
    if (teamsRes.error) throw teamsRes.error;

    setPools((poolsRes.data ?? []) as Pool[]);
    setPoolEntrants((entrantsRes.data ?? []) as PoolEntrant[]);
    setMatches((matchesRes.data ?? []) as Match[]);
    setSets((setsRes.data ?? []) as MatchSet[]);
    setEvents((eventsRes.data ?? []) as Event[]);
    setPlayers((playersRes.data ?? []) as Player[]);
    setTeams((teamsRes.data ?? []) as Team[]);
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
    if (!initialData) {
      void load();
      const interval = setInterval(() => void fetchAll(), 30000);
      return () => clearInterval(interval);
    }
  }, [initialData, load, fetchAll]);

  const entrantMap = useMemo(() => {
    const map: Record<string, { display_name: string }> = {};
    for (const p of players) map[p.id] = p;
    for (const t of teams) map[t.id] = t;
    return map;
  }, [players, teams]);

  const groupStandings: GroupStandings[] = useMemo(() => {
    const activeEvents = events.filter(
      (e) => e.status === 'active' || e.status === 'complete' || e.status === 'published',
    );

    const result: GroupStandings[] = [];

    for (const event of activeEvents) {
      const eventMatches = matches.filter((m) => m.event_id === event.id);
      const eventPools = pools.filter((p) => p.event_id === event.id);
      const eventPoolIds = new Set(eventPools.map((p) => p.id));
      const eventEntrants = poolEntrants.filter((pe) => eventPoolIds.has(pe.pool_id));

      const groups = resolvePoolGroups({
        event,
        matches: eventMatches,
        pools: eventPools,
        poolEntrants: eventEntrants,
      });

      for (const group of groups) {
        const matchIds = new Set(group.matches.map((m) => m.id));
        const groupSets = sets.filter((s) => matchIds.has(s.match_id));
        const rows = computeStandings(group.matches, groupSets, group.entrantIds, entrantMap);
        result.push({ group, rows });
      }
    }

    return result;
  }, [events, matches, pools, poolEntrants, sets, entrantMap]);

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

      {groupStandings.length === 0 ? (
        <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-10 text-center">
          <p className="font-body text-slate-light text-sm">
            Standings will appear as matches are played
          </p>
        </div>
      ) : (
        groupStandings.map(({ group, rows }) => (
          <section key={group.key} aria-labelledby={`group-${group.key}-heading`}>
            <h2
              id={`group-${group.key}-heading`}
              className="font-body text-xs uppercase tracking-[0.2em] text-slate mb-3"
            >
              {group.label}
            </h2>

            {rows.length === 0 ? (
              <div className="rounded-lg bg-navy-light/40 border border-navy-light px-4 py-6 text-center">
                <p className="font-body text-slate-light text-sm">No entrants yet</p>
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
                      const rowKey = `${group.key}:${row.entrantId}`;
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
                            <span className="font-semibold text-white">{row.position}</span>
                            {tiedRow && (
                              <span aria-label="Tied position" className="ml-1 text-amber-warning">
                                ↕
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-white">
                            <div>{row.entrantName}</div>
                            {tiedRow && isExpanded && row.tiebreakerReason && (
                              <div
                                className={`mt-1 text-xs ${
                                  row.isCircularTie ? 'text-amber-warning' : 'text-slate-light'
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
                    Three-way tie — Top Admin will resolve if pool progression is affected.
                  </p>
                )}
              </div>
            )}
          </section>
        ))
      )}
    </div>
  );
}
