# Supabase — schema, RLS, and RPC

These three files form the backend of Leo Rising Stars Tournament.
Run them once against a fresh Supabase project, then run the seed scripts.

## Order of execution

Run each file in the Supabase SQL Editor (or via `psql`) in this order. Each
file is idempotent — safe to re-run during development.

1. **`01_schema.sql`** — creates extensions, enums, tables, indexes; enables
   Row Level Security; adds `matches`, `sets`, `podiums` to the realtime
   publication.

2. **`02_rls.sql`** — installs all Row Level Security policies. Reads the
   session variable `app.user_role` (set via the `set_role` RPC) to evaluate
   role-based access.

3. **`03_rpc.sql`** — defines every RPC function used by the client. All RPCs
   are `SECURITY DEFINER` so they perform multi-table writes inside one
   transaction without re-tripping RLS.

## Seeding

After SQL is applied:

```bash
# Required env (loaded via Node's --env-file, Node 20+):
#   VITE_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY

# 1. Populate scripts/players.csv (header: code,full_name,age_group,gender)
node --env-file=.env.local scripts/seed-players.js

# 2. Seed the 8 events (E1..E8)
node --env-file=.env.local scripts/seed-events.js

# 3. Seed the structural match shells (R1 / SF / F / 3P + E6 RR)
node --env-file=.env.local scripts/seed-matches.js
```

After step 3 the database has structural shells for ~71 matches with
placeholder refs and `status='pending'`. The physical draw step (manual or
scripted) resolves R1 `p1_id` / `p2_id` and flips R1 matches to `ready`.

## RPC error contract

Every RPC raises `EXCEPTION` with a structured code as the first word of the
message. The client splits on `:` and renders a human-readable error:

| Code                            | Meaning                                                |
| ------------------------------- | ------------------------------------------------------ |
| `MATCH_ALREADY_CLAIMED`         | start_match lost the optimistic-lock race              |
| `MATCH_NOT_FOUND`               | UUID does not exist                                    |
| `MATCH_NOT_IN_PROGRESS`         | submit_set / complete_match called on wrong status     |
| `INVALID_SET_SCORE`             | BR-010 violation — neither score equals target         |
| `INVALID_SET_ORDER`             | BR-013 violation — set 3 only after a 1-1 split        |
| `INVALID_WINNER`                | winner_id not one of the two opponents                 |
| `EVENT_PUBLISHED`               | edit blocked because podium is published (BR-022)      |
| `BLP_ALREADY_FIRED`             | trigger_records hit                                     |
| `R1_INCOMPLETE`                 | BLP fired before all R1 terminal                       |
| `INSUFFICIENT_ELIGIBLE_PLAYERS` | fewer than 2 BLP-eligible R1 losers                    |
| `POOLS_ALREADY_GENERATED`       | trigger_records hit                                    |
| `BLP_NOT_COMPLETE`              | consolation pools requested before BLP done            |
| `INSUFFICIENT_PLAYERS`          | fewer than 6 consolation players available             |
| `DRAW_ALREADY_LOCKED`           | E8 draw posted twice                                    |
| `INVALID_COMPOSITION`           | E8 pairs violate 3x(U15+U11) + 2x(U15+U13)             |
| `WITHDRAWN_PLAYER`              | E8 pair includes a withdrawn player                    |
| `MATCHES_OUTSTANDING`           | publish_podium called before all matches terminal      |
| `NO_DRAFT_PODIUM`               | publish_podium called with no podium row               |
| `PODIUM_NOT_PUBLISHED`          | unpublish_podium called on a non-published podium      |
| `INVALID_ADMIN_NAME`            | empty admin_name passed to any RPC                     |

## Demo mode

`reset_tournament()` wipes runtime data and resets matches to seeded state.
**It is gated at the application level** — only callable when `?demo=true` is
in the URL. Never expose it in the production build.
