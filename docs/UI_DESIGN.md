# UI_DESIGN.md — West End Badminton Club Tournament App
Generated: April 2026
Status: Phase 5 Complete / Pending User Approval
Source: REQUIREMENTS.md (Phase 3) + BACKEND_DESIGN.md (Phase 4)
Pipeline: Zorvance Product Development Pipeline — Phase 5

---

## AESTHETIC DIRECTION

**Club name:** Leo Badminton Club
**Tournament name:** Leo Rising Stars Kids Tournament — 2026
**Logo:** /assets/logo.png — circular gold-on-navy lion crest. Displayed in header of all screens (public and admin). Logo background is deep navy — matches app background perfectly, no masking needed.

**Direction:** Royal sport — premium, confident, gold-on-navy. The logo dictates everything. Do not fight it.
**Palette:**
  - Background: #0E1B2E (deep navy, matches logo background exactly)
  - Primary accent: #C9A84C (gold, pulled from logo)
  - Bright accent: #F0C040 (bright gold for highlights, scores, live indicators)
  - Text primary: #FFFFFF
  - Text muted: #8899AA
  - Warning/amber: #F59E0B
  - Error: #EF4444
  - Success/confirm: #C9A84C (gold, not green — consistent with palette)
**Typography:**
  - Display: Cinzel (Google Fonts) — serif, regal, matches the crest aesthetic. Used for tournament name, champion board headings, podium names.
  - UI: DM Sans — clean, readable, modern. Used for all body text, labels, scores, buttons.
**Tone:** Regal and exciting on the public site. Same palette, tighter and more utilitarian on admin screens. The lion crest sets the bar — everything should feel worthy of it.
**Mobile-first:** All screens designed for 390px viewport (iPhone 14 baseline). Touch targets minimum 44px. Thumb zone respected.
**Memorable detail:** Live match cards have a pulsing gold left border. Champion Board podium cards animate in with a slide-up reveal — Gold card gets a subtle shimmer animation. Nothing else animates.
**Footer (public site):** "Powered by Zorvance Technology · info@zorvance.com" — fixed below tab bar on all public pages.

---

## NAVIGATION STRUCTURE

### Public Site — /
Bottom tab bar (4 tabs, thumb-friendly, always visible):
- Now Playing (default)
- Brackets
- Standings
- Champion Board

### Court Admin — /ca[secret]
Linear navigation:
- Login → Match Picker (default) → Score Entry → back to Match Picker

### Top Admin — /ta[secret]
Header nav links (in addition to Match Picker and Score Entry):
- Event Control
- Champion Board Admin

---

## SCREEN INVENTORY

| ID | Screen | Roles |
|---|---|---|
| S01 | Now Playing | Public |
| S02 | Brackets | Public |
| S03 | Standings | Public |
| S04 | Champion Board | Public |
| S05 | Login | Court Admin, Top Admin |
| S06 | Match Picker | Court Admin, Top Admin |
| S07 | Score Entry | Court Admin, Top Admin |
| S08 | Event Control | Top Admin only |
| S09 | Champion Board Admin | Top Admin only |

Total: 9 screens. Every screen maps directly to user stories in REQUIREMENTS.md.

---

## USER FLOW DIAGRAMS

### Court Admin Flow
```
[S05 Login]
  → PIN correct → [S06 Match Picker]
  → PIN wrong → error inline → stay on [S05]

[S06 Match Picker]
  → tap in-progress card → [S07 Score Entry] (resume)
  → tap "Start on Court X" on ready match
      → court free → start_match RPC → [S07 Score Entry]
      → court occupied → warning modal → confirm → [S07]
                                       → cancel → [S06]
      → RPC returns MATCH_ALREADY_CLAIMED → toast → [S06] refreshed

[S07 Score Entry]
  → submit set → validation error → inline error → stay on [S07]
  → submit set → network error → red banner + retry → stay on [S07]
  → submit set → success → set locked, next set renders
  → winning condition met → "Mark Match Complete" enables
      → tap → confirmation modal → confirm → complete_match RPC
          → success → [S06 Match Picker]
          → network error → red banner + retry on modal
  → Walkover/Retire link → modal
      → walkover confirm → record_walkover RPC → [S06]
      → retire confirm → record_retirement RPC → [S06]
  → back arrow → [S06] (match stays in_progress)
```

### Top Admin Flow (additional paths)
```
[S08 Event Control]
  → event chip → event content loads
  → match row tap → detail panel slides up
      → audit log visible
      → "Edit Result" tap → inline score inputs
          → submit → no downstream → saves → panel closes
          → submit → downstream exists → cascade modal
              → Cascade → cascade_edit_match RPC (cascade=true)
              → Flag → cascade_edit_match RPC (cascade=false)
              → Cancel → no change
  → "Run BLP Computation" → confirm → fire_blp RPC
      → success → BLP match created, panel shows result
      → already fired → idempotent display
  → "Generate Consolation Pools" → confirm → generate_consolation_pools RPC
  → "Post Girls Doubles Draw" → draw form overlay
      → assign pairs → validate composition live
      → Lock Draw → lock_e8_draw RPC → overlay closes

[S09 Champion Board Admin]
  → tap "Draft ready" row → review panel
      → "Publish" → publish_podium RPC → row = Published
  → tap "Published" row → review panel
      → "Unpublish" → confirm → unpublish_podium RPC → row = Draft ready
```

### Public Flow
```
[S01 Now Playing] ← default landing, auto-refresh 30s, Realtime subscription
  → bottom tab → [S02 Brackets]
      → event chip → bracket or RR table
      → match slot tap → score detail modal overlay
  → bottom tab → [S03 Standings]
      → tied row tap → tiebreaker expansion inline
  → bottom tab → [S04 Champion Board]
      → cards render as published (Realtime subscription)
```

---

## SCREEN SPECIFICATIONS

---

### S01 — Public: Now Playing

**Purpose:** Parents see all live matches and what's coming up next.
**Entry:** Default tab on public URL. Returned to from other tabs via bottom nav.

**States:**

*Loading:*
Skeleton cards (2–3 placeholder cards with shimmer animation). No spinner — skeleton feels faster on mobile. Tab bar renders immediately.

*Empty (no matches in progress):*
Centered within live section:
- Shuttlecock icon (simple line art, 48px)
- Heading: "No matches in play right now"
- Subtext: "Check back soon or see what's Up Next below"
Up Next section still renders below if ready matches exist.

*Populated:*
```
┌─────────────────────────────┐
│ [logo] LEO RISING STARS 🔄  │  ← logo + tournament name, refresh right
├─────────────────────────────┤
│ ● LIVE                      │  ← pulsing red dot
│                             │
│ ┌─────────────────────────┐ │
│ │ C2          U11 Boys    │ │  ← court badge | event tag
│ │ Aarav S.  21 – 14  Rohan│ │  ← player | score | player
│ │ ★                       │ │  ← handicap marker if E7
│ │ [21-18]  [_-_]          │ │  ← set chips
│ └─────────────────────────┘ │  ← green left border (live)
│  (more live cards...)       │
│                             │
│ UP NEXT                     │
│ ┌─────────────────────────┐ │
│ │ U13 Girls · SF          │ │
│ │ Priya vs Sara J.        │ │
│ └─────────────────────────┘ │
│  (2-4 more ready cards...)  │
│                             │
│ Last updated 10:32          │
├─────────────────────────────┤
│ Now Playing│Brackets│Stand..│  ← bottom tab bar
├─────────────────────────────┤
│ Powered by Zorvance Technology · info@zorvance.com │
└─────────────────────────────┘
```

Live match cards: electric green left border (4px), navy card background, white text. Court badge: pill shape. Event tag: muted text, right-aligned. Score: large, bold, center. Set chips: small grey pills showing completed set scores.

Up Next cards: same layout, lower visual weight (no green border, muted background). Court shown as "—".

*Error:*
Red banner below header: "Could not load live scores — [Retry]". Last loaded data visible beneath.

**Key interactions:**
- Auto-refresh every 30 seconds (silent, no UI flash, updates timestamp)
- Manual refresh icon: top right, rotation animation on tap
- Match cards: not tappable (public display only)
- Realtime subscription: cards update in place (no full reload)
- Tab bar: always visible, switches between public screens

**Backend dependencies:** getInProgressMatches(), getReadyMatches(), Supabase Realtime on matches

---

### S02 — Public: Brackets

**Purpose:** Parents see bracket progression for any event.
**Entry:** Brackets tab in bottom nav.

**States:**

*Loading:*
Event picker chips render immediately (static config). Bracket area shows skeleton.

*Empty (event not yet active — E8 before draw posted):*
Event picker visible. Bracket area: "Draw not posted yet — check back after 14:15"

*Populated — Bracket events (E1 knockout; E2–E5, E7 hybrid):*
```
┌─────────────────────────────┐
│ Brackets                🔄  │
├─────────────────────────────┤
│ [E1][E2][E3][E4][E5][E6]... │  ← horizontal scroll chips
├─────────────────────────────┤
│   R1      QF      SF    F   │  ← column headers
│                             │
│  [Aarav]──┐                 │
│           ├──[Aarav]──┐     │
│  [Rohan]──┘           │     │
│                       ├─[?] │
│  [Priya]──┐           │     │
│           ├──[  ?  ]──┘     │
│  [TBD  ]──┘                 │
│                             │  ← bracket scrolls horizontally
│ ── Consolation ──────────── │
│  Pool A  [table]            │
└─────────────────────────────┘
```

In-progress match: green left border + "LIVE" micro badge. Complete match: winner name bold, loser name muted. Pending match: "TBD" placeholder. E7 matches: ★ on P1/P2 name.

*Populated — Round Robin events (E6, E8):*
Table format. Columns: Player/Team | MP | W | L | PF | PA. Sorted by current standings. Tied rows: ↑ indicator.

*Error:* Red banner + retry, last data visible.

**Key interactions:**
- Event picker chips: tap to switch event
- Match slot tap: small modal overlay with full set scores and status
- Bracket scrolls horizontally on mobile (touch-scroll, no pagination)
- RR table rows: display only, not tappable
- Manual refresh top right

**Backend dependencies:** getBracket(event_id), getInProgressMatches(), static wiring config

---

### S03 — Public: Standings

**Purpose:** Parents see round robin pool standings with tiebreaker reasoning.
**Entry:** Standings tab in bottom nav.

**States:**

*Loading:* Skeleton table rows with shimmer.

*Empty (no RR matches played):*
"Standings will appear as matches are played"

*Populated:*
```
┌─────────────────────────────┐
│ Standings               🔄  │
├─────────────────────────────┤
│ U11 Boys · Consolation A    │  ← section header per pool
│ ┌────┬──────────┬─┬─┬──┬──┐ │
│ │Pos │ Player   │W│L│PF│PA│ │
│ ├────┼──────────┼─┼─┼──┼──┤ │
│ │ 1  │ Aarav S. │2│0│42│30│ │
│ │ 2↑ │ Rohan    │1│1│38│35│ │  ← tied, ↑ = tiebreaker applies
│ │ 2↑ │ Dev      │1│1│35│38│ │
│ │    │ ↳ Rohan ranked above: PF 38 vs 35 │  ← expanded on tap
│ │ 3  │ Nikhil   │0│2│28│40│ │
│ └────┴──────────┴─┴─┴──┴──┘ │
│                             │
│ U13 Girls · Main Pool       │
│ [table...]                  │
└─────────────────────────────┘
```

Three-way circular tie (EC-012): all tied rows highlighted amber. Note below table: "Three-way tie — Top Admin will resolve if pool progression is affected."

*Error:* Red banner + retry.

**Key interactions:**
- Tied row tap: accordion expansion showing tiebreaker reason inline
- Manual refresh top right

**Backend dependencies:** getRawStandingsData() per active pool, client-side standings computation

---

### S04 — Public: Champion Board

**Purpose:** Published podiums appear as events conclude — the celebration screen.
**Entry:** Champion Board tab in bottom nav.

**States:**

*Loading:* Skeleton podium cards.

*Empty (no podiums published):*
```
┌─────────────────────────────┐
│ Champion Board          🔄  │
│                             │
│         🏆                  │  ← line-art trophy icon, gold
│   Champions will appear     │
│   here as events conclude   │
│                             │
│      Smash Your Limits      │  ← muted, italic tagline
└─────────────────────────────┘
```

*Partially populated:*
```
┌─────────────────────────────┐
│ Champion Board          🔄  │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ U11 Boys Singles        │ │  ← event name
│ │ 🥇 Aarav Sharma         │ │  ← gold, large text
│ │ 🥈 Rohan Patel          │ │
│ │ 🥉 Dev Kumar            │ │
│ │ Consolation: Nikhil M.  │ │  ← if applicable, smaller
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ U13/U15 Girls Singles       │ │  ← animates in as published
│ │ 🥇 Priya Singh          │ │
│ │ ...                     │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

Cards animate in with slide-up + fade when published (Realtime subscription triggers animation). Already-visible cards do not re-animate on refresh.

*Error:* Red banner + retry.

**Key interactions:**
- Cards not tappable
- Realtime subscription on podiums table triggers card appearance
- Manual refresh top right

**Backend dependencies:** getPublishedPodiums(), Supabase Realtime on podiums

---

### S05 — Admin: Login

**Purpose:** Admin enters name and PIN to access their tier.
**Entry:** Direct navigation to /ca[secret] or /ta[secret]. Also shown when localStorage session is absent.

**States:**

*Default:*
```
┌─────────────────────────────┐
│                             │
│      [logo]                 │
│      Leo Badminton Club     │
│   Rising Stars 2026         │
│      Tournament Admin       │
│                             │
│   ┌─────────────────────┐   │
│   │ Your name           │   │  ← free text, placeholder
│   └─────────────────────┘   │
│   ┌─────────────────────┐   │
│   │ Admin PIN  ••••     │   │  ← masked, numeric keyboard
│   └─────────────────────┘   │
│                             │
│   [        Enter        ]   │  ← disabled until both filled
│                             │
└─────────────────────────────┘
```

*PIN incorrect:*
PIN field shakes (CSS keyframe animation, 300ms). Inline error below PIN field: "Incorrect PIN — try again". Name value retained. PIN cleared and refocused.

*Loading (brief):*
Enter button shows inline spinner, disabled. Covers only the set_role RPC call (near-instant).

*Success:* Redirect to S06 Match Picker.

**Key interactions:**
- Name: free text, non-empty required
- PIN: inputmode="numeric", masked, mobile numeric keyboard
- Enter button or keyboard submit: triggers check
- No lockout on wrong PIN (by design)
- No "forgot PIN" link

**Backend dependencies:** PIN comparison against env var (client-side), set_role RPC on success

---

### S06 — Admin: Match Picker

**Purpose:** Admin selects which match to score next.
**Entry:** After login. Returned to after completing or exiting a match.

**States:**

*Loading:*
Header and court selector render immediately (static). Match list areas show skeleton cards.

*Empty (no ready or in-progress matches):*
In-progress section hidden. Ready section: "No matches ready — check back soon"

*Populated:*
```
┌─────────────────────────────┐
│ [logo] Leo RS    [Admin] Signout│  ← logo + role badge + sign out
│ [Event Control] [Board]     │  ← Top Admin only nav links
├─────────────────────────────┤
│ [C1] [C2●][C3] [C4] [C5][All]│ ← court pills, ● = active match
├─────────────────────────────┤
│ IN PROGRESS                 │
│ ┌─────────────────────────┐ │
│ │ C2 · U11 Boys · QF1    │ │
│ │ Aarav S. vs Rohan       │ │  ← tap to resume score entry
│ │ [21-14]  Set 2 live...  │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ READY TO START              │
│ ┌─────────────────────────┐ │
│ │ U13 Boys · SF1    set30 │ │
│ │ Priya vs Sara J.        │ │
│ │ [Start on C2]           │ │  ← disabled if "All" selected
│ └─────────────────────────┘ │
│  (more ready cards...)      │
├─────────────────────────────┤
│ Last updated 10:47          │
└─────────────────────────────┘
```

Court selector: pill buttons, selected = electric green fill. Court with active match: small green dot indicator. "All" selected: "Start on Court X" buttons show "Pick a court first" (disabled), tapping highlights court selector.

Ready cards sorted by: phase → blocking event → round number. Format chip (Set21/Set30/3x15) shown. E7 matches: ★ chip on card.

*Error:* Red banner: "Could not load matches — [Retry]". Last data visible.

**Key interactions:**
- Court pill: tap filters in-progress and ready lists to that court
- In-progress card: tap → S07 Score Entry (resume)
- Ready card "Start on Court X":
  - Court free → start_match RPC → S07
  - Court occupied → warning modal: "Court X has [match name] in progress. Start anyway?" Confirm / Cancel
  - RPC returns MATCH_ALREADY_CLAIMED → toast notification → list refreshes
- Refresh icon: re-fetch, update timestamp
- Sign out link: clears localStorage, redirects to login

**Backend dependencies:** getReadyMatches(), getInProgressMatches(), start_match RPC

---

### S07 — Admin: Score Entry

**Purpose:** Admin enters set scores and marks match complete.
**Entry:** From S06 via start or resume.

**States:**

*Loading:*
Match header renders immediately (passed from S06 navigation state). Set rows show skeleton briefly.

*E7 Handicap banner (non-dismissible, always visible when applicable):*
Full-width amber banner between header and set inputs:
"★ Handicap match — [Player name] starts each set at 3-0. Enter the FINAL score including the head start."
Cannot be scrolled away or closed.

*Populated — Single set (set21 or set30):*
```
┌─────────────────────────────┐
│ ← U11 Boys · Quarter Final  │  ← back arrow | event + round
│   Court C2                  │  ← court badge
│                             │
│ [★ Handicap banner if E7]   │
│                             │
│ Aarav S.         Rohan P.   │  ← player names
│ ┌─────────┐   ┌─────────┐  │
│ │   21    │ – │   18    │  │  ← large number inputs (56px+)
│ └─────────┘   └─────────┘  │
│                             │
│ [    Submit Set    ]        │
│                             │
│ ── after Set 1 submitted ── │
│ Set 1: 21 – 18  [Edit]      │  ← locked row, edit link
│                             │
│                             │
│ [Mark Match Complete]       │  ← disabled until condition met
│                             │
│ Walkover / Retire           │  ← small link, always available
└─────────────────────────────┘
```

*Populated — Best of 3 (Finals only):*
Same layout. Set 2 renders below Set 1 after Set 1 submitted. Set 3 renders only if sets split 1-1 after Set 2.

"Mark Match Complete" enabled when one player wins 2 sets.

*Mark Match Complete — confirmation modal:*
```
┌───────────────────────────┐
│ Aarav S. wins             │
│ 21–18, 15–12              │
│                           │
│ [Confirm]   [Cancel]      │
└───────────────────────────┘
```
Network error on confirm: red banner within modal + Retry button. Match stays in_progress.

*Walkover / Retire modal:*
```
┌───────────────────────────┐
│ Walkover / Retire         │
│                           │
│ ┌─────────────────────┐   │
│ │ Walkover            │   │
│ │ Opponent didn't show│   │
│ │ [Aarav S. wins] [Rohan wins] │
│ └─────────────────────┘   │
│                           │
│ ┌─────────────────────┐   │
│ │ Retired mid-match   │   │
│ │ Opponent withdrew   │   │
│ │ [Aarav S. wins] [Rohan wins] │
│ │ □ Save last scores  │   │
│ └─────────────────────┘   │
│                           │
│            [Cancel]       │
└───────────────────────────┘
```

*Error states:*
- Submit set fails: red banner below set row: "Score could not be saved — [Retry]". Inputs retain values. Set not locked.
- Mark complete fails: red banner on confirmation modal: "Could not complete match — [Retry]". Match stays in_progress.

**Key interactions:**
- Back arrow: exits to S06. Match stays in_progress. No confirmation needed (EC-013 — another admin can resume).
- Number inputs: tap opens numeric keyboard immediately. Large touch target.
- Submit Set: client-side validation first, then submit_set RPC. Inline error if invalid.
- Edit link: reopens inputs inline for that set only. No new screen.
- Mark Match Complete: disabled until valid winning condition. Requires modal confirm.
- Walkover/Retire: always available regardless of set state.

**Backend dependencies:** getMatchDetail(match_id), submit_set RPC, complete_match RPC, record_walkover RPC, record_retirement RPC

---

### S08 — Top Admin: Event Control

**Purpose:** Top Admin monitors all events, fires triggers, views audit logs, overrides match results.
**Entry:** Nav link in header (Top Admin only).

**States:**

*Loading:*
Event picker chips render immediately. Content area shows skeleton.

*Populated:*
```
┌─────────────────────────────┐
│ Event Control           🔄  │
├─────────────────────────────┤
│[E1●][E2●][E3 ][E4 ][E5●]...│  ← chips, status dots
├─────────────────────────────┤
│ U11 Boys Singles  ● Active  │  ← event name + status badge
│ Gate: Ready ✓               │  ← or "Waiting for E1" (amber)
│                             │
│ ── Bracket / Match List ─── │
│ R1                          │
│ ┌─────────────────────────┐ │
│ │ ✓ QF1  Aarav 21-18 Rohan│ │  ← complete
│ │ ● QF2  Priya vs Dev LIVE│ │  ← in_progress, green
│ │ ○ QF3  TBD vs TBD      │ │  ← pending
│ │ ⚠ QF4  Nikhil vs Raj   │ │  ← inconsistent flag
│ └─────────────────────────┘ │
│                             │
│ ── E1 Triggers ─────────────│
│ [Run BLP Computation]       │  ← disabled if R1 incomplete
│  Waiting for: QF3, QF5      │  ← status shown below button
│                             │
│ [Generate Consolation Pools]│  ← disabled until BLP done
└─────────────────────────────┘
```

Event chip status dots: grey=pending, green=active, blue=complete, gold=published.

*Match detail panel (slides up on match row tap):*
```
┌─────────────────────────────┐
│ QF1 · U11 Boys              │  ← slide-up panel
│ Court C2 · Set to 30        │
│ Started by Sadhana · 10:31  │
│                             │
│ Aarav S.   21 – 18   Rohan  │
│                             │
│ ── Audit Log ───────────────│
│ 10:31 Sadhana started on C2 │
│ 10:44 Raj entered 21-18     │
│ 10:46 Raj marked complete   │
│                             │
│ [Edit Result]               │  ← blocked if event published
│                             │
│              [Close]        │
└─────────────────────────────┘
```

*Edit Result inline:*
Score inputs appear within panel. On submit:
- No downstream: saves, audit entry written, panel updates
- Downstream exists: cascade modal:
```
┌───────────────────────────────┐
│ Changing this result affects: │
│  · SF1 (in progress)         │
│  · Final (pending)           │
│                               │
│ [Cascade changes]             │
│ [Flag as inconsistent]        │
│ [Cancel]                      │
└───────────────────────────────┘
```

*BLP trigger (E1 only):*
Button: "Run BLP Computation"
- Disabled state: grey, shows "Waiting for: [match list]" below
- Enabled state: green
- Tap → confirmation: "Rank R1 losers by point margin and create BLP match?" Confirm / Cancel
- Post-fire: results panel shows rankings + "BLP match created at [time]"
- Already fired: button disabled, "Generated by Sadhana at 10:47" shown

*E8 draw form (full-screen overlay):*
```
┌─────────────────────────────┐
│ ← Girls Doubles Draw        │
├─────────────────────────────┤
│ Composition: U15+U11: 2/3   │
│             U15+U13: 0/2    │  ← live counter, updates on change
├─────────────────────────────┤
│ Pair 1                      │
│ [Player dropdown ▼] & [Player dropdown ▼]│
│ Pair 2                      │
│ [Player dropdown ▼] & [Player dropdown ▼]│
│ Pair 3 ← invalid           │  ← red highlight if constraint violated
│ [Player dropdown ▼] & [Player dropdown ▼]│
│ Pair 4                      │
│ ...                         │
├─────────────────────────────┤
│ [Lock Draw]                 │  ← disabled until all valid
└─────────────────────────────┘
```

*Error:* Red banner + retry, last data visible.

**Key interactions:**
- Event chip: tap to switch event content
- Match row tap: detail panel slides up from bottom
- Edit Result: inline within panel, no new screen
- Cascade modal: three options — Cascade / Flag / Cancel
- Trigger buttons: confirmation required, idempotent
- Inconsistent matches: ⚠ badge visible in match list, noted in detail panel
- E8 draw: composition counter updates live on every dropdown change

**Backend dependencies:** getBracket(event_id), getMatchDetail(match_id), getTriggerRecord(), cascade_edit_match RPC, fire_blp RPC, generate_consolation_pools RPC, lock_e8_draw RPC

---

### S09 — Top Admin: Champion Board Admin

**Purpose:** Top Admin reviews draft podiums and publishes them.
**Entry:** Nav link in header (Top Admin only).

**States:**

*Loading:* Skeleton list rows.

*Populated:*
```
┌─────────────────────────────┐
│ Champion Board Admin    🔄  │
├─────────────────────────────┤
│ U11 Boys Singles            │
│ ● Draft ready               │  ← amber, pulsing dot → tap to review
├─────────────────────────────┤
│ U13 Boys Singles            │
│ ○ Pending (3 matches left)  │  ← grey, not tappable
├─────────────────────────────┤
│ U13/U15 Girls Singles           │
│ ★ Published                 │  ← gold → tap to view/unpublish
├─────────────────────────────┤
│ (remaining 5 events...)     │
└─────────────────────────────┘
```

*Draft ready — review panel (slides up):*
```
┌─────────────────────────────┐
│ U11 Boys Singles            │
│                             │
│ 🥇 Aarav Sharma             │
│ 🥈 Rohan Patel              │
│ 🥉 Dev Kumar                │
│ Consolation: Nikhil M.      │
│                             │
│ [    Publish    ]           │  ← green, prominent
│          [Back]             │
└─────────────────────────────┘
```

*Published — review panel:*
Same layout plus:
- "Published by Sadhana at 14:22"
- "Unpublish" button (muted, destructive amber styling)
- Tap unpublish → confirmation modal:
  "This will remove U11 Boys Singles from the public Champion Board. Continue?"
  Confirm / Cancel

*Pending — tap:*
No panel. Toast: "Waiting for [N] matches to complete"

*Error:* Red banner + retry.

**Key interactions:**
- Draft ready row: tap → review panel slides up → Publish button
- Published row: tap → review panel → Unpublish (requires confirmation)
- Pending row: tap → toast notification only
- Publish: publish_podium RPC, confirmation built into panel (button itself is the confirm)
- Unpublish: separate confirmation modal (destructive action)

**Backend dependencies:** getPublishedPodiums(), getTriggerRecord(event_id, 'podium_publish'), publish_podium RPC, unpublish_podium RPC

---

## GLOBAL UI PATTERNS

### Error Display
Red banner, full width, top of content area (below header). Never replaces content — overlays above it. Always includes a Retry button inline. Last successfully loaded data remains visible beneath. Dismisses automatically on successful retry. Used for: network failures, RPC errors, fetch failures.

### Loading States
Skeleton screens with shimmer animation for all data-dependent content. No full-page spinners. Static elements (header, nav, court selector, event picker) render immediately. Skeleton matches the approximate shape of populated content.

### Empty States
Every empty state: short heading + supporting subtext. Never a blank screen. Icon used sparingly — only on primary empty states (S01 Now Playing, S04 Champion Board). Empty states do not use error styling.

### Confirmation Dialogs
**Required for (high-consequence actions):**
- Mark Match Complete
- Publish Podium
- Unpublish Podium (separate destructive confirmation)
- All trigger fires (BLP, consolation pools, E8 draw lock)
- Walkover / Retire
- Cascade edit

**Not required for:**
- Set submission (fast, reversible before complete)
- Court selection
- Tab switching
- Event picker

Every confirmation dialog shows the outcome clearly before the user commits. Destructive actions (unpublish, cascade) use amber/warning styling on the confirm button.

### Toast Notifications
Non-blocking, appear top of screen, auto-dismiss after 3 seconds.
Used for: "Match already claimed by another admin", "Waiting for X matches" (pending podium tap).
Not used for errors (errors use persistent banners with retry).

### Form Validation
Client-side first, always. Inline error message below the relevant input field. Never alert() or browser dialogs. Inputs retain values on error. Submit button does not disable after failed attempt — user corrects and retries without re-entry.

### Handicap Banner (E7 matches)
Amber (#F59E0B) background, full width, non-dismissible. Renders between match header and Set 1 input on S07. Text: "★ Handicap match — [Player name] starts each set at 3-0. Enter the FINAL score including the head start." Cannot be scrolled away. Present for every set of the match.

### Footer (Public site only)
Fixed below tab bar on all public pages (S01–S04). Small, muted text: "Powered by Zorvance Technology · info@zorvance.com"

### Refresh Pattern
Refresh icon (circular arrow) top right of every screen header. On tap: brief rotation animation (CSS, 500ms), re-fetches current view data, updates "Last updated HH:MM" timestamp. Data updates in place — no full page reload. Available on every screen, admin and public.

### Sign Out (Admin only)
Text link in top right of every admin screen header alongside role badge. Tap: clears localStorage (role, name, PIN session), redirects to the login screen for that tier's URL. No confirmation required.

### Inconsistent Match Indicator
⚠ amber badge on match row/card when matches.inconsistent = true. Visible in S06 Match Picker and S08 Event Control match list. Detail panel in S08 explains: "This match has been flagged as potentially inconsistent. Review result and cascade if needed."

### Real-time Updates
Supabase Realtime subscription active on: matches (in_progress filter), podiums. Updates apply in-place — individual cards/rows update without list re-render. 30-second polling fallback runs silently alongside subscriptions. No UI indication of subscription status (polling covers any gaps).

---

## BACKEND CHANGE REQUESTS

None. All UI requirements are fully supported by the backend design as specified in BACKEND_DESIGN.md. No gaps identified during Phase 5.

---

## OPEN QUESTIONS

None.

---

## PHASE NOTES

Phase 1 (Idea Hardening), Phase 2 (VC Stress Test) skipped per user instruction.
Phase 3 (BSA Requirements) complete — REQUIREMENTS.md.
Phase 4 (Backend Design) complete — BACKEND_DESIGN.md.
Phase 5 (UI Design) complete — this document.
