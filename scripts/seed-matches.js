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

// E6 — Pure RR with 3 players, no wiring. All 3 combinations of P1/P2/P3.
// pool_id is filled in by ensureE6Pool() after events resolve.
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

  // Ensure the E6 Main pool exists before inserting E6 matches so we can
  // stamp pool_id on them in the same insert.
  const e6PoolId = await ensureE6Pool(codeToId.E6);

  let total = 0;
  for (const [code, build] of Object.entries(eventBuilders)) {
    const eventId = codeToId[code];
    const poolIdForEvent = code === 'E6' ? e6PoolId : null;
    const rows = build().map(r => ({
      event_id:         eventId,
      round:            r.round,
      bracket_slot:     r.bracket_slot,
      pool_id:          poolIdForEvent,
      p1_ref:           r.p1_ref,
      p2_ref:           r.p2_ref,
      p1_id:            null,
      p2_id:            null,
      p1_type:          null,
      p2_type:          null,
      score_sets:       [],
      match_format:     r.match_format,
      handicap_applied: false,  // Refined below for E7 matches involving players coded P1 or P2.
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

  // E7 handicap refinement: flag matches.handicap_applied=true ONLY for E7
  // matches where p1_id or p2_id resolves to one of the two U13 girls coded
  // P1 or P2. At initial seed (before draw is resolved) p1_id/p2_id are null
  // and this is a no-op; re-run after draw resolution to flag the right rows.
  await refineE7Handicap(codeToId.E7);

  // E6 RR readiness: once the 3 E6 players are seeded, populate p1_id/p2_id
  // and pool entrants, then flip the 3 RR matches to status='ready'.
  // No-op until players.csv contains the E6 player codes.
  await refineE6Readiness(codeToId.E6, e6PoolId);

  console.log('');
  console.log('Next steps before the event:');
  console.log('  1. Populate scripts/players.csv and run seed-players.js');
  console.log('  2. Resolve R1 player slots from the physical draw sheet');
  console.log('     (set matches.p1_id / p2_id and matches.status="ready")');
  console.log('  3. Re-run this script (or its refineE7Handicap step) so E7');
  console.log('     handicap_applied flips to true on matches involving P1/P2');
  console.log('  4. E8 has no pre-seeded matches — uses lock_e8_draw RPC');
}

// Idempotent: returns the existing E6 Main pool id, or creates it.
async function ensureE6Pool(e6EventId) {
  if (!e6EventId) {
    console.error('ERROR: E6 event id missing — run seed-events.js first.');
    process.exit(1);
  }

  const { data: existing, error: selErr } = await supabase
    .from('pools')
    .select('id')
    .eq('event_id', e6EventId)
    .eq('label', 'Main')
    .maybeSingle();
  if (selErr) { console.error('SELECT E6 pool FAILED:', selErr); process.exit(1); }

  if (existing?.id) {
    console.log(`OK E6 Main pool already exists: ${existing.id}`);
    return existing.id;
  }

  const { data, error } = await supabase
    .from('pools')
    .insert({ event_id: e6EventId, label: 'Main' })
    .select('id')
    .single();
  if (error) { console.error('INSERT E6 pool FAILED:', error); process.exit(1); }

  console.log(`OK E6 Main pool created: ${data.id}`);
  return data.id;
}

// Idempotent. Once 3 E6 players (codes E6P1, E6P2, E6P3) exist:
//   - upsert pool_entrants for the E6 Main pool
//   - resolve p1_id/p2_id on the 3 E6 matches
//   - flip status='ready'
// No-op until those player codes are seeded.
async function refineE6Readiness(e6EventId, e6PoolId) {
  if (!e6EventId || !e6PoolId) return;

  const { data: e6Players, error: pErr } = await supabase
    .from('players')
    .select('id, code')
    .in('code', ['E6P1', 'E6P2', 'E6P3']);
  if (pErr) { console.error('LOOKUP E6 players FAILED:', pErr); process.exit(1); }

  if (!e6Players || e6Players.length < 3) {
    console.log('SKIP E6 readiness: need 3 players coded E6P1/E6P2/E6P3 in players table.');
    console.log('  (Will apply once those codes are seeded via players.csv.)');
    return;
  }

  const codeToPlayerId = Object.fromEntries(e6Players.map(p => [p.code, p.id]));
  const refToPlayerId = {
    P1: codeToPlayerId.E6P1,
    P2: codeToPlayerId.E6P2,
    P3: codeToPlayerId.E6P3,
  };

  // Upsert pool entrants (3 rows). Idempotent via composite of pool_id+entrant_id.
  const { data: existingEntrants, error: eErr } = await supabase
    .from('pool_entrants')
    .select('entrant_id')
    .eq('pool_id', e6PoolId);
  if (eErr) { console.error('SELECT E6 pool_entrants FAILED:', eErr); process.exit(1); }
  const existingSet = new Set((existingEntrants ?? []).map(e => e.entrant_id));

  const toInsert = Object.values(refToPlayerId)
    .filter(id => !existingSet.has(id))
    .map(id => ({ pool_id: e6PoolId, entrant_id: id, entrant_type: 'player' }));

  if (toInsert.length > 0) {
    const { error: iErr } = await supabase.from('pool_entrants').insert(toInsert);
    if (iErr) { console.error('INSERT E6 pool_entrants FAILED:', iErr); process.exit(1); }
    console.log(`OK E6 pool_entrants: inserted ${toInsert.length} entrant(s)`);
  }

  // Resolve p1_id/p2_id and flip to ready.
  const { data: e6Matches, error: mErr } = await supabase
    .from('matches')
    .select('id, bracket_slot, p1_ref, p2_ref, status')
    .eq('event_id', e6EventId);
  if (mErr) { console.error('FETCH E6 matches FAILED:', mErr); process.exit(1); }

  let flipped = 0;
  for (const m of e6Matches ?? []) {
    const p1Id = refToPlayerId[m.p1_ref];
    const p2Id = refToPlayerId[m.p2_ref];
    if (!p1Id || !p2Id) continue;

    const { error: uErr } = await supabase
      .from('matches')
      .update({
        p1_id: p1Id,
        p2_id: p2Id,
        p1_type: 'player',
        p2_type: 'player',
        status: 'ready',
      })
      .eq('id', m.id);
    if (uErr) { console.error(`UPDATE E6 match ${m.bracket_slot} FAILED:`, uErr); process.exit(1); }
    flipped += 1;
  }
  console.log(`OK E6 readiness: ${flipped} match(es) resolved and set to status='ready'`);
}

// Idempotent. Safe to call before or after draw resolution.
async function refineE7Handicap(e7EventId) {
  if (!e7EventId) return;

  const { data: targetPlayers, error: pErr } = await supabase
    .from('players')
    .select('id, code')
    .in('code', ['P1', 'P2']);
  if (pErr) { console.error('LOOKUP P1/P2 FAILED:', pErr); process.exit(1); }

  if (!targetPlayers || targetPlayers.length === 0) {
    console.log('SKIP E7 handicap refinement: no players coded P1 or P2 found.');
    console.log('  (Will apply once players are seeded and draw is resolved.)');
    return;
  }

  const targetIds = new Set(targetPlayers.map(p => p.id));

  const { data: e7Matches, error: mErr } = await supabase
    .from('matches')
    .select('id, p1_id, p2_id')
    .eq('event_id', e7EventId);
  if (mErr) { console.error('FETCH E7 matches FAILED:', mErr); process.exit(1); }

  const idsToFlag = (e7Matches ?? [])
    .filter(m => targetIds.has(m.p1_id) || targetIds.has(m.p2_id))
    .map(m => m.id);

  if (idsToFlag.length === 0) {
    console.log('E7 handicap: no matches yet involve P1 or P2 (draw not resolved).');
    return;
  }

  const { error: uErr } = await supabase
    .from('matches')
    .update({ handicap_applied: true })
    .in('id', idsToFlag);
  if (uErr) { console.error('UPDATE handicap FAILED:', uErr); process.exit(1); }

  console.log(`OK E7 handicap: flagged ${idsToFlag.length} match(es) involving P1/P2`);
}

main().catch(err => { console.error(err); process.exit(1); });
