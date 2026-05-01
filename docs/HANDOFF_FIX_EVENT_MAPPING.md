# HANDOFF — Fix Event Code Mapping (E1–E8)

## TL;DR

The codebase was built against an old event mapping. The schedule shared publicly with parents uses a **different mapping**. They must align — otherwise on tournament day, the brackets, R1 matchups, podiums, and admin triggers will all be wrong for the wrong sport at the wrong time.

This is a **before-anything-else fix**. Do this before the consolation-standings fix. Do this before any other prompt. Until event codes are reconciled, every other change is built on sand.

The canonical mapping below comes directly from `playSchedule.xlsx` (the file shared with parents). The schedule is the source of truth — **the code conforms to the schedule, not the other way around.**

---

## How to use this doc

You are Claude Code. Read this doc end-to-end first, then read every file under "Read these files first", then implement.

When done:
- Update `docs/REQUIREMENTS.md`, `docs/BACKEND_DESIGN.md`, `docs/HL-design.md`, `docs/UI_DESIGN.md` to use the canonical mapping
- Re-run all seed scripts in order
- Run the demo-mode verification at the bottom

If anything in this doc contradicts the actual code, **stop and report**. Do not paper over.

---

## Canonical event mapping (source of truth)

```
E1 — U11 Boys Singles            14 players  knockout + BLP + 2 consolation pools
E2 — U11 Boys Doubles             7 teams    hybrid: T1 bye + 3 R1 + SF/F/3P + ConRR/ConF
E3 — U13 Boys Singles             7 players  hybrid: P1 bye + 3 R1 + SF/F/3P + ConRR/ConF
E4 — U15 Boys Singles             7 players  hybrid: P1 bye + 3 R1 + SF/F/3P + ConRR/ConF
E5 — U13/U15 Boys Doubles         7 teams    hybrid: T1 bye + 3 R1 + SF/F/3P + ConRR/ConF
E6 — U11 Girls Singles            3 players  pure RR (3 matches), no consolation
E7 — U13/U15 Girls Singles        7 players  hybrid: P1 bye + 3 R1 + SF/F/3P + ConRR/ConF + HANDICAP
E8 — Girls Doubles                5 teams    pure RR (10 matches) + F + 3P, no consolation
```

### R1 pairings (standard 7-entrant hybrid: E2, E3, E4, E5, E7)

T1/P1 always gets the bye. Remaining 6 entrants pair as a mirror:

```
R1.1: entrant[1] vs entrant[6]   // 2 vs 7
R1.2: entrant[2] vs entrant[5]   // 3 vs 6
R1.3: entrant[3] vs entrant[4]   // 4 vs 5
```

Hybrid bracket structure:
```
BYE     T1/P1 auto-complete
R1.1, R1.2, R1.3   ready at start
SF1     T1 vs Winner:R1.1
SF2     Winner:R1.2 vs Winner:R1.3
F       Winner:SF1 vs Winner:SF2
3P      Loser:SF1 vs Loser:SF2
ConRR.1 Loser:R1.1 vs Loser:R1.2
ConRR.2 Loser:R1.1 vs Loser:R1.3
ConRR.3 Loser:R1.2 vs Loser:R1.3
ConF    Top1:ConRR vs Top2:ConRR
```

### Match format matrix (locked, do not change)

```
RR / pool / R1                 set21
QF / SF / 3P (any age)         set30
All Finals (any age/gender)    best_of_3x15
Consolation RR                 set21
Consolation Final              set30
BLP                            set21
```

### Format edge case for E5 (U13/U15 Doubles)

E5 SF and 3P use `set30` — same as everyone else. The earlier handoff doc that said E5 SF should be `best_of_3x15` was wrong; that's been corrected in `seed-teams.js` already.

### E7 handicap rule

P1 and P2 in E7 are the two U13 girls. They start every set at 3-0 in every match including consolation. Stored as `matches.handicap_applied = true` on relevant rows. Score validation does NOT change — admin enters final score including the head start. Banner enforcement happens in the UI.

---

## Read these files first

In this order. Do not start coding until all are read.

1. `docs/HL-design.md` — full design doc; check what event mapping it currently asserts
2. `docs/REQUIREMENTS.md` — every business rule that mentions E1–E8 by code
3. `docs/BACKEND_DESIGN.md` — events table seed values, bracket wiring spec
4. `scripts/seed-events.js` — currently-seeded event names/genders/age groups/format types
5. `scripts/seed-matches.js` — currently-seeded singles R1 matchups for E1, E3, E4, E6, E7
6. `scripts/seed-teams.js` — already correct as of last patch (handles E2, E5, E8). **Do not modify.** Just verify.
7. `src/lib/bracketWiring.ts` — wiring config per event code
8. `src/screens/Standings/StandingsScreen.tsx`, `src/screens/Brackets/*`, `src/screens/EventControl/*` — anywhere that branches on event code
9. The reference file `playSchedule.xlsx` if available, or the schedule extract below

After reading, run a search across the codebase:
- `grep -rn "E1\|E2\|E3\|E4\|E5\|E6\|E7\|E8" src/ scripts/ docs/`
- `grep -rn "U11 Boys Doubles\|U13 Boys\|U15 Boys\|U11 Girls\|U13.*U15.*Girls\|Girls Doubles"`

Build a list of every place the event code → name mapping is referenced. That list is your fix list.

---

## What probably needs to change

This is the most likely set of edits, but **trust the code over this list.**

### `scripts/seed-events.js`

The `events` table seed must match the canonical mapping. Each event row needs:

```
E1: name='U11 Boys Singles',         format_type='knockout', gender='M',     age_group='U11',    court_pool='boys'
E2: name='U11 Boys Doubles',         format_type='hybrid',   gender='M',     age_group='U11',    court_pool='boys',  depends_on=[E1]
E3: name='U13 Boys Singles',         format_type='hybrid',   gender='M',     age_group='U13',    court_pool='boys'
E4: name='U15 Boys Singles',         format_type='hybrid',   gender='M',     age_group='U15',    court_pool='boys'
E5: name='U13/U15 Boys Doubles',     format_type='hybrid',   gender='M',     age_group='mixed',  court_pool='boys',  depends_on=[E3,E4]
E6: name='U11 Girls Singles',        format_type='rr',       gender='F',     age_group='U11',    court_pool='girls'
E7: name='U13/U15 Girls Singles',    format_type='hybrid',   gender='F',     age_group='mixed',  court_pool='girls', handicap_rule='P1,P2:3-0'
E8: name='Girls Doubles',            format_type='rr',       gender='F',     age_group='mixed',  court_pool='girls', depends_on=[E6,E7]
```

Note: enum values in the schema are `gender_mixed_t = 'M' | 'F' | 'mixed'` and `age_group_mixed_t = 'U11' | 'U13' | 'U15' | 'mixed'`. Use `'mixed'` for E5/E7/E8 age_group; gender is single-value per event.

### `scripts/seed-matches.js`

Must seed singles for E1, E3, E4, E6, E7. (E2/E5/E8 are seeded by `seed-teams.js` — do not duplicate.)

**E1** (U11 Boys Singles, 14 players, no bye, full R1 with BLP):
```
R1.1: P1-U11-B  vs P14-U11-B
R1.2: P2-U11-B  vs P13-U11-B
R1.3: P3-U11-B  vs P12-U11-B
R1.4: P4-U11-B  vs P11-U11-B
R1.5: P5-U11-B  vs P10-U11-B
R1.6: P6-U11-B  vs P9-U11-B
R1.7: P7-U11-B  vs P8-U11-B
```
All R1 status='ready', match_format='set21'.
QF1–QF4, SF1, SF2, F, 3P all status='pending', match_format per matrix.
BLP not seeded — created by `fire_blp` RPC at runtime.
Consolation pools/matches not seeded — created by `generate_consolation_pools` RPC.

**E3, E4, E7** (singles, 7 players, P1 bye, hybrid):
Use the same shape as E2/E5 in `seed-teams.js` but with players instead of teams.

E3 R1:
```
BYE:  P1-U13-B (status=complete, winner_id=P1, no scores)
R1.1: P2-U13-B vs P7-U13-B
R1.2: P3-U13-B vs P6-U13-B
R1.3: P4-U13-B vs P5-U13-B
SF1:  P1-U13-B vs Winner:R1.1   (p1_id=P1 already resolved)
SF2:  Winner:R1.2 vs Winner:R1.3
F:    Winner:SF1 vs Winner:SF2
3P:   Loser:SF1 vs Loser:SF2
ConRR.1: Loser:R1.1 vs Loser:R1.2
ConRR.2: Loser:R1.1 vs Loser:R1.3
ConRR.3: Loser:R1.2 vs Loser:R1.3
ConF:    Top1:ConRR vs Top2:ConRR
```

E4 R1: same shape, swap `P*-U13-B` for `P*-U15-B`.

E7 R1: same shape, swap for `P*-U13U15-G`. Additionally:
- All R1, SF, F, 3P, ConRR, ConF matches involving P1 or P2 → `handicap_applied = true`
- Specifically: BYE (P1), R1.1 winner-side may be P2 if P2 wins R1.1, SF1 (always involves P1), F (always involves P1 OR P2 if seeding holds)
- Simplest implementation: stamp `handicap_applied = true` on every E7 match. The flag means "P1/P2 starts at 3-0 if they're in this match" — non-P1/P2 matches with the flag set are no-ops since neither player is P1 or P2.

Match formats for hybrid 7-player events: R1=set21, SF=set30, F=best_of_3x15, 3P=set30, ConRR=set21, ConF=set30.

**E6** (U11 Girls Singles, 3 players, full RR, no bracket):
```
RR.1: P1-U11-G vs P2-U11-G   status=ready  format=set21
RR.2: P1-U11-G vs P3-U11-G   status=ready  format=set21
RR.3: P2-U11-G vs P3-U11-G   status=ready  format=set21
```
No SF, F, 3P, or consolation. Standings determine podium.

### `src/lib/bracketWiring.ts`

Each `EventWiring` entry needs to be checked against the canonical mapping.

- **E1** wiring: 7 R1 → QF (winners) + BLP slot + consolation pools (most complex)
- **E2, E3, E4, E5, E7** wiring: same structure (3 R1 → SF + ConRR; SF → F + 3P; ConRR → ConF)
- **E6, E8** wiring: empty arrays (pure RR, no progression)

For the standard hybrid 7-entrant wiring, the rules are:
```
R1.1.winner → SF1.p2     R1.1.loser → ConRR.slot1
R1.2.winner → SF2.p1     R1.2.loser → ConRR.slot2
R1.3.winner → SF2.p2     R1.3.loser → ConRR.slot3
SF1.winner → F.p1        SF1.loser → 3P.p1
SF2.winner → F.p2        SF2.loser → 3P.p2
ConRR.top1 → ConF.p1
ConRR.top2 → ConF.p2
```

(Note: SF1.p1 is resolved at seed time as the bye holder, no wiring rule needed for it.)

If the existing wiring file has E2 wired as singles or E4 wired as doubles, it's wrong and needs rewriting against the canonical mapping.

### Documentation files

Search and replace any references to old event mappings across all `.md` files in `docs/`. Common things to look for:
- "E2 — U13 Boys Singles" or any non-canonical name
- "E4 — U11 Boys Doubles" (this was the old wrong mapping)
- "P7 gets the bye" or "T7 gets the bye" — both wrong, T1/P1 gets the bye

### UI components

Anywhere event labels are rendered, verify they use the canonical names. The `events.name` column should be the source of truth — UI should read from DB, not hardcode names. If UI has hardcoded event names anywhere, that's a separate bug worth filing.

---

## Re-seed in correct order

After all code/script changes:

```powershell
# Run from project root, with .env.local set
node --env-file=.env.local scripts/seed-players.js
node --env-file=.env.local scripts/seed-events.js
node --env-file=.env.local scripts/seed-matches.js
node --env-file=.env.local scripts/seed-teams.js
```

Each script must be re-runnable safely. If any throw, fix and re-run. Order matters because:
- events depends on nothing
- matches depends on events + players
- teams depends on events + players, then deletes/inserts matches for E2/E5/E8

---

## Verification queries

Run these in Supabase SQL editor after re-seeding. **All must pass before proceeding.**

### 1. Event names match canonical mapping
```sql
select code, name, format_type, gender, age_group
from events
order by code;
```
Expected:
- E1 — U11 Boys Singles, knockout, M, U11
- E2 — U11 Boys Doubles, hybrid, M, U11
- E3 — U13 Boys Singles, hybrid, M, U13
- E4 — U15 Boys Singles, hybrid, M, U15
- E5 — U13/U15 Boys Doubles, hybrid, M, mixed
- E6 — U11 Girls Singles, rr, F, U11
- E7 — U13/U15 Girls Singles, hybrid, F, mixed
- E8 — Girls Doubles, rr, F, mixed

### 2. R1 matchups match the schedule
```sql
select e.code, m.bracket_slot, m.p1_ref, m.p2_ref, m.status
from matches m
join events e on m.event_id = e.id
where m.round in ('R1', 'BYE')
order by e.code, m.bracket_slot;
```
Spot-check against the schedule extract below. Every row must match.

### 3. Bye holders are P1/T1, never P7/T7
```sql
select e.code, m.bracket_slot, m.p1_ref, m.winner_id, m.status
from matches m
join events e on m.event_id = e.id
where m.bracket_slot = 'BYE';
```
Expected: 5 rows (E2, E3, E4, E5, E7). Each `p1_ref` should reference T1 or P1. Each row should have `status='complete'` and `winner_id` set.

### 4. Match counts match the design
```sql
select e.code, count(*) as match_count
from matches m
join events e on m.event_id = e.id
group by e.code
order by e.code;
```
Expected:
```
E1:  7 R1 + 4 QF + 2 SF + F + 3P = 15  (BLP + consolation added at runtime)
E2:  1 BYE + 3 R1 + 2 SF + F + 3P + 3 ConRR + ConF = 11
E3:  same shape = 11
E4:  same shape = 11
E5:  same shape = 11
E6:  3 RR = 3
E7:  same as E3 = 11
E8:  10 RR + F + 3P = 12
TOTAL pre-runtime = 85   (8 BLP/consolation matches added during play → 93 total)
```
If any count is off, the seed scripts are wrong.

### 5. E7 handicap flagged
```sql
select bracket_slot, p1_ref, p2_ref, handicap_applied
from matches m
join events e on m.event_id = e.id
where e.code = 'E7'
order by bracket_slot;
```
Every E7 row should have `handicap_applied=true`.

### 6. Teams seeded for E2, E5, E8 only
```sql
select e.code, count(*) as team_count
from teams t
join events e on t.event_id = e.id
group by e.code
order by e.code;
```
Expected:
- E2: 7
- E5: 7
- E8: 5
No other event should have teams.

---

## Schedule extract (canonical reference)

Pulled from `playSchedule.xlsx`. Use this to verify every R1 matchup.

**E1 R1 (no bye, 7 matches):**
```
P1-U11-B vs P14-U11-B
P2-U11-B vs P13-U11-B
P3-U11-B vs P12-U11-B
P4-U11-B vs P11-U11-B
P5-U11-B vs P10-U11-B
P6-U11-B vs P9-U11-B
P7-U11-B vs P8-U11-B
```

**E2 R1 (T1 bye):**
```
T2-U11-B vs T7-U11-B
T3-U11-B vs T6-U11-B
T4-U11-B vs T5-U11-B
```

**E3 R1 (P1 bye):**
```
P2-U13-B vs P7-U13-B
P3-U13-B vs P6-U13-B
P4-U13-B vs P5-U13-B
```

**E4 R1 (P1 bye):**
```
P2-U15-B vs P7-U15-B
P3-U15-B vs P6-U15-B
P4-U15-B vs P5-U15-B
```

**E5 R1 (T1 bye):**
```
T2-U13U15-B vs T7-U13U15-B
T3-U13U15-B vs T6-U13U15-B
T4-U13U15-B vs T5-U13U15-B
```

**E6 RR (3 matches):**
```
P1-U11-G vs P2-U11-G
P1-U11-G vs P3-U11-G
P2-U11-G vs P3-U11-G
```

**E7 R1 (P1 bye, all marked ★ if P1 or P2 in match):**
```
P2-U13U15-G vs P7-U13U15-G
P3-U13U15-G vs P6-U13U15-G
P4-U13U15-G vs P5-U13U15-G
```

**E8 RR (10 matches):**
```
T1-G vs T2-G    T2-G vs T3-G    T3-G vs T4-G
T1-G vs T3-G    T2-G vs T4-G    T3-G vs T5-G
T1-G vs T4-G    T2-G vs T5-G    T4-G vs T5-G
T1-G vs T5-G
```

---

## Demo-mode E2E (mandatory before declaring done)

1. Reset: open admin URL with `?demo=true`, click Reset Tournament
2. Open public site: confirm event list shows the canonical 8 names in the right order
3. Open Brackets tab, switch through E1–E8: each should show the right format and entrant pool
4. For each event, simulate enough matches to trigger downstream logic:
   - **E1:** simulate all 7 R1 → fire BLP → simulate BLP → fire Generate Consolation Pools → confirm Pool A and Pool B exist with correct entrants → simulate to F + ConFinal → publish podium
   - **E2:** simulate 3 R1 → confirm SF1 has T1 vs R1.1 winner → simulate SF/F/3P/ConRR/ConF → publish
   - **E3:** same shape as E2 with U13 boys
   - **E4:** same shape with U15 boys
   - **E5:** same shape with U13/U15 doubles teams
   - **E6:** simulate 3 RR → standings determine podium → publish
   - **E7:** confirm handicap banner shows on P1/P2 matches → simulate full bracket → publish
   - **E8:** lock draw if not yet locked → simulate 10 RR → standings → simulate F + 3P → publish
5. Confirm Champion Board shows all 8 published podiums with the right event names

If anything is off — wrong event name, wrong R1 matchup, wrong format, missing handicap, podium attached to wrong event — stop and report.

---

## What NOT to do

- Don't change `seed-teams.js` further. It's correct as of the last patch.
- Don't change the schedule. The schedule was distributed publicly. Code conforms to schedule.
- Don't try to merge this with the consolation standings fix in one pass. Two separate concerns, two separate commits.
- Don't auto-resolve discrepancies between docs and code by changing the docs to match wrong code. The schedule is truth.
- Don't add a `name` to the events table that's different from the canonical name above. UI will inherit whatever's in the DB.
- Don't skip the verification queries. They're cheap and they catch silent corruption.

---

## Commit message

```
fix: align event code mapping with public schedule

Codebase had E1–E8 mapped against an old design. The schedule shared
publicly with parents uses a different mapping (E2=U11 Doubles,
E4=U15 Singles, etc.). Reconcile seed-events, seed-matches,
bracketWiring, and docs to match the schedule.

Schedule is source of truth — distributed and cannot change.

Verified end-to-end in demo mode: all 8 events seeded with correct
R1 matchups, bye holders (T1/P1), match formats, and bracket wiring.
```

---

## After this is done

Run the consolation standings fix (`HANDOFF_FIX_CONSOLATION_STANDINGS.md`). The standings fix assumes event mapping is correct, so it must come second.

If you find that the codebase was actually already correct and only the docs were wrong, the fix is documentation-only — but verify against the schedule before declaring that.
