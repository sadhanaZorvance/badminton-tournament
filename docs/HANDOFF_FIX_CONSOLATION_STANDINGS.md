# HANDOFF — Fix Consolation Standings for Hybrid Events

## TL;DR

The standings screen will not display consolation pool standings for events **E2, E3, E4, E5, E7**. It will work fine for E1 and for the pure-RR events (E6, E8). This bug only surfaces once R1 matches in those events complete and consolation play begins — likely 2–4 hours into the tournament.

This is a **mid-tournament data bug**: not a crash, just a silent empty section in the public Standings tab. Parents won't see consolation standings for 5 of 8 events.

Fix it before event day.

---

## How to use this doc

You are Claude Code. Read this doc end-to-end first, then read the source files referenced, then implement.

**Do not skip the "Read these files first" section.** Some assumptions in this doc may be wrong if the codebase has drifted since it was written. Reading the actual code is the source of truth.

When done:
- Update `docs/BACKEND_DESIGN.md` if you touched the data model
- Update `docs/UI_DESIGN.md` if you changed Standings screen behaviour
- Update `docs/REQUIREMENTS.md` if you clarified a business rule
- Run the demo-mode test described at the bottom

---

## The actual problem

Consolation pools come into existence two different ways in this app:

| Event | How pools are created | `matches.pool_id` for ConRR matches |
|---|---|---|
| **E1** | `generate_consolation_pools` RPC inserts `pools` rows (Pool A + Pool B) and stamps `pool_id` on the 6 ConRR matches | NOT NULL |
| **E2, E3, E4, E5, E7** | Bracket wiring. R1 losers flow into pre-seeded ConRR matches via `complete_match`. No `pools` row is ever created. | NULL |

So the `matches` table has consolation rows in two shapes. If anything downstream groups consolation matches by `pool_id`, it will silently drop the second shape on the floor.

The most likely place this bug lives is the Standings screen — wherever it enumerates "active pools" before calling `computeStandings()` for each.

`computeStandings()` itself is fine. It takes an `entrantIds[]` list and only looks at matches between those entrants. It doesn't care about `pool_id`. The bug is in the **caller**, not the engine.

---

## Read these files first

Read in this order. Do not start coding until all six are read.

1. `docs/REQUIREMENTS.md` — search for **BR-031** (consolation pool rules) and any business rule about standings or tiebreakers
2. `docs/BACKEND_DESIGN.md` — `pools` table, `pool_entrants` table, `generate_consolation_pools` RPC spec, `matches.pool_id` semantics
3. `docs/UI_DESIGN.md` — S03 (public Standings tab spec) — what the screen is supposed to render
4. `src/lib/standings.ts` — the `computeStandings` function (this should NOT need changes — confirm)
5. `src/screens/Standings/StandingsScreen.tsx` — the suspected location of the bug
6. `src/lib/bracketWiring.ts` — confirms how E2/E3/E4/E5/E7 ConRR matches are populated

After reading, sanity-check the diagnosis:
- Search the codebase for `pool_id` usages — anywhere it's used as a filter or `groupBy`, that's a candidate site
- Search for `'ConRR'` — that's the round identifier used by hybrid-event consolation matches
- Search for `format_type` — events.format_type may be `'hybrid'` or `'knockout'` for E2-E7; verify which by checking `seed-events.js` output

If the diagnosis above doesn't match what's in the code, **stop and report what you found** before coding.

---

## What to fix

### Approach: introduce a "pool resolver" layer

Don't change `computeStandings`. Don't change the schema. Don't change RPCs. Don't add synthetic `pools` rows at seed time.

Instead, add a new function that produces a uniform list of "groups that need standings" — one entry per real pool (E1) plus one entry per synthetic consolation pool (E2/E3/E4/E5/E7) plus one entry per pure-RR event (E6, E8).

The Standings screen iterates this uniform list and calls `computeStandings` per group. It never branches on `pool_id IS NULL`.

### File to create

`src/lib/poolResolver.ts`

Exports one function:

```ts
function resolvePoolGroups(input: {
  event: Event;
  matches: Match[];          // matches for this event only
  pools: Pool[];             // pools for this event (may be empty)
  poolEntrants: PoolEntrant[];  // pool_entrants for this event's pools
}): PoolGroup[]
```

Where `PoolGroup` is:

```ts
interface PoolGroup {
  key: string;            // stable React key, e.g. `${event.id}:${poolId ?? 'consolation'}`
  label: string;          // user-facing, e.g. "U11 Boys Doubles · Consolation"
  poolId: string | null;  // null for synthetic + pure RR
  eventId: string;
  entrantIds: string[];   // player_ids OR team_ids
  matches: Match[];       // subset to feed into computeStandings
}
```

The function has three branches:

1. **`event.format_type === 'rr'`** (E6, E8) — return one group with all `round === 'RR'` matches. Entrant IDs derived from `p1_id`/`p2_id` of those matches.

2. **Hybrid events with `pools.length > 0`** (E1) — return one group per `Pool`. Filter ConRR matches by `pool_id`. Entrant IDs from `pool_entrants` rows.

3. **Hybrid events with `pools.length === 0`** (E2, E3, E4, E5, E7) — return one synthetic group. ConRR matches filtered by `round === 'ConRR'`. Entrant IDs derived from `p1_id`/`p2_id` of those matches (skip nulls — placeholders for unresolved R1 losers).

If any of those branches has zero entrants or zero matches, return an empty array for that branch (not a group with empty rows). The screen renders nothing better than it renders an empty table.

### File to update

`src/screens/Standings/StandingsScreen.tsx`

Replace whatever loop it currently uses with:

1. Fetch events (active/complete/published), matches, sets, pools, pool_entrants, players, teams — in parallel
2. Build an entrant lookup map covering both players and teams (both keyed by uuid; no collision risk in practice)
3. For each event: call `resolvePoolGroups` to get the flat list of groups
4. For each group: filter the global `sets` array to that group's matches, then call `computeStandings(group.matches, groupSets, group.entrantIds, entrantMap)`
5. Render one `<PoolStandingsTable>` per group, keyed by `group.key`, labelled with `group.label`

Preserve everything else the screen already does — error banner, loading skeleton, manual refresh button, 30-second polling fallback, tiebreaker accordion, circular-tie amber highlight.

### Possible signature tweak to `computeStandings`

The current signature takes `playerMap: Record<string, Player>`. For E4/E5/E8 the entrants are teams, not players. Two options:

**Option 1 (recommended):** Widen the signature. Change the parameter to `Record<string, { display_name: string }>`. The function only reads `.display_name` — verify by searching `playerMap[` and `nameFor` inside `standings.ts`. If true, this is a one-line type change with zero behaviour impact.

**Option 2:** Cast teams into the Player shape at the call site. Uglier but doesn't touch the engine.

Pick Option 1 unless reading the code reveals `playerMap` is used for something else.

---

## Tests to add

Add these to whatever test setup exists. If there's no test infra, at least put them as `// scenarios:` comments in `poolResolver.ts` and verify manually in demo mode.

1. **E6 (3-player RR, no pool, no consolation)** — `resolvePoolGroups` returns 1 group with 3 entrants and 3 matches.

2. **E8 (5-team RR)** — returns 1 group with 5 entrants and 10 matches.

3. **E1 with pools generated, no ConRR matches played yet** — returns 2 groups (Pool A, Pool B), each with 3 entrants and 3 matches in `ready` or `pending` status.

4. **E1 before consolation pools generated** — returns 0 groups (no `pools` rows exist yet).

5. **E4 with all 3 R1 matches complete, ConRR matches now resolved** — returns 1 group labelled `"U11 Boys Doubles · Consolation"` with 3 entrants (the 3 R1 losers as teams) and 3 matches.

6. **E4 before any R1 complete** — returns 0 groups (ConRR matches exist but `p1_id`/`p2_id` are null).

7. **E3 (3-player singles, hybrid)** — returns 1 group when ConRR is populated, with 3 player entrants.

---

## Demo-mode end-to-end test (mandatory before declaring done)

1. Reset tournament: `?demo=true` then click Reset
2. Open public Standings tab — should be empty state
3. Open court admin URL with `?demo=true`
4. Find E4 R1.1, click "Simulate Match" — auto-completes with random valid score
5. Same for E4 R1.2 and R1.3
6. Switch to Standings tab — should now show **"U11 Boys Doubles · Consolation"** with 3 rows (the 3 losing teams)
7. Simulate the 3 ConRR matches — wins/losses/PF/PA should populate
8. Repeat steps 4–7 for E5 (U13/U15 Boys Doubles) — confirm same behaviour
9. Repeat for E1: simulate all 7 R1 → fire BLP → simulate BLP → fire Generate Consolation Pools → confirm Standings shows **two** sections (Pool A + Pool B), each with 3 rows
10. Confirm E6 standings work (3 players)
11. After E8 draw is locked, confirm E8 standings work (5 teams)

If any step shows an empty section where standings should be, the bug isn't fixed.

---

## What NOT to do

- Don't add a `pools` row at seed time for E2/E3/E4/E5/E7. That's option B from the design discussion — it was rejected because it duplicates the source of truth (the ConRR matches themselves) and creates a write path inside `complete_match` to populate `pool_entrants` for synthetic pools, which is more complexity than the bug warrants.
- Don't change the `generate_consolation_pools` RPC.
- Don't change `seed-teams.js` or `seed-matches.js`.
- Don't store standings in the DB. They are always computed client-side per CLAUDE.md.
- Don't add a `pool_id` column to anything else, or backfill `pool_id` on the synthetic ConRR matches.

---

## Files you'll touch

- **Create:** `src/lib/poolResolver.ts`
- **Update:** `src/screens/Standings/StandingsScreen.tsx`
- **Possibly update:** `src/lib/standings.ts` (only if widening `playerMap` signature)
- **Update docs:** `docs/UI_DESIGN.md` (S03 section — note that consolation standings for hybrid events render under one synthetic "Consolation" group)
- **Add tests:** wherever test files live, or inline scenarios as comments

---

## Commit message

```
fix: render consolation standings for E2/E3/E4/E5/E7 hybrid events

Standings screen previously grouped consolation matches by pool_id,
which is null for hybrid-event consolation (only E1 has real pool rows).
Result: 5 of 8 events showed empty consolation standings on the public
site once R1 completed.

Add poolResolver.ts as a uniform layer between events and
computeStandings — handles pure-RR, real-pool, and synthetic-pool
shapes through one return type. computeStandings unchanged.
```

---

## If you get stuck

If reading the code reveals the bug is somewhere other than the Standings screen — for example, if `getActivePools` exists as a separate hook and that's where the `pool_id` filter lives — fix it there using the same resolver pattern. The fix is "introduce a uniform layer that produces PoolGroups," not "edit one specific file."

If the diagnosis is wrong entirely (e.g., consolation matches for hybrid events DO have pool_id set somewhere I missed), stop and report. Don't paper over it.
