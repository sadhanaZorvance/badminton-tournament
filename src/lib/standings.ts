// Round Robin standings computation.
// Always client-side, recomputed on read — never stored (BR-025, BR-026, EC-012).
// Sort order: wins DESC → points_for DESC → head-to-head between tied entrants.

import type { Match, MatchSet, MatchStatus, Player } from '../types';

export interface StandingRow {
  entrantId: string;
  entrantName: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  position: number;
  tiebreakerReason: string | null;
  isTied: boolean;
  isCircularTie: boolean;
}

interface EntrantAggregate {
  matchesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

const COMPLETED_STATUSES: ReadonlyArray<MatchStatus> = ['complete', 'walkover', 'retired'];

function emptyAggregate(): EntrantAggregate {
  return { matchesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
}

function nameFor(id: string, playerMap: Record<string, Player>): string {
  return playerMap[id]?.display_name ?? 'Unknown';
}

// A group is "circular" when it cannot be resolved by head-to-head:
// every entrant has at least one win and one loss within the group.
// For 2-way ties this means the pair never played each other.
function isHeadToHeadCircular(
  groupIds: string[],
  h2h: Map<string, Map<string, 'W' | 'L'>>,
): boolean {
  if (groupIds.length < 2) return false;
  for (const id of groupIds) {
    const hasWinOver = groupIds.some((o) => o !== id && h2h.get(id)?.get(o) === 'W');
    const hasLossTo = groupIds.some((o) => o !== id && h2h.get(id)?.get(o) === 'L');
    if (!hasWinOver || !hasLossTo) return false;
  }
  return true;
}

export function computeStandings(
  matches: Match[],
  sets: MatchSet[],
  entrantIds: string[],
  playerMap: Record<string, Player>,
): StandingRow[] {
  const stats = new Map<string, EntrantAggregate>();
  for (const id of entrantIds) stats.set(id, emptyAggregate());

  const h2h = new Map<string, Map<string, 'W' | 'L'>>();
  for (const id of entrantIds) h2h.set(id, new Map());

  const setsByMatch = new Map<string, MatchSet[]>();
  for (const s of sets) {
    const arr = setsByMatch.get(s.match_id);
    if (arr) arr.push(s);
    else setsByMatch.set(s.match_id, [s]);
  }

  for (const m of matches) {
    if (!COMPLETED_STATUSES.includes(m.status)) continue;
    if (!m.p1_id || !m.p2_id || !m.winner_id) continue;
    if (!stats.has(m.p1_id) || !stats.has(m.p2_id)) continue;

    const p1Stats = stats.get(m.p1_id)!;
    const p2Stats = stats.get(m.p2_id)!;
    p1Stats.matchesPlayed += 1;
    p2Stats.matchesPlayed += 1;

    const winner = m.winner_id;
    const loser = winner === m.p1_id ? m.p2_id : m.p1_id;
    stats.get(winner)!.wins += 1;
    stats.get(loser)!.losses += 1;

    h2h.get(winner)!.set(loser, 'W');
    h2h.get(loser)!.set(winner, 'L');

    const matchSets = setsByMatch.get(m.id) ?? [];
    for (const s of matchSets) {
      p1Stats.pointsFor += s.p1_score;
      p1Stats.pointsAgainst += s.p2_score;
      p2Stats.pointsFor += s.p2_score;
      p2Stats.pointsAgainst += s.p1_score;
    }
  }

  const sorted = [...entrantIds].sort((a, b) => {
    const sa = stats.get(a)!;
    const sb = stats.get(b)!;
    if (sa.wins !== sb.wins) return sb.wins - sa.wins;
    if (sa.pointsFor !== sb.pointsFor) return sb.pointsFor - sa.pointsFor;
    const result = h2h.get(a)!.get(b);
    if (result === 'W') return -1;
    if (result === 'L') return 1;
    return 0;
  });

  const rows: StandingRow[] = [];
  let cursor = 0;
  let position = 1;

  while (cursor < sorted.length) {
    const head = stats.get(sorted[cursor])!;
    let next = cursor + 1;
    while (next < sorted.length && stats.get(sorted[next])!.wins === head.wins) {
      next += 1;
    }
    const groupIds = sorted.slice(cursor, next);
    const groupSize = groupIds.length;

    if (groupSize === 1) {
      const id = groupIds[0];
      const s = stats.get(id)!;
      rows.push({
        entrantId: id,
        entrantName: nameFor(id, playerMap),
        matchesPlayed: s.matchesPlayed,
        wins: s.wins,
        losses: s.losses,
        pointsFor: s.pointsFor,
        pointsAgainst: s.pointsAgainst,
        position,
        tiebreakerReason: null,
        isTied: false,
        isCircularTie: false,
      });
    } else {
      const allSamePF = groupIds.every(
        (id) => stats.get(id)!.pointsFor === head.pointsFor,
      );
      const circular = allSamePF && isHeadToHeadCircular(groupIds, h2h);

      for (let k = 0; k < groupSize; k += 1) {
        const id = groupIds[k];
        const s = stats.get(id)!;
        let reason: string;

        if (circular) {
          reason =
            groupSize === 2
              ? 'Tie unresolvable by standings rules'
              : `${groupSize}-way tie — unresolvable by standings rules`;
        } else if (k === 0) {
          const nextId = groupIds[1];
          const sNext = stats.get(nextId)!;
          if (s.pointsFor > sNext.pointsFor) {
            reason = `Ranked above due to: points for ${s.pointsFor} vs ${sNext.pointsFor}`;
          } else if (h2h.get(id)?.get(nextId) === 'W') {
            reason = `Ranked above due to: head-to-head win vs ${nameFor(nextId, playerMap)}`;
          } else {
            reason = `Tied on wins (${s.wins})`;
          }
        } else {
          const prevId = groupIds[k - 1];
          const sPrev = stats.get(prevId)!;
          if (sPrev.pointsFor > s.pointsFor) {
            reason = `Tied on wins (${s.wins}); points for ${s.pointsFor} vs ${sPrev.pointsFor}`;
          } else if (h2h.get(prevId)?.get(id) === 'W') {
            reason = `Tied on wins (${s.wins}); lost head-to-head vs ${nameFor(prevId, playerMap)}`;
          } else {
            reason = `Tied on wins (${s.wins})`;
          }
        }

        rows.push({
          entrantId: id,
          entrantName: nameFor(id, playerMap),
          matchesPlayed: s.matchesPlayed,
          wins: s.wins,
          losses: s.losses,
          pointsFor: s.pointsFor,
          pointsAgainst: s.pointsAgainst,
          position,
          tiebreakerReason: reason,
          isTied: true,
          isCircularTie: circular,
        });
      }
    }

    position += groupSize;
    cursor = next;
  }

  return rows;
}
