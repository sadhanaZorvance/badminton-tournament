# Session Context — Leo Rising Stars Fix Session (May 2026)

Read this instead of REQUIREMENTS.md + UI_DESIGN.md when fixing bugs in bracketWiring,
standings, seed scripts, or RPCs. Covers only what changed or what trips people up.

---

## What was fixed (all confirmed, seed scripts re-run)

### Bug 1 — E2/E5 R1 pairings (scripts/seed-teams.js)
`r1Pairs` now `[[1,6],[3,4],[2,5]]` → T2vsT7, T4vsT5, T3vsT6 (was [1,2],[3,4],[5,6]).

### Bug 2 — ConRR ordering, all hybrid events
Both `seed-teams.js` and `seed-matches.js` now use:
```
ConRR.1 = Loser:R1.2 vs Loser:R1.3
ConRR.2 = Loser:R1.1 vs Loser:R1.2
ConRR.3 = Loser:R1.1 vs Loser:R1.3
```

### Bug 3 — bracketWiring.ts (src/lib/bracketWiring.ts)
STANDARD_BRACKET_WIRING (used by E2/E3/E4/E5/E7) now has explicit ConRR rules:
```ts
{ source: 'R1.1', sourceResult: 'loser', target: 'ConRR.2', targetSlot: 'p1' },
{ source: 'R1.1', sourceResult: 'loser', target: 'ConRR.3', targetSlot: 'p1' },
{ source: 'R1.2', sourceResult: 'loser', target: 'ConRR.1', targetSlot: 'p1' },
{ source: 'R1.2', sourceResult: 'loser', target: 'ConRR.2', targetSlot: 'p2' },
{ source: 'R1.3', sourceResult: 'loser', target: 'ConRR.1', targetSlot: 'p2' },
{ source: 'R1.3', sourceResult: 'loser', target: 'ConRR.3', targetSlot: 'p2' },
```
Old slot1/slot2/slot3 + top1/top2 rules are GONE. SourceResult is now `'winner'|'loser'` only.
TargetSlot is now `'p1'|'p2'` only.

### Bug 4 — ConRR → ConF auto-fill (supabase/03_rpc.sql, complete_match)
After the `_resolve_downstream` calls, `complete_match` now detects when all 3 ConRR
matches are done and fills ConF.p1_id/p2_id + sets status='ready'.
Ranking: wins DESC → point-diff DESC. Uses score_sets->0->>'p1'/'p2' for PF/PA.

### Bug 5 — lock_e8_draw (supabase/03_rpc.sql)
Two changes:
- Match round: `'ConRR'` → `'RR'`
- Before match loop: creates `pools` row (`label='Main'`) + 5 `pool_entrants` rows (team type)
- Match INSERT now includes `pool_id`

### Bug 6 — StandingsScreen (multiple files)
Root cause: screen dropped all matches where `pool_id IS NULL` and only looped DB pools.

**New file: src/lib/poolResolver.ts** — `resolvePoolGroups()` with 3 branches:
1. `format_type === 'rr'` (E6/E8) → 1 group, all `round='RR'` matches, entrants from p1/p2
2. Hybrid + `pools.length > 0` (E1 after RPC) → 1 group per Pool, pool_id filter, entrants from pool_entrants
3. Hybrid + `pools.length === 0` (E2/E3/E4/E5/E7) → 1 synthetic group, `round='ConRR'` matches, entrants from p1/p2 (skip nulls)

**Updated: src/screens/Standings/StandingsScreen.tsx**
- Fetches ALL matches (no pool_id filter) + teams (was missing)
- Builds unified entrantMap: players + teams keyed by uuid
- Per event: calls resolvePoolGroups → per group: calls computeStandings
- Added 30s polling fallback

**Updated: src/lib/standings.ts**
- `playerMap` param widened to `Record<string, { display_name: string }>` (so teams work)

**Updated: src/types/index.ts**
- Added `'RR'` to MatchRound union (was missing — E6/E8 matches use round='RR')

---

## Critical invariants to remember

**ConRR match bracket_slots** (for E2/E3/E4/E5/E7):
- `ConRR.1` = Loser:R1.2 vs Loser:R1.3 — p1=R1.2 loser, p2=R1.3 loser
- `ConRR.2` = Loser:R1.1 vs Loser:R1.2 — p1=R1.1 loser, p2=R1.2 loser
- `ConRR.3` = Loser:R1.1 vs Loser:R1.3 — p1=R1.1 loser, p2=R1.3 loser
- `ConF`    = Top1:ConRR vs Top2:ConRR — filled by complete_match RPC

**E8 pool**: Created by `lock_e8_draw` RPC (not seed). Pool label='Main', 5 team entrants.
Seed-teams.js E8 matches have no pool_id — only used for dev/demo. Lock RPC wipes+recreates.

**score_sets JSON shape**: `[{"p1": N, "p2": N, "complete": true}]`
For set21: always 1 element. `score_sets->0->>'p1'` = p1 score.

**Standings screen group labels**:
- Pure RR (E6/E8): `event.name` only
- E1 Pool A/B: `"Event Name · Pool A"`
- E2-E7 consolation: `"Event Name · Consolation"`

**When to re-run seed scripts**: any time seed-teams.js or seed-matches.js changes.
Command: `node --env-file=.env.local scripts/seed-teams.js && node --env-file=.env.local scripts/seed-matches.js`

**When to re-apply SQL**: any time supabase/03_rpc.sql changes.

---

## File map (only files that matter for bracket/standings work)

```
scripts/seed-teams.js          E2/E5/E8 teams + matches — includes r1Pairs, conPairs
scripts/seed-matches.js        E1/E3/E4/E6/E7 matches — includes eSingles7 conPairs
src/lib/bracketWiring.ts       Static wiring config — STANDARD_BRACKET_WIRING for E2-E7
src/lib/poolResolver.ts        New — resolvePoolGroups() for standings grouping
src/lib/standings.ts           computeStandings() — client-side, never stored
src/screens/Standings/         StandingsScreen.tsx — public standings tab
supabase/03_rpc.sql            complete_match, lock_e8_draw, reset_tournament
src/types/index.ts             MatchRound includes 'RR' now
```

---

## Known open work

- Demo-mode end-to-end test (from HANDOFF_FIX_CONSOLATION_STANDINGS.md bottom section) not yet run
- Any bugs discovered after matches are confirmed good → fix here, note below

---

## Changes — May 2026 (mobile nav + auto-publish podiums)

### Fix A — AdminHeader.tsx mobile nav
- `hidden sm:flex` removed from Top Admin nav; Event Control link now always visible
- Champion Board link removed from nav (route `/champion-board` kept as escape hatch)
- Event Control styled as gold pill button (`bg-gold/10 text-gold-bright`) for visibility

### Fix B — Auto-publish partial podiums (_maybe_update_podium)
- Replaced `_maybe_draft_podium(event_id, admin_name)` with `_maybe_update_podium(event_id)`
- New function: no "all matches terminal" gate; derives F/3P/ConF positions independently
- UPSERTs podium row as each bracket position is determined; status='published' immediately
- If all positions null (e.g. cascade reset Final): row reverts to 'draft' (hides on public board)
- event.status='complete' still fires only when all matches terminal (unchanged)
- cascade_edit_match now calls `_maybe_update_podium` so edits to F/3P/ConF auto-refresh podium

### Fix C — E6/E8 auto-publish (supabase/03_rpc.sql)
- **E6 (pure RR, no playoff matches)**: `_maybe_update_podium` now has a pure-RR branch.
  When `v_outstanding=0` + no F/3P/ConF bracket slots exist + `format_type='rr'` → computes
  standings (wins DESC, point_diff DESC) from all RR matches → sets gold/silver/bronze → publishes.
- **E8 (RR then playoffs)**: New `_maybe_create_rr_playoffs(event_id)` function.
  E8-only, idempotent (checks bracket_slot='F' existence). When all 10 RR matches are terminal →
  computes standings → inserts F match (best_of_3x15, 1st vs 2nd, ready) and 3P match (set30,
  3rd vs 4th, ready). Called BEFORE `_maybe_update_podium` in complete_match, record_walkover,
  record_retirement. After F/3P complete, `_maybe_update_podium` normal bracket-slot branch fires.
- `_maybe_update_podium` `v_outstanding` computation moved to top of function (used in RR branch).
- Standings CTE: `entrants` union from p1_id/p2_id; `match_scores` sums score_sets jsonb;
  `standings_agg` left-joins wins + point_diff; ordered by wins DESC, point_diff DESC.

### Remaining bugs (if any — fill in as discovered)
_None logged yet._
