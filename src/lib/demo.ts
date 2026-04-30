// Demo mode is opt-in via `?demo=true` (or `?demo`) on any admin URL.
// Exposes Simulate Match buttons and Reset Tournament so the full 93-match
// flow can be exercised in minutes. Never enable in production paths.

import { supabase } from './supabase';
import { getDownstreamSlots } from './bracketWiring';
import type { Match, MatchFormat } from '../types';

export function isDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('demo');
}

// Preserves the `?demo=true` flag when navigating between admin screens via
// URL strings. The router doesn't carry query params automatically.
export function withDemoQuery(path: string): string {
  if (!isDemoMode()) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}demo=true`;
}

// Returns the target score for a match format (set21=21, set30=30, best_of_3x15=15).
export function targetForFormat(format: MatchFormat): number {
  switch (format) {
    case 'set21':
      return 21;
    case 'set30':
      return 30;
    case 'best_of_3x15':
      return 15;
  }
}

export interface SimulatedSet {
  set_number: 1 | 2 | 3;
  p1_score: number;
  p2_score: number;
}

export interface SimulationResult {
  sets: SimulatedSet[];
  winnerSide: 'p1' | 'p2';
}

// Generates a single valid set: one player reaches `target`, the other lands
// in [0, target-1]. Caller chooses which side wins.
function simulateSet(target: number, winnerSide: 'p1' | 'p2', setNumber: 1 | 2 | 3): SimulatedSet {
  const loserScore = Math.floor(Math.random() * target); // 0..target-1
  return {
    set_number: setNumber,
    p1_score: winnerSide === 'p1' ? target : loserScore,
    p2_score: winnerSide === 'p2' ? target : loserScore,
  };
}

// Generates a complete simulated match result for the given format.
// - set21 / set30: one set, random winner.
// - best_of_3x15: 2 or 3 sets — match winner takes 2, with a 50/50 split on
//   whether the loser steals one set (forcing a 3-set match).
export function simulateMatch(format: MatchFormat): SimulationResult {
  const target = targetForFormat(format);
  const winnerSide: 'p1' | 'p2' = Math.random() < 0.5 ? 'p1' : 'p2';
  const loserSide: 'p1' | 'p2' = winnerSide === 'p1' ? 'p2' : 'p1';

  if (format !== 'best_of_3x15') {
    return {
      sets: [simulateSet(target, winnerSide, 1)],
      winnerSide,
    };
  }

  // 50/50: straight 2-0 vs split 2-1.
  const goesToThree = Math.random() < 0.5;
  if (!goesToThree) {
    return {
      sets: [
        simulateSet(target, winnerSide, 1),
        simulateSet(target, winnerSide, 2),
      ],
      winnerSide,
    };
  }

  // 50/50 on which set the loser steals (1 or 2).
  const loserStealsSet1 = Math.random() < 0.5;
  return {
    sets: [
      simulateSet(target, loserStealsSet1 ? loserSide : winnerSide, 1),
      simulateSet(target, loserStealsSet1 ? winnerSide : loserSide, 2),
      simulateSet(target, winnerSide, 3),
    ],
    winnerSide,
  };
}

// Runs a full simulated match against the live RPCs:
//   - submits each generated set via submit_set
//   - resolves downstream wiring from src/lib/bracketWiring.ts
//   - calls complete_match with the chosen winner and downstream payloads
//
// Match must already be in_progress (caller is responsible for starting it).
// Caller must supply the event code to look up wiring rules.
export async function runSimulatedMatch(args: {
  match: Match;
  eventCode: string;
  adminName: string;
}): Promise<void> {
  const { match, eventCode, adminName } = args;

  if (match.status !== 'in_progress') {
    throw new Error(`SIMULATE_INVALID_STATE: match is ${match.status}, expected in_progress`);
  }
  if (!match.p1_id || !match.p2_id || !match.p1_type || !match.p2_type) {
    throw new Error('SIMULATE_INVALID_OPPONENTS: both opponents must be resolved');
  }

  const result = simulateMatch(match.match_format);

  for (const s of result.sets) {
    const { error: setError } = await supabase.rpc('submit_set', {
      p_match_id: match.id,
      p_set_number: s.set_number,
      p_p1_score: s.p1_score,
      p_p2_score: s.p2_score,
      p_admin_name: adminName,
    });
    if (setError) throw setError;
  }

  // Fetch sibling matches in this event so we can resolve target match ids
  // from bracket_slot wiring rules.
  const { data: eventMatchRows, error: emError } = await supabase
    .from('matches')
    .select('id, bracket_slot')
    .eq('event_id', match.event_id);
  if (emError) throw emError;
  const eventMatches = (eventMatchRows ?? []) as { id: string; bracket_slot: string }[];

  function buildDownstream(side: 'winner' | 'loser') {
    const rules = getDownstreamSlots(eventCode, match.bracket_slot, side);
    const updates: { match_id: string; slot: 'p1' | 'p2' }[] = [];
    for (const rule of rules) {
      // Pool slots (slot1/slot2/slot3) are filled by the consolation-pool RPC.
      if (rule.targetSlot !== 'p1' && rule.targetSlot !== 'p2') continue;
      const target = eventMatches.find((em) => em.bracket_slot === rule.target);
      if (!target) continue;
      updates.push({ match_id: target.id, slot: rule.targetSlot });
    }
    return updates;
  }

  const winnerId = result.winnerSide === 'p1' ? match.p1_id : match.p2_id;
  const winnerType = result.winnerSide === 'p1' ? match.p1_type : match.p2_type;

  const { error: completeError } = await supabase.rpc('complete_match', {
    p_match_id: match.id,
    p_winner_id: winnerId,
    p_winner_type: winnerType,
    p_admin_name: adminName,
    p_downstream_updates: buildDownstream('winner'),
    p_loser_downstream_updates: buildDownstream('loser'),
  });
  if (completeError) throw completeError;
}

