/**
 * seed-teams.js
 *
 * Seeds the `teams` table for E2, E5, E8 and generates all R1/RR matches
 * for those events (plus pending downstream matches: SF, F, 3P, ConRR, ConF).
 *
 * Re-runnable: for matches, deletes existing matches for E2/E5/E8 before
 * re-inserting (idempotent re-runs).
 *
 * Pre-requisites:
 *   - players table seeded (seed-players.js)
 *   - events table seeded (seed-events.js)
 *   - SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL in env
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-teams.js
 */

import { createClient } from '@supabase/supabase-js';

// ─── ENV ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Missing env vars: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── TEAMS DATA ─────────────────────────────────────────────────────────────

/**
 * Order matters for E2 and E5: index 0 (T1) gets the bye.
 * Pairings for R1 (confirmed from public schedule):
 *   R1.1: teams[1] vs teams[6]  (T2 vs T7)
 *   R1.2: teams[3] vs teams[4]  (T4 vs T5)
 *   R1.3: teams[2] vs teams[5]  (T3 vs T6)
 */
const TEAMS = {
  E2: [
    { code: 'T1-U11-B', p1: 'P6-U11-B',  p2: 'P14-U11-B' }, // BYE
    { code: 'T2-U11-B', p1: 'P9-U11-B',  p2: 'P4-U11-B'  },
    { code: 'T3-U11-B', p1: 'P7-U11-B',  p2: 'P8-U11-B'  },
    { code: 'T4-U11-B', p1: 'P5-U11-B',  p2: 'P2-U11-B'  },
    { code: 'T5-U11-B', p1: 'P1-U11-B',  p2: 'P3-U11-B'  },
    { code: 'T6-U11-B', p1: 'P13-U11-B', p2: 'P10-U11-B' },
    { code: 'T7-U11-B', p1: 'P12-U11-B', p2: 'P11-U11-B' },
  ],
  E5: [
    { code: 'T1-U13U15-B', p1: 'P7-U13-B', p2: 'P5-U15-B' }, // BYE
    { code: 'T2-U13U15-B', p1: 'P4-U15-B', p2: 'P3-U13-B' },
    { code: 'T3-U13U15-B', p1: 'P6-U13-B', p2: 'P2-U15-B' },
    { code: 'T4-U13U15-B', p1: 'P5-U13-B', p2: 'P3-U15-B' },
    { code: 'T5-U13U15-B', p1: 'P2-U13-B', p2: 'P7-U15-B' },
    { code: 'T6-U13U15-B', p1: 'P4-U13-B', p2: 'P6-U15-B' },
    { code: 'T7-U13U15-B', p1: 'P1-U13-B', p2: 'P1-U15-B' },
  ],
  E8: [
    { code: 'T1-G', p1: 'P4-U13U15-G', p2: 'P2-U11-G'    },
    { code: 'T2-G', p1: 'P1-U13U15-G', p2: 'P3-U13U15-G' },
    { code: 'T3-G', p1: 'P3-U11-G',    p2: 'P5-U13U15-G' },
    { code: 'T4-G', p1: 'P2-U13U15-G', p2: 'P1-U11-G'    },
    { code: 'T5-G', p1: 'P6-U13U15-G', p2: 'P7-U13U15-G' },
  ],
};

// ─── EVENT MATCH-FORMAT MATRIX ──────────────────────────────────────────────

const FORMATS = {
  E2: { R1: 'set21', SF: 'set30', F: 'best_of_3x15', '3P': 'set30', ConRR: 'set21', ConF: 'set30' },
  E5: { R1: 'set21', SF: 'set30', F: 'best_of_3x15', '3P': 'set30', ConRR: 'set21', ConF: 'set30' },
  E8: { RR: 'set21', F: 'best_of_3x15', '3P': 'set30' },
};

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function fetchPlayerMap() {
  const { data, error } = await supabase
    .from('players')
    .select('id, code, display_name');
  if (error) throw new Error(`fetchPlayerMap: ${error.message}`);
  const map = new Map();
  for (const p of data) map.set(p.code, p);
  return map;
}

async function fetchEventMap() {
  const { data, error } = await supabase
    .from('events')
    .select('id, code')
    .in('code', ['E2', 'E5', 'E8']);
  if (error) throw new Error(`fetchEventMap: ${error.message}`);
  const map = new Map();
  for (const e of data) map.set(e.code, e.id);
  if (map.size !== 3) {
    throw new Error(`Expected 3 events (E2, E5, E8), got ${map.size}`);
  }
  return map;
}

/**
 * Insert teams for a given event. Returns map of team code → team UUID.
 *
 * The DB schema has no `teams.code` column, so we can't upsert on it.
 * Instead: delete existing teams for this event, then insert fresh.
 * Safe at seed time — matches that reference teams are wiped right after
 * inside deleteEventMatches().
 *
 * The `code` field exists only in this script (TEAMS array) as a stable
 * handle for building the bracket. We map it to the returned UUID by
 * matching player1+player2 IDs in the inserted rows.
 */
async function upsertTeams(eventCode, eventId, playerMap) {
  const teamDefs = TEAMS[eventCode];
  const rows = teamDefs.map(t => {
    const p1 = playerMap.get(t.p1);
    const p2 = playerMap.get(t.p2);
    if (!p1) throw new Error(`${eventCode}/${t.code}: player code "${t.p1}" not found`);
    if (!p2) throw new Error(`${eventCode}/${t.code}: player code "${t.p2}" not found`);
    return {
      event_id: eventId,
      player1_id: p1.id,
      player2_id: p2.id,
      display_name: `${p1.display_name} & ${p2.display_name}`,
      status: 'active',
    };
  });

  // Wipe existing teams for this event (matches will be wiped next)
  const { error: delErr } = await supabase
    .from('teams')
    .delete()
    .eq('event_id', eventId);
  if (delErr) throw new Error(`upsertTeams ${eventCode} (delete): ${delErr.message}`);

  // Insert fresh — order preserved
  const { data, error } = await supabase
    .from('teams')
    .insert(rows)
    .select('id, player1_id, player2_id');
  if (error) throw new Error(`upsertTeams ${eventCode} (insert): ${error.message}`);
  if (!data || data.length !== teamDefs.length) {
    throw new Error(`upsertTeams ${eventCode}: expected ${teamDefs.length} rows back, got ${data?.length}`);
  }

  // Map team code → team UUID by matching player1+player2 pair
  const map = new Map();
  for (const t of teamDefs) {
    const p1Id = playerMap.get(t.p1).id;
    const p2Id = playerMap.get(t.p2).id;
    const row = data.find(r => r.player1_id === p1Id && r.player2_id === p2Id);
    if (!row) throw new Error(`upsertTeams ${eventCode}: no inserted row for ${t.code}`);
    map.set(t.code, row.id);
  }
  return map;
}

/**
 * Wipe existing matches for an event so re-runs are idempotent.
 * Safe at seed time — these events haven't been played yet.
 */
async function deleteEventMatches(eventCode, eventId) {
  const { error } = await supabase
    .from('matches')
    .delete()
    .eq('event_id', eventId);
  if (error) throw new Error(`deleteEventMatches ${eventCode}: ${error.message}`);
}

async function insertMatches(eventCode, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from('matches').insert(rows);
  if (error) throw new Error(`insertMatches ${eventCode}: ${error.message}`);
}

// ─── MATCH BUILDERS ─────────────────────────────────────────────────────────

/**
 * E2 / E5 — 7 teams, T1 bye, knockout + 3-team consolation.
 *
 * Bracket structure:
 *   BYE     — T1 auto-complete, advances to SF1.p1
 *   R1.1    — teams[1] vs teams[6]   (winner → SF1.p2, loser → ConRR.2/ConRR.3)
 *   R1.2    — teams[3] vs teams[4]   (winner → SF2.p1, loser → ConRR.1/ConRR.2)
 *   R1.3    — teams[2] vs teams[5]   (winner → SF2.p2, loser → ConRR.1/ConRR.3)
 *   SF1     — T1 vs Winner:R1.1
 *   SF2     — Winner:R1.2 vs Winner:R1.3
 *   F       — Winner:SF1 vs Winner:SF2
 *   3P      — Loser:SF1 vs Loser:SF2
 *   ConRR.1 — Loser:R1.2 vs Loser:R1.3
 *   ConRR.2 — Loser:R1.1 vs Loser:R1.2
 *   ConRR.3 — Loser:R1.1 vs Loser:R1.3
 *   ConF    — Top1:ConRR vs Top2:ConRR
 */
function buildHybrid7Matches(eventCode, eventId, teamMap) {
  const fmt = FORMATS[eventCode];
  const teamDefs = TEAMS[eventCode];
  const teamCode = i => teamDefs[i].code;
  const teamId   = i => teamMap.get(teamDefs[i].code);

  const t1Code = teamCode(0);
  const t1Id   = teamId(0);

  const rows = [];

  // BYE — T1 auto-complete
  rows.push({
    event_id: eventId,
    round: 'R1',
    bracket_slot: 'BYE',
    p1_ref: t1Code,
    p2_ref: 'BYE',
    p1_id: t1Id,
    p2_id: null,
    p1_type: 'team',
    p2_type: null,
    winner_id: t1Id,
    winner_type: 'team',
    match_format: fmt.R1,
    status: 'complete',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
    completed_at: new Date().toISOString(),
  });

  // R1.1 / R1.2 / R1.3 — pair indices from public schedule
  const r1Pairs = [[1, 6], [3, 4], [2, 5]];
  r1Pairs.forEach(([a, b], i) => {
    rows.push({
      event_id: eventId,
      round: 'R1',
      bracket_slot: `R1.${i + 1}`,
      p1_ref: teamCode(a),
      p2_ref: teamCode(b),
      p1_id: teamId(a),
      p2_id: teamId(b),
      p1_type: 'team',
      p2_type: 'team',
      match_format: fmt.R1,
      status: 'ready',
      handicap_applied: false,
      score_sets: [],
      inconsistent: false,
      edit_history: [],
    });
  });

  // SF1 — T1 vs Winner:R1.1   (T1 already resolved from bye)
  rows.push({
    event_id: eventId,
    round: 'SF',
    bracket_slot: 'SF1',
    p1_ref: t1Code,
    p2_ref: 'Winner:R1.1',
    p1_id: t1Id,
    p2_id: null,
    p1_type: 'team',
    p2_type: null,
    match_format: fmt.SF,
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  // SF2 — Winner:R1.2 vs Winner:R1.3
  rows.push({
    event_id: eventId,
    round: 'SF',
    bracket_slot: 'SF2',
    p1_ref: 'Winner:R1.2',
    p2_ref: 'Winner:R1.3',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt.SF,
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  // F — Winner:SF1 vs Winner:SF2
  rows.push({
    event_id: eventId,
    round: 'F',
    bracket_slot: 'F',
    p1_ref: 'Winner:SF1',
    p2_ref: 'Winner:SF2',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt.F,
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  // 3P — Loser:SF1 vs Loser:SF2
  rows.push({
    event_id: eventId,
    round: '3P',
    bracket_slot: '3P',
    p1_ref: 'Loser:SF1',
    p2_ref: 'Loser:SF2',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt['3P'],
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  // ConRR.1 / ConRR.2 / ConRR.3 — round robin between 3 R1 losers
  const conPairs = [
    ['Loser:R1.2', 'Loser:R1.3'],   // ConRR.1
    ['Loser:R1.1', 'Loser:R1.2'],   // ConRR.2
    ['Loser:R1.1', 'Loser:R1.3'],   // ConRR.3
  ];
  conPairs.forEach(([a, b], i) => {
    rows.push({
      event_id: eventId,
      round: 'ConRR',
      bracket_slot: `ConRR.${i + 1}`,
      p1_ref: a,
      p2_ref: b,
      p1_id: null,
      p2_id: null,
      p1_type: null,
      p2_type: null,
      match_format: fmt.ConRR,
      status: 'pending',
      handicap_applied: false,
      score_sets: [],
      inconsistent: false,
      edit_history: [],
    });
  });

  // ConF — Top1:ConRR vs Top2:ConRR
  rows.push({
    event_id: eventId,
    round: 'ConF',
    bracket_slot: 'ConF',
    p1_ref: 'Top1:ConRR',
    p2_ref: 'Top2:ConRR',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt.ConF,
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  return rows;
}

/**
 * E8 — 5 teams, full RR (10 matches), then F + 3P (pending until standings).
 */
function buildE8Matches(eventId, teamMap) {
  const fmt = FORMATS.E8;
  const teamDefs = TEAMS.E8;
  const teamId   = i => teamMap.get(teamDefs[i].code);
  const teamCode = i => teamDefs[i].code;

  const rows = [];
  let n = 1;

  // 10 RR matches: all pairs (i, j) with i < j
  for (let i = 0; i < teamDefs.length; i++) {
    for (let j = i + 1; j < teamDefs.length; j++) {
      rows.push({
        event_id: eventId,
        round: 'RR',
        bracket_slot: `RR.${n}`,
        p1_ref: teamCode(i),
        p2_ref: teamCode(j),
        p1_id: teamId(i),
        p2_id: teamId(j),
        p1_type: 'team',
        p2_type: 'team',
        match_format: fmt.RR,
        status: 'ready',
        handicap_applied: false,
        score_sets: [],
        inconsistent: false,
        edit_history: [],
      });
      n++;
    }
  }

  // F — Top1 vs Top2 (resolved after RR completes)
  rows.push({
    event_id: eventId,
    round: 'F',
    bracket_slot: 'F',
    p1_ref: 'Top1:RR',
    p2_ref: 'Top2:RR',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt.F,
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  // 3P — Top3 vs Top4 (resolved after RR completes)
  rows.push({
    event_id: eventId,
    round: '3P',
    bracket_slot: '3P',
    p1_ref: 'Top3:RR',
    p2_ref: 'Top4:RR',
    p1_id: null,
    p2_id: null,
    p1_type: null,
    p2_type: null,
    match_format: fmt['3P'],
    status: 'pending',
    handicap_applied: false,
    score_sets: [],
    inconsistent: false,
    edit_history: [],
  });

  return rows;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏸 seed-teams.js — starting');
  console.log(`   Supabase: ${SUPABASE_URL}`);

  // 1. Lookup players + events
  console.log('\n📥 Fetching player + event maps...');
  const playerMap = await fetchPlayerMap();
  const eventMap  = await fetchEventMap();
  console.log(`   ${playerMap.size} players, ${eventMap.size} target events`);

  const summary = [];

  // 2. Process each event
  for (const eventCode of ['E2', 'E5', 'E8']) {
    console.log(`\n━━━ ${eventCode} ━━━`);
    const eventId = eventMap.get(eventCode);

    // Teams
    console.log(`   Upserting ${TEAMS[eventCode].length} teams...`);
    const teamMap = await upsertTeams(eventCode, eventId, playerMap);
    console.log(`   ✓ ${teamMap.size} teams in DB`);

    // Wipe existing matches for clean re-run
    console.log(`   Clearing existing matches for ${eventCode}...`);
    await deleteEventMatches(eventCode, eventId);

    // Build + insert matches
    const rows = eventCode === 'E8'
      ? buildE8Matches(eventId, teamMap)
      : buildHybrid7Matches(eventCode, eventId, teamMap);

    console.log(`   Inserting ${rows.length} matches...`);
    await insertMatches(eventCode, rows);

    const ready    = rows.filter(r => r.status === 'ready').length;
    const pending  = rows.filter(r => r.status === 'pending').length;
    const complete = rows.filter(r => r.status === 'complete').length;
    console.log(`   ✓ ${rows.length} matches (ready: ${ready}, pending: ${pending}, complete/bye: ${complete})`);

    summary.push({ event: eventCode, teams: teamMap.size, matches: rows.length, ready, pending, complete });
  }

  // 3. Summary
  console.log('\n━━━ Summary ━━━');
  console.table(summary);
  console.log('\n✅ seed-teams.js complete');
}

main().catch(err => {
  console.error('\n❌ FAILED:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
