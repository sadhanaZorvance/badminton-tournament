import type { Event, Match, Pool, PoolEntrant } from '../types';

export interface PoolGroup {
  key: string;
  label: string;
  poolId: string | null;
  eventId: string;
  entrantIds: string[];
  matches: Match[];
}

interface ResolveInput {
  event: Event;
  matches: Match[];
  pools: Pool[];
  poolEntrants: PoolEntrant[];
}

// Scenarios (verified manually in demo mode):
// 1. E6 (3-player RR) → 1 group, 3 entrants, 3 matches
// 2. E8 (5-team RR)   → 1 group, 5 entrants, 10 matches
// 3. E1 with pools    → 1 group per pool, entrants from pool_entrants
// 4. E1 before pools  → 0 groups
// 5. E4 with ConRR resolved → 1 synthetic group, 3 entrants
// 6. E4 before any R1 complete → 0 groups (p1_id/p2_id still null)
// 7. E3 with ConRR resolved → 1 synthetic group, 3 player entrants
export function resolvePoolGroups({ event, matches, pools, poolEntrants }: ResolveInput): PoolGroup[] {
  // Branch 1: Pure RR events (E6, E8)
  if (event.format_type === 'rr') {
    const rrMatches = matches.filter((m) => m.round === 'RR');
    if (rrMatches.length === 0) return [];

    const idSet = new Set<string>();
    for (const m of rrMatches) {
      if (m.p1_id) idSet.add(m.p1_id);
      if (m.p2_id) idSet.add(m.p2_id);
    }
    if (idSet.size === 0) return [];

    return [{ key: `${event.id}:rr`, label: event.name, poolId: null, eventId: event.id, entrantIds: [...idSet], matches: rrMatches }];
  }

  // Branch 2: Hybrid with real pools (E1 after generate_consolation_pools RPC)
  if (pools.length > 0) {
    const groups: PoolGroup[] = [];
    for (const pool of pools) {
      const poolMatches = matches.filter((m) => m.pool_id === pool.id);
      const entrantIds = poolEntrants.filter((pe) => pe.pool_id === pool.id).map((pe) => pe.entrant_id);
      if (entrantIds.length === 0 || poolMatches.length === 0) continue;
      groups.push({
        key: `${event.id}:${pool.id}`,
        label: pool.label === 'Main' ? event.name : `${event.name} · Pool ${pool.label}`,
        poolId: pool.id,
        eventId: event.id,
        entrantIds,
        matches: poolMatches,
      });
    }
    return groups;
  }

  // Branch 3: Hybrid with no real pools (E2/E3/E4/E5/E7 — synthetic consolation group)
  const conMatches = matches.filter((m) => m.round === 'ConRR');
  if (conMatches.length === 0) return [];

  const idSet = new Set<string>();
  for (const m of conMatches) {
    if (m.p1_id) idSet.add(m.p1_id);
    if (m.p2_id) idSet.add(m.p2_id);
  }
  if (idSet.size === 0) return [];

  return [{
    key: `${event.id}:consolation`,
    label: `${event.name} · Consolation`,
    poolId: null,
    eventId: event.id,
    entrantIds: [...idSet],
    matches: conMatches,
  }];
}
