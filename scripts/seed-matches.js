#!/usr/bin/env node
// ============================================================================
// Leo Rising Stars — Match Skeleton Seeder
//
// Seeds structural matches for singles events and E6 (pure RR).
// E2 (U11 Boys Doubles), E5 (U13/U15 Boys Doubles), and E8 (Girls Doubles)
// are seeded by seed-teams.js — do NOT seed them here.
//
// Must run after seed-players.js so player IDs can be resolved.
// R1 matches are set to 'ready' immediately when player IDs resolve;
// BYE matches are seeded as 'complete' with the bye holder pre-wired.
//
// Usage:
//   node --env-file=.env.local scripts/seed-matches.js
//
// Idempotent: deletes all matches for seeded events before re-inserting.
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

// ── Player map ─────────────────────────────────────────────────────────────

async function fetchPlayerMap() {
  const { data, error } = await supabase.from('players').select('id, code');
  if (error) { console.error('FETCH players FAILED:', error); process.exit(1); }
  return Object.fromEntries((data ?? []).map(p => [p.code, p.id]));
}

// ── E1 — U11 Boys Singles ──────────────────────────────────────────────────
// 14 players, no bye. 7 R1 + 4 QF + 2 SF + F + 3P = 15 matches.
// BLP match and consolation pools are created at runtime by RPCs.
function e1Matches(eventId, pm) {
  const rows = [];
  const pid  = code => pm[code] ?? null;

  // R1: P1 vs P14, P2 vs P13, ..., P7 vs P8
  for (let i = 1; i <= 7; i++) {
    const a = `P${i}-U11-B`;
    const b = `P${15 - i}-U11-B`;
    const aId = pid(a), bId = pid(b);
    rows.push({
      event_id: eventId, round: 'R1', bracket_slot: `R1.${i}`,
      p1_ref: a, p2_ref: b,
      p1_id: aId, p2_id: bId,
      p1_type: aId ? 'player' : null, p2_type: bId ? 'player' : null,
      match_format: 'set21',
      status: aId && bId ? 'ready' : 'pending',
      handicap_applied: false,
      score_sets: [], inconsistent: false, edit_history: [],
    });
  }

  // QF: R1.1–R1.6 winners pair off; QF4.p2 reserved for BLP winner
  for (let i = 1; i <= 4; i++) {
    const p1r = `Winner:R1.${(i - 1) * 2 + 1}`;
    const p2r = i === 4 ? 'Winner:BLP' : `Winner:R1.${(i - 1) * 2 + 2}`;
    rows.push({
      event_id: eventId, round: 'QF', bracket_slot: `QF${i}`,
      p1_ref: p1r, p2_ref: p2r,
      p1_id: null, p2_id: null, p1_type: null, p2_type: null,
      match_format: 'set30', status: 'pending',
      handicap_applied: false,
      score_sets: [], inconsistent: false, edit_history: [],
    });
  }

  rows.push(
    { event_id: eventId, round: 'SF', bracket_slot: 'SF1', p1_ref: 'Winner:QF1', p2_ref: 'Winner:QF2', p1_id: null, p2_id: null, p1_type: null, p2_type: null, match_format: 'set30',        status: 'pending', handicap_applied: false, score_sets: [], inconsistent: false, edit_history: [] },
    { event_id: eventId, round: 'SF', bracket_slot: 'SF2', p1_ref: 'Winner:QF3', p2_ref: 'Winner:QF4', p1_id: null, p2_id: null, p1_type: null, p2_type: null, match_format: 'set30',        status: 'pending', handicap_applied: false, score_sets: [], inconsistent: false, edit_history: [] },
    { event_id: eventId, round: 'F',  bracket_slot: 'F',   p1_ref: 'Winner:SF1', p2_ref: 'Winner:SF2', p1_id: null, p2_id: null, p1_type: null, p2_type: null, match_format: 'best_of_3x15', status: 'pending', handicap_applied: false, score_sets: [], inconsistent: false, edit_history: [] },
    { event_id: eventId, round: '3P', bracket_slot: '3P',  p1_ref: 'Loser:SF1',  p2_ref: 'Loser:SF2',  p1_id: null, p2_id: null, p1_type: null, p2_type: null, match_format: 'set30',        status: 'pending', handicap_applied: false, score_sets: [], inconsistent: false, edit_history: [] },
  );

  return rows;
}

// ── E3 / E4 / E7 — 7-player singles hybrid with P1 bye ────────────────────
// BYE + 3 R1 + SF1 + SF2 + F + 3P + 3 ConRR + ConF = 11 matches.
// R1 pairings (mirror seeding): R1.1=[2,7], R1.2=[3,6], R1.3=[4,5].
// SF1.p1 = P1 (bye holder) pre-resolved; SF1 stays pending until R1.1 completes.
// handicap_applied=true stamped on ALL E7 matches unconditionally — the flag is a
// no-op for matches where neither player is P1 or P2.
function eSingles7Matches(eventId, pm, suffix, isE7) {
  const rows = [];
  const code = n  => `P${n}-${suffix}`;
  const pid  = n  => pm[code(n)] ?? null;
  const hc   = isE7;

  const p1Id = pid(1);

  // BYE — P1 auto-complete. If P1 not yet seeded, create a pending shell.
  rows.push({
    event_id: eventId, round: 'R1', bracket_slot: 'BYE',
    p1_ref: code(1), p2_ref: 'BYE',
    p1_id: p1Id, p2_id: null,
    p1_type: p1Id ? 'player' : null, p2_type: null,
    winner_id: p1Id, winner_type: p1Id ? 'player' : null,
    match_format: 'set21',
    status: p1Id ? 'complete' : 'pending',
    handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
    completed_at: p1Id ? new Date().toISOString() : null,
  });

  // R1: [2,7], [3,6], [4,5]
  const r1Pairs = [[2, 7], [3, 6], [4, 5]];
  r1Pairs.forEach(([a, b], i) => {
    const aId = pid(a), bId = pid(b);
    rows.push({
      event_id: eventId, round: 'R1', bracket_slot: `R1.${i + 1}`,
      p1_ref: code(a), p2_ref: code(b),
      p1_id: aId, p2_id: bId,
      p1_type: aId ? 'player' : null, p2_type: bId ? 'player' : null,
      match_format: 'set21',
      status: aId && bId ? 'ready' : 'pending',
      handicap_applied: hc,
      score_sets: [], inconsistent: false, edit_history: [],
    });
  });

  // SF1 — bye holder (P1) in p1; Winner:R1.1 feeds p2 via bracket wiring
  rows.push({
    event_id: eventId, round: 'SF', bracket_slot: 'SF1',
    p1_ref: code(1), p2_ref: 'Winner:R1.1',
    p1_id: p1Id, p2_id: null,
    p1_type: p1Id ? 'player' : null, p2_type: null,
    match_format: 'set30', status: 'pending', handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
  });

  // SF2 — Winner:R1.2 vs Winner:R1.3
  rows.push({
    event_id: eventId, round: 'SF', bracket_slot: 'SF2',
    p1_ref: 'Winner:R1.2', p2_ref: 'Winner:R1.3',
    p1_id: null, p2_id: null, p1_type: null, p2_type: null,
    match_format: 'set30', status: 'pending', handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
  });

  // F
  rows.push({
    event_id: eventId, round: 'F', bracket_slot: 'F',
    p1_ref: 'Winner:SF1', p2_ref: 'Winner:SF2',
    p1_id: null, p2_id: null, p1_type: null, p2_type: null,
    match_format: 'best_of_3x15', status: 'pending', handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
  });

  // 3P
  rows.push({
    event_id: eventId, round: '3P', bracket_slot: '3P',
    p1_ref: 'Loser:SF1', p2_ref: 'Loser:SF2',
    p1_id: null, p2_id: null, p1_type: null, p2_type: null,
    match_format: 'set30', status: 'pending', handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
  });

  // ConRR: round robin of 3 R1 losers
  const conPairs = [
    ['Loser:R1.1', 'Loser:R1.2'],
    ['Loser:R1.1', 'Loser:R1.3'],
    ['Loser:R1.2', 'Loser:R1.3'],
  ];
  conPairs.forEach(([a, b], i) => {
    rows.push({
      event_id: eventId, round: 'ConRR', bracket_slot: `ConRR.${i + 1}`,
      p1_ref: a, p2_ref: b,
      p1_id: null, p2_id: null, p1_type: null, p2_type: null,
      match_format: 'set21', status: 'pending', handicap_applied: hc,
      score_sets: [], inconsistent: false, edit_history: [],
    });
  });

  // ConF
  rows.push({
    event_id: eventId, round: 'ConF', bracket_slot: 'ConF',
    p1_ref: 'Top1:ConRR', p2_ref: 'Top2:ConRR',
    p1_id: null, p2_id: null, p1_type: null, p2_type: null,
    match_format: 'set30', status: 'pending', handicap_applied: hc,
    score_sets: [], inconsistent: false, edit_history: [],
  });

  return rows;
}

// ── E6 — U11 Girls Singles (pure RR) ──────────────────────────────────────
// 3 players, 3 RR matches. No bracket, no consolation.
// All 3 matches belong to the E6 'Main' pool for standings computation.
function e6Matches(eventId, pm, poolId) {
  const pid  = n => pm[`P${n}-U11-G`] ?? null;
  const code = n => `P${n}-U11-G`;
  return [[1, 2], [1, 3], [2, 3]].map(([a, b], i) => {
    const aId = pid(a), bId = pid(b);
    return {
      event_id: eventId, round: 'RR', bracket_slot: `RR.${i + 1}`,
      p1_ref: code(a), p2_ref: code(b),
      p1_id: aId, p2_id: bId,
      p1_type: aId ? 'player' : null, p2_type: bId ? 'player' : null,
      pool_id: poolId,
      match_format: 'set21',
      status: aId && bId ? 'ready' : 'pending',
      handicap_applied: false,
      score_sets: [], inconsistent: false, edit_history: [],
    };
  });
}

// ── E6 pool helpers ────────────────────────────────────────────────────────

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

async function ensureE6PoolEntrants(e6EventId, e6PoolId, pm) {
  const playerIds = [1, 2, 3].map(n => pm[`P${n}-U11-G`]).filter(Boolean);
  if (playerIds.length < 3) {
    console.log('SKIP E6 pool_entrants: need players P1-U11-G, P2-U11-G, P3-U11-G seeded first.');
    return;
  }

  const { data: existing, error: selErr } = await supabase
    .from('pool_entrants')
    .select('entrant_id')
    .eq('pool_id', e6PoolId);
  if (selErr) { console.error('SELECT E6 pool_entrants FAILED:', selErr); process.exit(1); }

  const existingSet = new Set((existing ?? []).map(e => e.entrant_id));
  const toInsert = playerIds
    .filter(id => !existingSet.has(id))
    .map(id => ({ pool_id: e6PoolId, entrant_id: id, entrant_type: 'player' }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from('pool_entrants').insert(toInsert);
    if (error) { console.error('INSERT E6 pool_entrants FAILED:', error); process.exit(1); }
    console.log(`OK E6 pool_entrants: inserted ${toInsert.length} entrant(s)`);
  } else {
    console.log('OK E6 pool_entrants: already up to date');
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pm = await fetchPlayerMap();
  const foundCodes = Object.keys(pm);
  console.log(`OK players in DB: ${foundCodes.length}`);

  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, code')
    .in('code', ['E1', 'E3', 'E4', 'E6', 'E7']);

  if (eventsErr) { console.error('FETCH events FAILED:', eventsErr); process.exit(1); }
  if (events.length < 5) {
    console.error(`ERROR: expected 5 events (E1,E3,E4,E6,E7), found ${events.length}. Run seed-events.js first.`);
    process.exit(1);
  }

  const codeToId = Object.fromEntries(events.map(e => [e.code, e.id]));

  // Wipe existing matches for these events (idempotent — safe pre-tournament)
  const eventIds = Object.values(codeToId);
  const { error: delErr } = await supabase.from('matches').delete().in('event_id', eventIds);
  if (delErr) { console.error('DELETE existing matches FAILED:', delErr); process.exit(1); }

  // Ensure E6 Main pool exists
  const e6PoolId = await ensureE6Pool(codeToId.E6);

  const builders = {
    E1: () => e1Matches(codeToId.E1, pm),
    E3: () => eSingles7Matches(codeToId.E3, pm, 'U13-B',    false),
    E4: () => eSingles7Matches(codeToId.E4, pm, 'U15-B',    false),
    E6: () => e6Matches(codeToId.E6, pm, e6PoolId),
    E7: () => eSingles7Matches(codeToId.E7, pm, 'U13U15-G', true),
  };

  let total = 0;
  for (const [code, build] of Object.entries(builders)) {
    const rows = build();
    const { data, error } = await supabase.from('matches').insert(rows).select('id');
    if (error) { console.error(`INSERT ${code} FAILED:`, error); process.exit(1); }
    const ready    = rows.filter(r => r.status === 'ready').length;
    const complete = rows.filter(r => r.status === 'complete').length;
    const pending  = rows.filter(r => r.status === 'pending').length;
    console.log(`OK ${code}: ${data.length} matches (ready:${ready} complete:${complete} pending:${pending})`);
    total += data.length;
  }

  // E6 pool entrants (idempotent)
  await ensureE6PoolEntrants(codeToId.E6, e6PoolId, pm);

  console.log(`\nOK total ${total} match shells seeded.`);
  console.log('Note: E2, E5, E8 matches are seeded by seed-teams.js.');
}

main().catch(err => { console.error(err); process.exit(1); });
