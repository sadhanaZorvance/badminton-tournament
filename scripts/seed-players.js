#!/usr/bin/env node
// ============================================================================
// Leo Rising Stars — Player Seeder
//
// Reads scripts/players.csv (columns: code,full_name,age_group,gender),
// parses names per BACKEND_DESIGN rules, computes display_name with
// disambiguation across the entire roster, then upserts into players (on code).
//
// Usage:
//   node --env-file=.env.local scripts/seed-players.js
//
// Required env:
//   VITE_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (service role — bypasses RLS)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const csvPath    = resolve(__dirname, 'players.csv');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  console.error('Run with: node --env-file=.env.local scripts/seed-players.js');
  process.exit(1);
}

if (!existsSync(csvPath)) {
  console.error(`ERROR: CSV not found at ${csvPath}`);
  console.error('Create it with header row: code,full_name,age_group,gender');
  process.exit(1);
}

// ── Minimal CSV parser ──────────────────────────────────────────────────────
// Handles double-quoted fields with embedded commas. Sufficient for a 38-row
// roster — not RFC-4180-complete.
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\r') {
      // ignore
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field); rows.push(row);
  }
  return rows.filter(r => r.some(c => c && c.trim().length > 0));
}

// ── Name parsing per BACKEND_DESIGN rules ───────────────────────────────────
function parseName(full) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { first_name: '', middle_name: null, last_name: null };
  }
  if (parts.length === 1) {
    return { first_name: parts[0], middle_name: null, last_name: null };
  }
  if (parts.length === 2) {
    return { first_name: parts[0], middle_name: null, last_name: parts[1] };
  }
  if (parts.length === 3) {
    return { first_name: parts[0], middle_name: parts[1], last_name: parts[2] };
  }
  // 4+ parts: first + (middle = parts[1..n-2] joined) + last
  return {
    first_name:  parts[0],
    middle_name: parts.slice(1, -1).join(' '),
    last_name:   parts[parts.length - 1],
  };
}

// ── Disambiguation across the whole roster ──────────────────────────────────
function computeDisplayNames(rows) {
  // Bucket by lowercased first_name.
  const byFirst = new Map();
  for (const r of rows) {
    const key = r.first_name.toLowerCase();
    if (!byFirst.has(key)) byFirst.set(key, []);
    byFirst.get(key).push(r);
  }

  const warnings = [];

  for (const [, group] of byFirst) {
    if (group.length === 1) {
      // Unique first name → first only
      group[0].display_name = group[0].first_name;
      continue;
    }

    // Multiple share this first name. Bucket again by last initial (uppercased).
    const byInitial = new Map();
    for (const r of group) {
      const init = r.last_name ? r.last_name[0].toUpperCase() : '';
      if (!byInitial.has(init)) byInitial.set(init, []);
      byInitial.get(init).push(r);
    }

    for (const [init, sub] of byInitial) {
      if (init === '') {
        // No last name at all → fall back to full_name; warn.
        for (const r of sub) {
          r.display_name = r.full_name;
          warnings.push(`WARN: ${r.code} (${r.full_name}) shares first name with others but has no last name.`);
        }
      } else if (sub.length === 1) {
        // Unique last initial within first-name group → "First L."
        sub[0].display_name = `${sub[0].first_name} ${init}.`;
      } else {
        // Duplicate first + initial → "First Lastname"
        for (const r of sub) {
          r.display_name = `${r.first_name} ${r.last_name}`;
        }
      }
    }
  }

  return warnings;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const raw  = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length < 2) {
    console.error('ERROR: CSV is empty or only contains a header row.');
    process.exit(1);
  }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = {
    code:      header.indexOf('code'),
    full_name: header.indexOf('full_name'),
    age_group: header.indexOf('age_group'),
    gender:    header.indexOf('gender'),
  };
  for (const [k, v] of Object.entries(idx)) {
    if (v < 0) { console.error(`ERROR: missing CSV column "${k}"`); process.exit(1); }
  }

  const players = rows.slice(1).map((r, i) => {
    const code      = r[idx.code]?.trim();
    const full_name = r[idx.full_name]?.trim();
    const age_group = r[idx.age_group]?.trim();
    const gender    = r[idx.gender]?.trim();

    if (!code || !full_name || !age_group || !gender) {
      throw new Error(`Row ${i + 2}: missing required field (code/full_name/age_group/gender)`);
    }
    if (!['U11', 'U13', 'U15'].includes(age_group)) {
      throw new Error(`Row ${i + 2}: invalid age_group "${age_group}" (must be U11/U13/U15)`);
    }
    if (!['M', 'F'].includes(gender)) {
      throw new Error(`Row ${i + 2}: invalid gender "${gender}" (must be M/F)`);
    }

    const parsed = parseName(full_name);
    return {
      code,
      full_name,
      first_name:  parsed.first_name,
      middle_name: parsed.middle_name,
      last_name:   parsed.last_name,
      age_group,
      gender,
      status: 'active',
    };
  });

  const warnings = computeDisplayNames(players);
  warnings.forEach(w => console.warn(w));

  console.log(`Parsed ${players.length} players from ${csvPath}`);
  console.log('Sample display names:');
  players.slice(0, 5).forEach(p => console.log(`  ${p.code}: ${p.display_name}`));

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error, data } = await supabase
    .from('players')
    .upsert(players, { onConflict: 'code' })
    .select('id, code, display_name');

  if (error) {
    console.error('UPSERT FAILED:', error);
    process.exit(1);
  }

  console.log(`OK upserted ${data.length} players.`);
}

main().catch(err => { console.error(err); process.exit(1); });
