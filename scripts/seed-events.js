#!/usr/bin/env node
// ============================================================================
// Leo Rising Stars — Event Seeder (E1..E8)
//
// Seeds the 8 tournament categories. Structural fields (format_type, gender,
// age_group, court_pool, depends_on, handicap_rule) match BACKEND_DESIGN.md
// and the structural hints in PROMPTS.md. Display names are best-effort —
// adjust against HL-design.md before the event if needed.
//
// Usage:
//   node --env-file=.env.local scripts/seed-events.js
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

// ── Event definitions ───────────────────────────────────────────────────────
// depends_on uses event codes here; resolved to UUIDs after first upsert pass.
const events = [
  { code: 'E1', name: 'U11 Boys Singles',     format_type: 'knockout', gender: 'M',     age_group: 'U11',   court_pool: 'boys',  depends_on_codes: [],            handicap_rule: null,        status: 'active'  },
  { code: 'E2', name: 'U11 Boys Doubles',         format_type: 'hybrid', gender: 'M', age_group: 'U11',   court_pool: 'boys',  depends_on_codes: ['E1'],        handicap_rule: null,        status: 'pending' },
  { code: 'E3', name: 'U13 Boys Singles',         format_type: 'hybrid', gender: 'M', age_group: 'U13',   court_pool: 'boys',  depends_on_codes: [],            handicap_rule: null,        status: 'pending' },
  { code: 'E4', name: 'U15 Boys Singles',         format_type: 'hybrid', gender: 'M', age_group: 'U15',   court_pool: 'boys',  depends_on_codes: [],            handicap_rule: null,        status: 'pending' },
  { code: 'E5', name: 'U13/U15 Boys Doubles',     format_type: 'hybrid', gender: 'M', age_group: 'mixed', court_pool: 'boys',  depends_on_codes: ['E3','E4'],   handicap_rule: null,        status: 'pending' },
  { code: 'E6', name: 'U11 Girls Singles',         format_type: 'rr',     gender: 'F', age_group: 'U11',   court_pool: 'girls', depends_on_codes: [],            handicap_rule: null,        status: 'pending' },
  { code: 'E7', name: 'U13/U15 Girls Singles',    format_type: 'hybrid', gender: 'F', age_group: 'mixed', court_pool: 'girls', depends_on_codes: [],            handicap_rule: 'P1,P2:3-0', status: 'pending' },
  { code: 'E8', name: 'Girls Doubles',             format_type: 'rr',     gender: 'F', age_group: 'mixed', court_pool: 'girls', depends_on_codes: ['E6','E7'],   handicap_rule: null,        status: 'pending' },
];

async function main() {
  // Pass 1: upsert without depends_on resolution
  const initial = events.map(e => ({
    code:          e.code,
    name:          e.name,
    format_type:   e.format_type,
    gender:        e.gender,
    age_group:     e.age_group,
    status:        e.status,
    court_pool:    e.court_pool,
    handicap_rule: e.handicap_rule,
    depends_on:    [],
    draw_locked:   false,
  }));

  const { data: rows, error: upsertErr } = await supabase
    .from('events')
    .upsert(initial, { onConflict: 'code' })
    .select('id, code');

  if (upsertErr) { console.error('UPSERT FAILED:', upsertErr); process.exit(1); }

  const codeToId = Object.fromEntries(rows.map(r => [r.code, r.id]));

  // Pass 2: resolve depends_on by code → uuid, update each event
  for (const e of events) {
    const dependsUuids = e.depends_on_codes.map(c => codeToId[c]).filter(Boolean);
    const { error } = await supabase
      .from('events')
      .update({ depends_on: dependsUuids })
      .eq('code', e.code);
    if (error) { console.error(`UPDATE depends_on for ${e.code} FAILED:`, error); process.exit(1); }
  }

  console.log(`OK seeded ${rows.length} events.`);
  rows.forEach(r => console.log(`  ${r.code}: ${r.id}`));
}

main().catch(err => { console.error(err); process.exit(1); });
