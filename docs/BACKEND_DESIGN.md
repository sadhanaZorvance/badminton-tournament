# BACKEND_DESIGN.md — West End Badminton Club Tournament App
Generated: April 2026
Status: Phase 4 Complete / Pending User Approval
Source: REQUIREMENTS.md (Phase 3) + HL-design.md (v1, April 2026)
Pipeline: Zorvance Product Development Pipeline — Phase 4

---

## OPERATIONAL PRINCIPLE

**Zero manual DB intervention required during the event.**
All state transitions, error recovery, and edge case handling must be resolvable through the app UI itself. No Supabase dashboard access is assumed during the 6-hour tournament window. Every multi-table write is wrapped in a Postgres transaction. Every failure surfaces a retry path in the UI.

---

## SYSTEM ARCHITECTURE

```
┌─────────────────────────────────────────────────────┐
│                  React + TypeScript                  │
│                   (Vercel hosting)                   │
│                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Public UI  │  │  Court Admin │  │  Top Admin │  │
│  │  /          │  │  /ca[secret] │  │  /ta[secret│  │
│  └─────────────┘  └──────────────┘  └────────────┘  │
│                                                      │
│  Client-side:                                        │
│  - All read queries (Supabase JS)                    │
│  - Single-table writes (Supabase JS)                 │
│  - Standings computation                             │
│  - Bracket rendering from wiring config              │
│  - Validation before any write                       │
└──────────────────────┬──────────────────────────────┘
                       │ Supabase JS client
                       │ Realtime subscriptions
                       │ RPC calls
┌──────────────────────▼──────────────────────────────┐
│                    Supabase                          │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │              Postgres (RLS enforced)         │    │
│  │                                              │    │
│  │  players  events  matches  sets              │    │
│  │  teams    pools   pool_entrants              │    │
│  │  podiums  audit_log  trigger_records         │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │         Postgres RPC Functions               │    │
│  │  (atomic multi-table writes, transactions)   │    │
│  │                                              │    │
│  │  complete_match      cascade_edit_match      │    │
│  │  fire_blp            generate_consolation_   │    │
│  │  lock_e8_draw        pools                   │    │
│  │  publish_podium      unpublish_podium         │    │
│  │  reset_tournament    set_role                 │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │              Supabase Realtime               │    │
│  │  Subscriptions on: matches, sets, podiums    │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Hosting:** Vercel (React app)
**Backend:** Supabase (Postgres + Realtime)
**No Edge Functions.** All server-side logic runs as Postgres RPC functions inside transactions.

---

## ARCHITECTURE DECISIONS

### Decision 1: Bracket Wiring Location
**Choice:** Static JSON config in codebase
**Rationale:** 8 fixed events with known structures. Dynamic wiring buys nothing for v1 and adds query complexity to every auto-progression operation.
**Hard to reverse:** Medium — changing to DB-driven later requires migration and refactor of all progression logic.

### Decision 2: Standings Computation
**Choice:** Recompute on read, client-side
**Rationale:** 38 players, 93 matches max. Computation is trivial at this scale. Eliminates stale-data bugs entirely, especially during cascade edits.
**Hard to reverse:** Low.

### Decision 3: Concurrency on Match Start
**Choice:** Optimistic locking via conditional UPDATE WHERE status = 'ready'
**Rationale:** Atomic at Postgres level. If 0 rows updated, match was already claimed — return conflict error. Simple and sufficient.
**Hard to reverse:** Low.

### Decision 4: Real-time Delivery
**Choice:** Supabase Realtime subscriptions + 30-second polling fallback
**Rationale:** Subscriptions as primary, polling as safety net. Handles gym wifi unreliability gracefully.
**Hard to reverse:** Low.

### Decision 5: Business Logic Location
**Choice:** Client-side for reads and single-table writes. Postgres RPC functions for all multi-table atomic writes. No Edge Functions.
**Rationale:** RPC functions run inside Postgres — no cold starts, no deployment surface, no network hops between steps. Client handles UI state, validation, and reads. All multi-table mutations are transactional, eliminating partial write risk. Zero manual DB intervention needed during the event.
**Hard to reverse:** Low.

---

## MATCH FORMAT MATRIX

**Correction from HL-design.md:** U13/U15 SF and 3rd place matches are set-to-30 (not best-of-3x15 as originally stated). Only Finals use best-of-3x15.

```
Match type                          Format          match_format value
──────────────────────────────────────────────────────────────────────
RR / pool / R1                      First to 21     set21
U11 knockouts (QF, SF, 3P)          First to 30     set30
U13/U15 SF + 3rd place              First to 30     set30
All Finals (any age/gender)         Best of 3x15    best_of_3x15
Consolation RR matches              First to 21     set21
Consolation final (any event)       First to 30     set30
BLP match                           First to 21     set21
```

Set 2 and Set 3 in the `sets` table are only ever created for `best_of_3x15` matches (Finals only).

---

## DATA MODEL

### Table: players
**Purpose:** Every individual child competing in the tournament.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| code | text | Unique. Internal only — never displayed in UI. Used to match against physical draw sheets. |
| full_name | text | Raw input from CSV e.g. "Aarav Kumar Sharma" |
| first_name | text | Parsed from full_name (always part 1) |
| middle_name | text, nullable | Part 2 if 3 parts; parts 2+3 if 4 parts |
| last_name | text, nullable | Last part if 2+ parts |
| display_name | text | Computed by seed script. See disambiguation rules below. |
| age_group | enum | U11 \| U13 \| U15 |
| gender | enum | M \| F |
| status | enum | active \| withdrawn |
| created_at | timestamptz | |

**Name parsing rules:**
- 1 part: first_name=part1, middle_name=null, last_name=null
- 2 parts: first_name=part1, last_name=part2
- 3 parts: first_name=part1, middle_name=part2, last_name=part3
- 4 parts: first_name=part1, middle_name=part2+" "+part3, last_name=part4

**Display name disambiguation (computed globally across all 38 players):**
1. first_name unique across all players → display_name = first_name
2. Duplicate first_name, unique last initial → display_name = first_name + " " + last_name[0] + "."
3. Duplicate first_name AND duplicate last initial → display_name = first_name + " " + last_name
4. Duplicate first_name, no last_name → display_name = full_name (script emits warning)

**Seed mechanism:** CSV file with columns `code, full_name, age_group, gender`. Node.js seed script `/scripts/seed-players.js` parses names, computes disambiguation globally, upserts on `code` conflict. Re-runnable safely.

**Ownership:** Seeded at setup via service role. Status updated by Top Admin (withdrawal) at runtime. No runtime creation of player rows.

**Business rules:** BR-027 (code never in UI), BR-028 (disambiguation baked into display_name)

---

### Table: teams
**Purpose:** Doubles pairs competing in E8 (Girls Doubles).

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| event_id | uuid | FK → events |
| player1_id | uuid | FK → players |
| player2_id | uuid | FK → players |
| display_name | text | "Player1.display_name & Player2.display_name" |
| status | enum | active \| withdrawn |
| created_at | timestamptz | |

**Ownership:** Created atomically by lock_e8_draw RPC. Status updated by Top Admin (withdrawal).

**Business rules:** BR-021 (composition constraints validated before creation), BR-027

---

### Table: events
**Purpose:** The 8 competition categories. Mostly static config, status updated as tournament progresses.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| code | text | Unique. E1–E8. |
| name | text | e.g. "U11 Boys Singles" |
| format_type | enum | knockout \| rr \| hybrid |
| gender | enum | M \| F \| mixed |
| age_group | enum | U11 \| U13 \| U15 \| mixed |
| status | enum | pending \| active \| complete \| published |
| depends_on | uuid[] | FK → events. Gate dependencies. |
| court_pool | enum | boys \| girls \| any. Soft scheduling hint. |
| handicap_rule | text, nullable | e.g. "P1,P2:3-0" — identifies which player codes get the head start |
| draw_locked | boolean | Default false. E8 specific. |
| created_at | timestamptz | |

**Ownership:** Seeded at setup. Status updated by client-side logic on match completion and trigger fires.

**Business rules:** BR-012, BR-018, BR-020, BR-024, BR-031

---

### Table: matches
**Purpose:** Every contest in the tournament — seeded matches plus BLP and consolation matches generated at runtime.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| event_id | uuid | FK → events |
| round | text | "R1" \| "QF" \| "SF" \| "F" \| "3P" \| "BLP" \| "ConRR" \| "ConF" |
| bracket_slot | text | Unique within event. e.g. "QF1", "SF2". Used by wiring config. |
| pool_id | uuid, nullable | FK → pools. Set for consolation RR matches. |
| court | text, nullable | C1–C5. Set when match starts. Attribute on match, not a separate entity. |
| p1_ref | text | Placeholder string e.g. "Winner:QF1" or player/team id. Retained after resolution. |
| p2_ref | text | Same as p1_ref. |
| p1_id | uuid, nullable | FK → players or teams. Null until resolved. |
| p2_id | uuid, nullable | FK → players or teams. Null until resolved. |
| p1_type | enum, nullable | player \| team. Disambiguates FK target. |
| p2_type | enum, nullable | player \| team. |
| score_sets | jsonb | Denormalised snapshot: [{p1: int, p2: int, complete: bool}]. Updated on every set save. Fast read for real-time display. |
| winner_id | uuid, nullable | Resolved when complete. |
| winner_type | enum, nullable | player \| team. |
| match_format | enum | set21 \| set30 \| best_of_3x15. Fixed at creation. |
| handicap_applied | boolean | Default false. True for E7 P1/P2 matches. |
| status | enum | pending \| ready \| in_progress \| complete \| walkover \| retired |
| inconsistent | boolean | Default false. Flagged true by Leave cascade. |
| started_at | timestamptz, nullable | |
| completed_at | timestamptz, nullable | |
| started_by | text, nullable | Admin display name from localStorage. |
| entered_by | text, nullable | Last admin to enter a score. |
| edit_history | jsonb | Append-only array: [{actor, timestamp, before, after}] |
| created_at | timestamptz | |

**p1_ref / p2_ref retention:** Both fields retained after resolution. p1_ref = "Winner:QF1", p1_id = resolved uuid. p1_id is operative for all logic. p1_ref is read-only context for bracket rendering and audit.

**score_sets vs sets table:** score_sets jsonb is a denormalised snapshot for fast reads. The sets table is the source of truth. Both updated atomically on every set save.

**Ownership:**
- pending→ready: client resolves when both refs resolve (triggered by complete_match RPC)
- ready→in_progress: court admin or top admin (optimistic lock: UPDATE WHERE status='ready')
- score_sets / sets: court admin (own in_progress match) or top admin (any non-published event)
- complete/walkover/retired: via RPC functions
- edit_history: append-only, never overwritten

**Business rules:** BR-004, BR-005, BR-006, BR-007, BR-008, BR-009, BR-010, BR-011, BR-012, BR-013, BR-014, BR-015, BR-016, BR-022, BR-023, BR-032

---

### Table: sets
**Purpose:** Individual set results within a match. Source of truth for score validation.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| match_id | uuid | FK → matches |
| set_number | integer | 1, 2, or 3 |
| p1_score | integer | |
| p2_score | integer | |
| target_score | integer | 21, 30, or 15. Fixed at set creation from match_format. |
| complete | boolean | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Edit behaviour:** Overwrite on edit — no versioning (BR-032). Before/after values captured in matches.edit_history audit entry.

**Set 2 / Set 3:** Only created for best_of_3x15 matches (Finals only). Set 3 created only when each player has won exactly one set after Set 2.

**Ownership:** Court admin (own in_progress match) or top admin. Written via direct Supabase JS upsert (single-table write).

**Business rules:** BR-010, BR-011, BR-013, BR-032

---

### Table: pools
**Purpose:** Sub-groups within consolation rounds.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| event_id | uuid | FK → events |
| label | text | "A", "B", or "Main" |
| created_at | timestamptz | |

**Pool sizes:** E1 → Pool A + Pool B (3 players each). E2/E3/E4/E5/E7 → single "Main" pool (3 players).

**Ownership:** Created atomically by generate_consolation_pools RPC. Immutable after creation.

**Business rules:** BR-031

---

### Table: pool_entrants
**Purpose:** Which players are assigned to which pool.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| pool_id | uuid | FK → pools |
| entrant_id | uuid | player_id or team_id |
| entrant_type | enum | player \| team |
| created_at | timestamptz | |

**Ownership:** Created atomically with pools. Never updated.

**Business rules:** BR-017 (idempotent — created once only)

---

### Table: podiums
**Purpose:** Final ranked result per event.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| event_id | uuid | Unique FK → events |
| gold_id | uuid, nullable | player_id or team_id |
| silver_id | uuid, nullable | |
| bronze_id | uuid, nullable | |
| consolation_winner_id | uuid, nullable | |
| gold_type | enum, nullable | player \| team |
| silver_type | enum, nullable | player \| team |
| bronze_type | enum, nullable | player \| team |
| status | enum | draft \| published |
| published_by | text, nullable | Admin name string |
| published_at | timestamptz, nullable | |
| created_at | timestamptz | |

**Auto-draft:** Created as draft automatically when the final relevant match completes (inside complete_match RPC — checks if all event matches done, then inserts podium row).

**Ownership:** Auto-created as draft by complete_match RPC. Published/unpublished by Top Admin via publish_podium / unpublish_podium RPCs.

**Business rules:** BR-022, BR-024, BR-030

---

### Table: audit_log
**Purpose:** Immutable append-only record of every significant admin action.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| timestamp | timestamptz | Default now() |
| action_type | text | See action types below |
| match_id | uuid, nullable | FK → matches |
| event_id | uuid, nullable | FK → events |
| actor_name | text | Admin name from localStorage |
| payload | jsonb | Action-specific detail |
| created_at | timestamptz | |

**Action types:**
- match_started, set_entered, set_edited, match_completed
- match_walkover, match_retired
- match_cascaded, match_inconsistent_flagged
- trigger_blp, trigger_consolation_pools, trigger_e8_draw
- podium_drafted, podium_published, podium_unpublished

**Payload examples:**
- set_edited: {set_number, before: {p1, p2}, after: {p1, p2}}
- match_cascaded: {affected_match_ids: [], choice: "cascade", before_winner_id, after_winner_id}
- trigger_blp: {rankings: [{player_id, margin}], blp_match_id}

**Ownership:** Append-only. Never updated, never deleted. Written by client (single-table inserts) and by RPC functions internally. RLS blocks UPDATE and DELETE for all roles.

**Business rules:** BR-017, BR-023, BR-032

---

### Table: trigger_records
**Purpose:** Idempotency guard for one-time triggers.

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| event_id | uuid | FK → events |
| trigger_type | enum | blp \| consolation_pools \| e8_draw \| podium_publish |
| fired_by | text | Admin name string |
| fired_at | timestamptz | |
| payload | jsonb, nullable | Result summary e.g. BLP rankings, pool assignments |

**Unique constraint:** (event_id, trigger_type) — prevents duplicate trigger records at DB level.

**Ownership:** Written once by RPC functions. Never updated. podium_publish record deleted by unpublish_podium RPC (service role). RLS blocks all other deletes.

**Business rules:** BR-017, BR-018, BR-019, BR-020, BR-021

---

### DB Size Estimate
```
players           38 rows (seeded)
teams             5 rows max (E8 pairs, created at draw lock)
events            8 rows (seeded)
matches           ~110 rows (93 seeded + BLP + consolation)
sets              ~120 rows (created at score entry)
pools             9 rows max (E1×2 + 7 events×1)
pool_entrants     27 rows max
podiums           8 rows (auto-created as draft)
audit_log         ~500 rows (unbounded, append-only)
trigger_records   32 rows max (4 trigger types × 8 events)
```
Total: well within Supabase free tier.

---

## STATIC BRACKET WIRING CONFIG

Bracket wiring is a static JSON config loaded at app start. One config object per event. The client uses this to determine downstream slots on match completion.

```javascript
// Example: E3 (U13 Boys Singles)
{
  event: "E3",
  wiring: [
    { source: "R1.1", sourceResult: "winner", target: "SF1", targetSlot: "p2" },
    { source: "R1.1", sourceResult: "loser",  target: "ConRR.main", targetSlot: "slot1" },
    { source: "R1.2", sourceResult: "winner", target: "SF2", targetSlot: "p1" },
    { source: "R1.2", sourceResult: "loser",  target: "ConRR.main", targetSlot: "slot2" },
    { source: "R1.3", sourceResult: "winner", target: "SF2", targetSlot: "p2" },
    { source: "R1.3", sourceResult: "loser",  target: "ConRR.main", targetSlot: "slot3" },
    { source: "SF1",  sourceResult: "winner", target: "F",   targetSlot: "p1" },
    { source: "SF1",  sourceResult: "loser",  target: "3P",  targetSlot: "p1" },
    { source: "SF2",  sourceResult: "winner", target: "F",   targetSlot: "p2" },
    { source: "SF2",  sourceResult: "loser",  target: "3P",  targetSlot: "p2" },
    { source: "ConRR.main", sourceResult: "top1", target: "ConF", targetSlot: "p1" },
    { source: "ConRR.main", sourceResult: "top2", target: "ConF", targetSlot: "p2" }
  ]
}
```

E1 wiring is more complex — includes BLP slot and two consolation pool paths. Defined separately in config.

The complete_match RPC receives the bracket_slot of the completed match, looks up the wiring config, and applies the downstream resolution within the same transaction.

---

## RPC FUNCTIONS (Atomic Multi-Table Writes)

All RPC functions run in a single Postgres transaction. All-or-nothing. If any step fails, the entire transaction rolls back. Client receives a clean error and can retry safely.

---

### RPC: set_role(role text)
**Purpose:** Set session variable for RLS policy evaluation
```sql
SET app.user_role = role;
```
Called by client immediately after PIN verification. Governs all subsequent RLS checks for that connection.

---

### RPC: start_match(match_id, court, admin_name)
**Purpose:** Transition ready → in_progress with optimistic lock
```
Steps:
  1. UPDATE matches SET status='in_progress', court=$court,
     started_at=now(), started_by=$admin_name
     WHERE id=$match_id AND status='ready'
  2. If 0 rows updated → raise exception 'MATCH_ALREADY_CLAIMED'
  3. INSERT audit_log {action_type: 'match_started'}
Returns: {success: bool}
Errors: MATCH_ALREADY_CLAIMED → "Match already started by another admin"
```

---

### RPC: submit_set(match_id, set_number, p1_score, p2_score, admin_name)
**Purpose:** Upsert a set result, update denormalised snapshot
```
Steps:
  1. Verify match status = 'in_progress'
  2. Read existing set row for before-value (audit)
  3. UPSERT sets (match_id, set_number)
     SET p1_score, p2_score, complete=true, updated_at=now()
  4. UPDATE matches SET score_sets=$recomputedJsonb,
     entered_by=$admin_name
  5. INSERT audit_log {action_type: 'set_entered' or 'set_edited',
     payload: {set_number, before, after}}
Returns: {success: bool}
Errors: match not in_progress → exception
```

---

### RPC: complete_match(match_id, winner_id, winner_type, admin_name, downstream_updates, loser_downstream_updates)
**Purpose:** Complete match + resolve all downstream slots atomically
```
Parameters:
  p_downstream_updates       — slots that should receive the WINNER
                               (e.g. SF1.winner → F.p1)
  p_loser_downstream_updates — slots that should receive the LOSER
                               (e.g. SF1.loser → 3P.p1)
  Both are computed client-side from src/lib/bracketWiring.ts via
  getDownstreamSlots(eventCode, bracketSlot, 'winner' | 'loser').
  Each item: { match_id: uuid, slot: 'p1' | 'p2' }.

Steps:
  1. Verify match status = 'in_progress' (else MATCH_NOT_IN_PROGRESS)
  2. Validate p_winner_id is one of the two opponents (else INVALID_WINNER)
  3. Derive loser_id/loser_type from match record
  4. UPDATE matches SET status='complete', winner_id, winner_type,
     completed_at=now(), entered_by=admin_name
  5. _resolve_downstream(winner_id, winner_type, p_downstream_updates)
  6. _resolve_downstream(loser_id,  loser_type,  p_loser_downstream_updates)
     Each helper call: for every {match_id, slot} update sets p1/p2 on
     the target match. When both p1_id+p2_id are non-null on a pending
     match, flip its status to 'ready'.
  7. INSERT audit_log {action_type: 'match_completed'}
  8. _maybe_draft_podium: if every event match is in a terminal state and
     no podium exists yet, INSERT podiums {status='draft',
     gold/silver/bronze derived from F + 3P + ConF winners}
     and INSERT audit_log {action_type: 'podium_drafted'}.
Returns: {success: bool, downstream_updated: int, podium_drafted: bool}
Errors: MATCH_NOT_IN_PROGRESS, MATCH_NOT_FOUND, INVALID_WINNER,
        INVALID_ADMIN_NAME — transaction failure → full rollback
```

---

### RPC: record_walkover(match_id, winner_id, winner_type, admin_name, downstream_updates, loser_downstream_updates)
**Purpose:** Complete match as walkover, no scores
```
Steps:
  1. UPDATE matches SET status='walkover', winner_id, winner_type,
     score_sets='[]', completed_at, entered_by
  2. Same downstream + loser resolution as complete_match
  3. INSERT audit_log {action_type: 'match_walkover'}
  4. _maybe_draft_podium
Returns: {success, downstream_updated, podium_drafted}
```

---

### RPC: record_retirement(match_id, winner_id, winner_type, partial_sets, admin_name, downstream_updates, loser_downstream_updates)
**Purpose:** Complete match as retirement with optional partial scores
```
Steps:
  1. If partial_sets provided: UPSERT sets rows for each
  2. UPDATE matches SET status='retired', winner_id, winner_type,
     score_sets=recomputed snapshot, completed_at, entered_by
  3. Same downstream + loser resolution as complete_match
  4. INSERT audit_log {action_type: 'match_retired'}
  5. _maybe_draft_podium
Returns: {success, downstream_updated, podium_drafted}
```

---

### RPC: cascade_edit_match(match_id, new_score_sets, new_winner_id, admin_name, cascade bool)
**Purpose:** Edit completed match result; cascade or flag downstream atomically
```
Steps:
  1. Verify event.status != 'published' (else raise EVENT_PUBLISHED)
  2. Capture before state: current score_sets, winner_id
  3. UPDATE matches SET score_sets=$new, winner_id=$new_winner_id,
     edit_history = edit_history || {actor, timestamp, before, after}
  4. UPDATE sets rows to match new_score_sets
  5a. If cascade=true:
      For each downstream match in wiring config:
        UPDATE matches SET status='ready', winner_id=null,
        score_sets=null, inconsistent=false
        Re-resolve p1_id or p2_id with new_winner_id
      INSERT audit_log {action_type: 'match_cascaded',
        payload: {affected_ids, before_winner, after_winner}}
  5b. If cascade=false:
      For each downstream match:
        UPDATE matches SET inconsistent=true
      INSERT audit_log {action_type: 'match_inconsistent_flagged'}
Returns: {success: bool, affected_matches: uuid[]}
Errors:
  EVENT_PUBLISHED → client shows "unpublish first"
  transaction failure → full rollback, no partial state
```

---

### RPC: get_blp_eligible_losers(event_id)
**Purpose:** Read-only helper. Returns R1 losers eligible for BLP ranking, ordered by point margin ascending (closest matches first). Walkovers and retirements are excluded — only `status='complete'` R1 matches contribute (BR-019).
```
Returns: setof (match_id uuid, player_id uuid, player_type entrant_type_t, margin int)
Margin = abs(score_sets[0].p1 - score_sets[0].p2)
        (R1 matches are always single-set set21, so set 1 is the only set.)
```
Used by: `fire_blp` (UI may also call this directly to preview rankings).

---

### RPC: fire_blp(event_id, admin_name)
**Purpose:** Compute BLP rankings, create BLP match, record trigger
```
Steps:
  1. Check trigger_records (event_id, 'blp') — if exists:
     raise BLP_ALREADY_FIRED with {fired_by, fired_at}
  2. Verify all E1 R1 matches complete/walkover/retired
     If not: raise R1_INCOMPLETE with outstanding match list
  3. Fetch all completed (not walkover) R1 matches
     Compute margin for each loser: abs(winner_score - loser_score)
  4. If fewer than 2 eligible losers:
     raise INSUFFICIENT_ELIGIBLE_PLAYERS
  5. Sort by margin ascending (smallest = closest match)
  6. Top 2 = BLP players
  7. INSERT matches {event_id, round='BLP', p1_id, p2_id,
     status='ready', match_format='set21'}
  8. INSERT trigger_records {event_id, type='blp',
     fired_by, fired_at, payload: {rankings, blp_match_id}}
  9. INSERT audit_log {action_type: 'trigger_blp'}
Returns: {blp_players: [{id, display_name, margin}], blp_match_id}
Errors:
  BLP_ALREADY_FIRED → show "Generated by X at HH:MM"
  R1_INCOMPLETE → show outstanding matches
  INSUFFICIENT_ELIGIBLE_PLAYERS → manual resolution required
```

---

### RPC: generate_consolation_pools(event_id, admin_name)
**Purpose:** Create pools, assign players, generate consolation RR matches
```
Steps:
  1. Check trigger_records (event_id, 'consolation_pools')
     If exists: raise POOLS_ALREADY_GENERATED
  2. Verify BLP match complete
  3. Fetch eligible players:
     - 5 R1 losers ranked 3–7 by BLP margin
     - 1 BLP loser
     = 6 total
  4. If fewer than 6: raise INSUFFICIENT_PLAYERS with shortfall
  5. Randomly shuffle 6 players
  6. INSERT pools: Pool A (players 1–3), Pool B (players 4–6)
  7. INSERT pool_entrants for all 6
  8. Generate RR matches:
     Pool A: 1v2, 1v3, 2v3 (match_format='set21', status='ready')
     Pool B: 4v5, 4v6, 5v6 (match_format='set21', status='ready')
  9. INSERT trigger_records {type:'consolation_pools',
     payload: {pool_a_players, pool_b_players}}
  10. INSERT audit_log {action_type: 'trigger_consolation_pools'}
Returns: {pool_a: [players], pool_b: [players], matches_created: 6}
Errors:
  POOLS_ALREADY_GENERATED → show "Generated by X at HH:MM"
  BLP_NOT_COMPLETE → button disabled
  INSUFFICIENT_PLAYERS → manual resolution, show shortfall
```

---

### RPC: lock_e8_draw(pairs [{p1_id, p2_id}], admin_name)
**Purpose:** Validate composition, create teams, generate 10 E8 RR matches
```
Steps:
  1. Check trigger_records (E8_id, 'e8_draw')
     If exists: raise DRAW_ALREADY_LOCKED
  2. Validate composition:
     Count pairs where p1.age_group=U15 AND p2.age_group=U11 (or vice versa) = 3
     Count pairs where p1.age_group=U15 AND p2.age_group=U13 (or vice versa) = 2
     If invalid: raise INVALID_COMPOSITION with offending pair index
  3. Verify no withdrawn players in any pair
  4. INSERT 5 teams rows, compute display_names
  5. Generate 10 RR matches (all 5-choose-2 combinations):
     T1vT2, T1vT3, T1vT4, T1vT5, T2vT3,
     T2vT4, T2vT5, T3vT4, T3vT5, T4vT5
     All: match_format='set21', status='ready'
  6. UPDATE events SET draw_locked=true, status='active'
  7. INSERT trigger_records {type:'e8_draw'}
  8. INSERT audit_log {action_type: 'trigger_e8_draw'}
Returns: {teams_created: 5, matches_created: 10}
Errors:
  DRAW_ALREADY_LOCKED → show "Generated by X at HH:MM"
  INVALID_COMPOSITION → show offending pair
  WITHDRAWN_PLAYER → show which player
```

---

### RPC: publish_podium(event_id, admin_name)
**Purpose:** Publish podium, lock all event matches
```
Steps:
  1. Verify all event matches complete/walkover/retired
     If not: raise MATCHES_OUTSTANDING with list
  2. Verify podium exists in draft status
  3. UPDATE podiums SET status='published',
     published_by=$admin_name, published_at=now()
  4. UPDATE events SET status='published'
  5. INSERT trigger_records {type:'podium_publish'}
  6. INSERT audit_log {action_type: 'podium_published'}
Returns: {success: bool}
Errors:
  MATCHES_OUTSTANDING → list outstanding matches
  NO_DRAFT_PODIUM → should not occur; log and surface error
```

---

### RPC: unpublish_podium(event_id, admin_name)
**Purpose:** Revert podium to draft, unlock event matches
```
Steps:
  1. Verify podium status = 'published'
  2. UPDATE podiums SET status='draft',
     published_by=null, published_at=null
  3. UPDATE events SET status='complete'
  4. DELETE trigger_records WHERE event_id=$event_id
     AND trigger_type='podium_publish'
  5. INSERT audit_log {action_type: 'podium_unpublished'}
Returns: {success: bool}
Errors:
  PODIUM_NOT_PUBLISHED → exception
```

---

### RPC: reset_tournament() [DEMO MODE ONLY]
**Purpose:** Wipe all runtime data, restore seeded state
```
Steps (single transaction):
  1. DELETE sets
  2. DELETE audit_log
  3. DELETE trigger_records
  4. DELETE pool_entrants
  5. DELETE pools
  6. DELETE podiums
  7. DELETE teams (E8 pairs)
  8. UPDATE matches → reset to seeded state:
     status=pending/ready per seed config, score_sets=null,
     winner_id=null, p1_id/p2_id per seed, court=null,
     edit_history=[], inconsistent=false
  9. UPDATE events SET status='pending'/'active' per seed config
Auth: Only callable when app is running in demo mode (?demo=true)
      Blocked entirely in production.
```

---

## CLIENT-SIDE OPERATIONS (Direct Supabase JS)

### Read Queries

```
getReadyMatches()
  SELECT matches + players/teams display_names
  WHERE status = 'ready'
  ORDER BY: phase → blocking event → round
  Auth: court_admin or top_admin

getInProgressMatches()
  SELECT matches + players/teams + sets
  WHERE status = 'in_progress'
  Auth: public (no auth)

getMatchDetail(match_id)
  SELECT match + sets + audit_log
  Auth: court_admin or top_admin

getBracket(event_id)
  SELECT matches + players/teams
  WHERE event_id = $event_id
  Auth: public

getRawStandingsData(event_id, pool_id?)
  SELECT matches + sets + pool_entrants
  WHERE event_id = $event_id [AND pool_id = $pool_id]
  Returns raw data; standings computed client-side
  Auth: public

getPublishedPodiums()
  SELECT podiums + events + players/teams
  WHERE podiums.status = 'published'
  Auth: public

getTriggerRecord(event_id, trigger_type)
  SELECT trigger_records
  WHERE event_id = $event_id AND trigger_type = $type
  Auth: top_admin
```

### Single-Table Writes (Direct JS Client)
```
updatePlayerStatus(player_id, status)
  UPDATE players SET status = $status
  Auth: top_admin only (RLS enforced)

updateMatchCourt(match_id, court)
  UPDATE matches SET court = $court
  (Used for court warning override — separate from start_match RPC)
  Auth: court_admin or top_admin
```

---

## REAL-TIME SUBSCRIPTIONS

```javascript
// Public site — Now Playing tab
supabase
  .channel('matches-inprogress')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'matches',
    filter: "status=eq.in_progress"
  }, handleUpdate)
  .subscribe()

// Public site — Brackets tab
supabase
  .channel('matches-bracket')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'matches',
    filter: `event_id=eq.${eventId}`
  }, handleUpdate)
  .subscribe()

// Public site — Champion Board tab
supabase
  .channel('podiums')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'podiums'
  }, handleUpdate)
  .subscribe()
```

**Fallback:** All public tabs auto-refresh every 30 seconds as backup to subscription. Manual refresh button always available on every screen (admin and public).

---

## CLIENT-SIDE STANDINGS COMPUTATION

Standings are never stored. Computed fresh on every load from raw match + set data.

```
Input: all matches for event/pool (with sets)
Output: sorted standings array with tiebreaker reasoning

Algorithm:
  1. For each entrant, compute:
     - matches_played: count complete/walkover/retired matches
     - wins: count matches where winner_id = entrant_id
     - losses: matches_played - wins
     - points_for: sum of this entrant's scores across all sets
     - points_against: sum of opponent scores across all sets
     - head_to_head: {opponent_id: 'W'|'L'} for each played match

  2. Sort by:
     a. wins DESC
     b. points_for DESC
     c. head_to_head result (for tied pairs only)

  3. For each tied position, compute tiebreaker_reason string:
     "Ranked above due to: points for 38 vs 35"
     "Ranked above due to: head-to-head win"
     "Three-way tie — unresolvable by standings rules"
       (EC-012: circular head-to-head)

  4. Return sorted array with tiebreaker_reason per row
```

---

## SECURITY & AUTH

### URL-Based Tier Routing
```
/                     → Public site (no auth)
/[courtAdminSecret]   → Court Admin login page
/[topAdminSecret]     → Top Admin login page
```

Secret URL segments are environment variables on Vercel. Not stored in DB. Changed by updating env vars and redeploying (minutes, not DB operations).

### PIN Verification
```
Client-side only:
  1. User enters name + PIN on login page
  2. Client compares PIN against env var (COURT_ADMIN_PIN or TOP_ADMIN_PIN)
     loaded at build time via Vercel env
  3. Match → store {role, name} in localStorage
                → call set_role RPC to set session variable
  4. No match → "Incorrect PIN, try again." No lockout.
```

**Security note:** PINs are in env vars, not in client bundle. Vercel serves them server-side only. The secret URL segment is the first gate — without it, the PIN page is never reached.

### RLS Policies

```sql
-- Session variable set by set_role RPC
-- current_setting('app.user_role') returns 'top_admin' | 'court_admin' | 'public'

-- players: anyone reads, only top_admin updates
CREATE POLICY players_select ON players FOR SELECT USING (true);
CREATE POLICY players_update ON players FOR UPDATE
  USING (current_setting('app.user_role') = 'top_admin');

-- matches: anyone reads
CREATE POLICY matches_select ON matches FOR SELECT USING (true);

-- matches: start (ready→in_progress) — court_admin or top_admin
CREATE POLICY matches_start ON matches FOR UPDATE
  USING (
    status = 'ready' AND
    current_setting('app.user_role') IN ('court_admin', 'top_admin')
  );

-- matches: edit — blocked if event published
CREATE POLICY matches_edit ON matches FOR UPDATE
  USING (
    current_setting('app.user_role') = 'top_admin' AND
    (SELECT status FROM events WHERE id = matches.event_id) != 'published'
  );

-- sets: court_admin writes own in_progress match; top_admin writes any non-published
CREATE POLICY sets_write ON sets FOR ALL
  USING (
    (current_setting('app.user_role') = 'court_admin' AND
     (SELECT status FROM matches WHERE id = sets.match_id) = 'in_progress')
    OR
    (current_setting('app.user_role') = 'top_admin' AND
     (SELECT e.status FROM events e
      JOIN matches m ON m.event_id = e.id
      WHERE m.id = sets.match_id) != 'published')
  );

-- audit_log: anyone inserts, only top_admin selects, nobody updates/deletes
CREATE POLICY audit_insert ON audit_log FOR INSERT
  USING (current_setting('app.user_role') IN ('court_admin', 'top_admin'));
CREATE POLICY audit_select ON audit_log FOR SELECT
  USING (current_setting('app.user_role') = 'top_admin');

-- podiums: anyone reads, only top_admin writes
CREATE POLICY podiums_select ON podiums FOR SELECT USING (true);
CREATE POLICY podiums_write ON podiums FOR ALL
  USING (current_setting('app.user_role') = 'top_admin');

-- trigger_records: only top_admin reads/writes
CREATE POLICY triggers_all ON trigger_records FOR ALL
  USING (current_setting('app.user_role') = 'top_admin');
```

---

## ERROR HANDLING STRATEGY

### Category 1: Validation Errors (client-side, never reach DB)
- Invalid set score (BR-010)
- Mark complete without winning condition (BR-014)
- E8 composition violation (BR-021)
**Handling:** Inline error on the relevant field. No network call made. Form state retained.

### Category 2: Conflict Errors (optimistic lock failures)
- Match already started by another admin (EC-001)
**Handling:** Clear error message. No retry — user picks a different match or court.

### Category 3: Network Failures (request never completed)
- Score submit dropped mid-flight
- RPC call timed out
**Handling:** Red banner immediately. Retry button visible. Form state retained. Safe to retry — all RPCs are transactional (no partial writes possible).

### Category 4: RPC Exceptions (DB raised error)
- Trigger already fired (BR-017)
- Event published, edit blocked (BR-022)
- Insufficient players for BLP/pools (EC-007, EC-008)
- Outstanding matches blocking podium publish (BR-024)
**Handling:** Error message surfaced directly from exception payload. Always actionable — tells admin exactly what is wrong and what to do next.

### Category 5: Realtime Subscription Dropped
- Supabase websocket disconnects
**Handling:** 30-second polling fallback continues silently. Manual refresh always available. No error shown unless polling also fails.

### Category 6: Full Supabase Outage
**Handling:** Operational fallback only — printed paper match sheets. App surfaces a clear "Unable to connect" message with last-known data visible. No data loss (all writes were transactional).

---

## DEMO MODE

**Activation:** URL flag `?demo=true` on any admin URL.

**Features exposed in demo mode only:**
- "Simulate Match" button on every in_progress match → generates random valid score for that match_format → calls submit_set RPC + complete_match RPC
- "Reset Tournament" button → calls reset_tournament() RPC → wipes all runtime data, restores seed state
- Full 93-match dry run completable in ~5 minutes

**Safety:** reset_tournament() RPC is gated at application level — only callable when demo flag is present. Blocked entirely in production URL. Not exposed via RLS to any role in production.

---

## MATCH STATE MACHINE

```
                    ┌─────────┐
                    │ pending │ ← both refs unresolved
                    └────┬────┘
                         │ both refs resolved
                         ▼
                    ┌─────────┐
                    │  ready  │ ← can be started by any admin
                    └────┬────┘
                         │ start_match RPC (optimistic lock)
                         ▼
                  ┌─────────────┐
                  │ in_progress │ ← scores being entered
                  └──────┬──────┘
           ┌─────────────┼──────────────┐
           ▼             ▼              ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │ complete │ │ walkover │ │ retired  │
      └──────────┘ └──────────┘ └──────────┘
      (all three trigger downstream resolution + podium draft check)

Top Admin can revert complete/walkover/retired → ready via cascade_edit_match
(only while event not published)
```

---

## HARD-TO-REVERSE DECISIONS

1. **Client-side PIN verification with env vars** — If the secret URL or PIN is leaked, rotation requires a Vercel env var update + redeploy (minutes). Acceptable for a one-day event. Would not be appropriate for a multi-day or recurring tournament without a proper auth system.

2. **Static JSON bracket wiring** — All 8 event bracket structures are hardcoded in the client bundle. Adding a 9th event or restructuring an existing event requires a code change and redeploy. Not a runtime-configurable system.

3. **score_sets jsonb denormalisation on matches** — Both sets table (source of truth) and score_sets jsonb (fast read snapshot) must be kept in sync. Every set write touches both. If they diverge (bug), the public site shows stale scores. Mitigation: submit_set RPC updates both atomically.

4. **Consolation format fixed as RR pool only (v1)** — Mini knockout or 4-player consolation formats require code changes to match generation, bracket wiring, and standings computation. Documented as v1.5 candidate (BR-031).

5. **No user table / stateless admins** — Admin identity is a free-text name string in localStorage. There is no way to force consistent naming, prevent impersonation of another admin's name in audit logs, or recover a session by credential. Acceptable for a small trusted group of 6 people at a one-day event.

---

## OPEN QUESTIONS

None. All questions raised during Phase 4 were resolved inline.

---

## CHANGE LOG

Phase 4 design override: Match format matrix corrected from HL-design.md.
- HL-design.md stated: U13/U15 SF + 3rd place = best-of-3x15
- Corrected to: U13/U15 SF + 3rd place = set-to-30
- Only Finals use best-of-3x15
- Confirmed by user during Phase 4 data model review
