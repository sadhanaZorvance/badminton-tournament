#!/usr/bin/env node
// ============================================================================
// Leo Rising Stars — Match Skeleton Seeder
//
// Seeds the structural skeleton of pre-determined matches for the 8 events:
//   - All knockout events (E1..E5, E7): R1, QF (E1), SF, F, 3P shells
//   - E6 (3-player RR): 3 matches between players P1/P2/P3 of the pool
//
// Matches are seeded with placeholder refs (e.g. "Winner:R1.1") and
// status='pending'. Once the physical draw is finalised, a separate step
// (or `node scripts/seed-matches.js --draw <draw.json>`) resolves R1
// p1_id/p2_id and flips R1 matches to 'ready'.
//
// Match formats use the matrix from BACKEND_DESIGN.md:
//   RR / R1                  → set21
//   QF / SF / 3P (any age)   → set30
//   Finals (any age)         → best_of_3x15
//   Consolation final        → set30 (created at runtime by RPC)
//   BLP                      → set21 (created at runtime by RPC)
//
// Usage:
//   node --env-file=.env.local scripts/seed-matches.js
//
// Idempotent: deletes seed-time matches for events being re-seeded first.
// (Safe before the tournament starts — never run during a live event.)
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Match skeleton builders per event shape ────────────────────────────────

// E1 — 14 R1 players (7 matches) → 7 winners + BLP winner = 8 QF
//   Pre-seed: 7 R1, 4 QF, 2 SF, 1 F, 1 3P. BLP/Con created at runtime.
function e1Matches() {
  const rows = [];
  // R1: 7 matches
  for (let i = 1; i <= 7; i++) {
    rows.push({
      round: 'R1', bracket_slot: `R1.${i}`,
      p1_ref: `R1.${i}.A`, p2_ref: `R1.${i}.B`,
      match_format: 'set21', status: 'pending',
    });
  }
  // QF: 4 matches — 7 R1 winners + 1 BLP winner. Slot QF4-p2 = BLP winner.
  for (let i = 1; i <= 4; i++) {
    const p1 = `Winner:R1.${(i - 1) * 2 + 1}`;
    const p2 = i === 4 ? 'Winner:BLP' : `Winner:R1.${(i - 1) * 2 + 2}`;
    rows.push({
      round: 'QF', bracket_slot: `QF${i}`,
      p1_ref: p1, p2_ref: p2,
      match_format: 'set30', status: 'pending',
    });
  }
  // SF: 2
  rows.push(
    { round: 'SF', bracket_slot: 'SF1', p1_ref: 'Winner:QF1', p2_ref: 'Winner:QF2', match_format: 'set30', status: 'pending' },
    { round: 'SF', bracket_slot: 'SF2', p1_ref: 'Winner:QF3', p2_ref: 'Winner:QF4', match_format: 'set30', status: 'pending' },
  );
  // F + 3P
  rows.push(
    { round: 'F',  bracket_slot: 'F',  p1_ref: 'Winner:SF1', p2_ref: 'Winner:SF2', match_format: 'best_of_3x15', status: 'pending' },
    { round: '3P', bracket_slot: '3P', p1_ref: 'Loser:SF1',  p2_ref: 'Loser:SF2',  match_format: 'set30',        status: 'pending' },
  );
  return rows;
}

// E2 / E5 — 6 R1 players (3 matches) + T1 bye to SF1.
//   Pre-seed: 3 R1, 2 SF, 1 F, 1 3P. Consolation handled by bracket wiring
//   (3 R1 losers → ConRR.main pool of 3 + 1 ConF).
function eByeBracketMatches() {
  return [
    { round: 'R1', bracket_slot: 'R1.1', p1_ref: 'R1.1.A', p2_ref: 'R1.1.B', match_format: 'set21', status: 'pending' },
    { round: 'R1', bracket_slot: 'R1.2', p1_ref: 'R1.2.A', p2_ref: 'R1.2.B', match_format: 'set21', status: 'pending' },
    { round: 'R1', bracket_slot: 'R1.3', p1_ref: 'R1.3.A', p2_ref: 'R1.3.B', match_format: 'set21', status: 'pending' },
    { round: 'SF', bracket_slot: 'SF1', p1_ref: 'T1',          p2_ref: 'Winner:R1.1', match_format: 'set30', status: 'pending' },
    { round: 'SF', bracket_slot: 'SF2', p1_ref: 'Winner:R1.2', p2_ref: 'Winner:R1.3', match_format: 'set30', status: 'pending' },
    { round: 'F',  bracket_slot: 'F',   p1_ref: 'Winner:SF1',  p2_ref: 'Winner:SF2',  match_format: 'best_of_3x15', status: 'pending' },
    { round: '3P', bracket_slot: '3P',  p1_ref: 'Loser:SF1',   p2_ref: 'Loser:SF2',   match_format: 'set30', status: 'pending' },
    // Consolation: 3-player pool of R1 losers + ConF
    { round: 'ConRR', bracket_slot: 'ConRR.main.1', p1_ref: 'Con.1', p2_ref: 'Con.2', match_format: 'set21', status: 'pending' },
    { round: 'ConRR', bracket_slot: 'ConRR.main.2', p1_ref: 'Con.1', p2_ref: 'Con.3', match_format: 'set21', status: 'pending' },
    { round: 'ConRR', bracket_slot: 'ConRR.main.3', p1_ref: 'Con.2', p2_ref: 'Con.3', match_format: 'set21', status: 'pending' },
    { round: 'ConF',  bracket_slot: 'ConF',         p1_ref: 'PoolTop1', p2_ref: 'PoolTop2', match_format: 'set30', status: 'pending' },
  ];
}

// E3 / E4 / E7 — Same shape as the bye bracket but T1 occupies SF1.p1 by bye.
// (Per PROMPTS.md hint: "3 R1 matches → 2 SF → F + 3P + consolation".)
function eThreeR1Matches() {
  return eByeBracketMatches();
}

// E6 — Pure RR with 3 players, no wiring.
function e6Matches() {
  return [
    { round: 'ConRR', bracket_slot: 'RR.1', p1_ref: 'P1', p2_ref: 'P2', match_format: 'set21', status: 'pending' },
    { round: 'ConRR', bracket_slot: 'RR.2', p1_ref: 'P1', p2_ref: 'P3', match_format: 'set21', status: 'pending' },
    { round: 'ConRR', bracket_slot: 'RR.3', p1_ref: 'P2', p2_ref: 'P3', match_format: 'set21', status: 'pending' },
  ];
}

const eventBuilders = {
  E1: e1Matches,
  E2: eByeBracketMatches,
  E3: eThreeR1Matches,
  E4: eThreeR1Matches,
  E5: eByeBracketMatches,
  E6: e6Matches,
  E7: eThreeR1Matches,
  // E8 is generated at runtime by lock_e8_draw — no pre-seed.
};

async function main() {
  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, code')
    .in('code', Object.keys(eventBuilders));

  if (eventsErr) { console.error('FETCH events FAILED:', eventsErr); process.exit(1); }
  if (events.length < Object.keys(eventBuilders).length) {
    console.error(`ERROR: expected ${Object.keys(eventBuilders).length} events, found ${events.length}. Run seed-events.js first.`);
    process.exit(1);
  }

  const codeToId = Object.fromEntries(events.map(e => [e.code, e.id]));

  // Wipe previously-seeded matches for these events. Safe pre-event only.
  const eventIds = Object.values(codeToId);
  const { error: delErr } = await supabase.from('matches').delete().in('event_id', eventIds);
  if (delErr) { console.error('DELETE existing matches FAILED:', delErr); process.exit(1); }

  let total = 0;
  for (const [code, build] of Object.entries(eventBuilders)) {
    const eventId = codeToId[code];
    const rows = build().map(r => ({
      event_id:         eventId,
      round:            r.round,
      bracket_slot:     r.bracket_slot,
      p1_ref:           r.p1_ref,
      p2_ref:           r.p2_ref,
      p1_id:            null,
      p2_id:            null,
      p1_type:          null,
      p2_type:          null,
      score_sets:       [],
      match_format:     r.match_format,
      handicap_applied: code === 'E7',  // E7-wide flag; refined per-match once draw resolves P1/P2.
      status:           r.status,
      inconsistent:     false,
      edit_history:     [],
    }));

    const { data, error } = await supabase
      .from('matches')
      .insert(rows)
      .select('id');

    if (error) { console.error(`INSERT ${code} FAILED:`, error); process.exit(1); }
    console.log(`OK ${code}: seeded ${data.length} match shells`);
    total += data.length;
  }

  console.log(`OK total ${total} match shells seeded.`);
  console.log('');
  console.log('Next steps before the event:');
  console.log('  1. Populate scripts/players.csv and run seed-players.js');
  console.log('  2. Resolve R1 player slots from the physical draw sheet');
  console.log('     (set matches.p1_id / p2_id and matches.status="ready")');
  console.log('  3. E7: set matches.handicap_applied=true ONLY for R1/etc. matches');
  console.log('     where p1_id or p2_id is one of the two U13 girls coded P1/P2');
  console.log('  4. E8 has no pre-seeded matches — uses lock_e8_draw RPC');
}

main().catch(err => { console.error(err); process.exit(1); });
