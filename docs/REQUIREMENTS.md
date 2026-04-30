# REQUIREMENTS.md — West End Badminton Club Tournament App
Generated: April 2026
Status: Phase 3 Complete / Pending User Approval
Source: HL-design.md (v1, April 2026)
Pipeline: Zorvance Product Development Pipeline — Phase 3

---

## [USERS & ROLES]

### Role 1: Top Admin
What they do: Owns the tournament. Manages the full lifecycle of all 8 events — fires special triggers, overrides scores, reviews and publishes podiums.

Can do:
- Everything a Court Admin can do
- Edit any match result, including completed matches, until that event's podium is published
- Fire all special triggers: E1 BLP computation, consolation pool generation, E8 draw posting, podium publish
- Withdraw a player (recorded as walkover)
- Un-publish a podium to unlock further edits
- View full audit history for any match

Cannot do:
- Edit matches in a published event without first un-publishing
- Fire any trigger more than once (idempotent — subsequent attempts show who ran it and when)

Account: No username or email. Access via secret URL segment + shared PIN. 1–2 people hold this access. Name entered at login is stored locally and used in audit records.

---

### Role 2: Court Admin
What they do: On-the-floor score entry. Picks up a free court, starts a ready match, enters set scores, marks it complete.

Can do:
- Select a court and pick a ready match to start
- Enter and edit set scores while the match is in progress
- Mark a match complete (locks it from their own future editing)
- Record a walkover or retirement
- View brackets and standings (read-only, via public site URL)

Cannot do:
- Edit a match after marking it complete
- Fire any trigger (BLP, draw, pool generation, publish)
- Override another admin's completed match

Account: Separate secret URL segment + shared PIN, different from Top Admin credentials. 4–6 people hold this access. Name entered at login stored locally and used in audit records.

---

### Role 3: Public Viewer (Parent / Spectator)
What they do: Follows the tournament in real time on their phone. No interaction, no data entry.

Can do:
- View live scores (Now Playing tab)
- View brackets and progression (Brackets tab)
- View round robin standings (Standings tab)
- View published podiums (Champion Board tab)
- Manually refresh any tab

Cannot do: Anything that changes data. No login required.

Account: None. Access via open public URL distributed via WhatsApp and venue QR code.

---

### Auth Model
- Three URLs: public (open), court admin (secret segment), top admin (secret segment)
- Secret URL + correct PIN = access granted for that tier
- PIN stored in localStorage; session persists until explicit sign out
- Admin's name entered at login is a free-text field; stored locally; used in all audit log entries
- Admins are stateless — no user table exists in the system
- Wrong PIN: simple "Incorrect PIN, try again" message. No lockout.

---

### Branding
- Footer on all pages: "Powered by Zorvance Technology" and info@zorvance.com
- UI quality is a primary deliverable. The public site must look and feel genuinely impressive on a phone.

---

## [USER STORIES]

### Court Admin

**Score Entry**
- CA-01: As a Court Admin, I want to select a court and start a ready match, so that the match is tracked as in-progress on that court.
- CA-02: As a Court Admin, I want to enter scores set by set, so that the live score is visible to everyone in real time.
- CA-03: As a Court Admin, I want to edit a set score before marking the match complete, so that I can correct a mis-entry.
- CA-04: As a Court Admin, I want to mark a match complete, so that the result is locked and the bracket progresses automatically.
- CA-05: As a Court Admin, I want to record a walkover or retirement, so that the bracket progresses without a full score being entered.

**Visibility**
- CA-06: As a Court Admin, I want to see which matches are ready to start, so that I know what to pick up next.
- CA-07: As a Court Admin, I want to view brackets and standings, so that I can answer parents' questions without leaving the app.

---

### Top Admin

**Score Override**
- TA-01: As a Top Admin, I want to edit any match result including completed matches, so that I can correct errors that Court Admins cannot fix themselves.
- TA-02: As a Top Admin, I want to see what downstream matches are affected before confirming a cascade edit, so that I can make an informed decision before changing a result.
- TA-03: As a Top Admin, I want to un-publish a podium to unlock edits, so that I can correct a late-discovered error after publishing.

**Special Triggers**
- TA-04: As a Top Admin, I want to run the BLP computation after all E1 R1 matches complete, so that the two closest losers are surfaced for the best-loser playoff.
- TA-05: As a Top Admin, I want to generate the E1 consolation pools after the BLP match completes, so that the 6 consolation players are assigned to pools and their matches created.
- TA-06: As a Top Admin, I want to post the E8 Girls Doubles draw at 14:15, so that the 10 round robin matches are generated and E8 can begin.
- TA-07: As a Top Admin, I want to publish a podium once all relevant matches are complete, so that the Champion Board goes live for that event.

**Audit & Control**
- TA-08: As a Top Admin, I want to view the full audit history of any match, so that I can see who entered what and when.
- TA-09: As a Top Admin, I want to withdraw a player via walkover, so that the bracket progresses cleanly when someone doesn't show.

---

### Public Viewer

- PV-01: As a Public Viewer, I want to see all matches currently in progress, so that I can follow my child's match in real time.
- PV-02: As a Public Viewer, I want to see upcoming matches, so that I know when my child plays next.
- PV-03: As a Public Viewer, I want to view brackets and progression, so that I can see how far my child has advanced.
- PV-04: As a Public Viewer, I want to view round robin standings, so that I can see where my child ranks in their pool.
- PV-05: As a Public Viewer, I want to see published podiums, so that I can see the final results as events conclude.
- PV-06: As a Public Viewer, I want to manually refresh any view, so that I can get the latest scores if the live update hasn't fired.

---

## [ACCEPTANCE CRITERIA]

### Court Admin

**CA-01: Select a court and start a ready match**
```
Given I am logged in as Court Admin and at least one match is ready
When I select a court and tap "Start on Court X" on a ready match
Then the match status changes to in_progress, the court is associated
with that match, and the match appears in the in-progress list

Given another admin has already started a match on that court
When I attempt to start a different match on the same court
Then I see a warning: "Court X has a match in progress. Continue anyway?"
```

**CA-02: Enter scores set by set**
```
Given a match is in progress and I am on the score entry screen
When I enter two scores and submit a set
Then the set is saved and visible to all users in real time

Given I submit a set where neither score equals the target (21/30/15)
When the submit is attempted
Then an inline error is shown and the set is not saved
```

**CA-03: Edit a set score before completion**
```
Given a match is in progress and at least one set has been submitted
When I tap edit on a prior set and change a score
Then the updated score overwrites the previous value and is saved

Given the match has been marked complete
When I attempt to edit any set
Then the edit option is not available to me
```

**CA-04: Mark a match complete**
```
Given a valid winning condition has been met (correct sets won)
When I tap "Mark Match Complete" and confirm in the modal
Then the match is locked, auto-progression fires, and downstream
placeholder refs resolve

Given the winning condition has not been met
When I view the score entry screen
Then the "Mark Match Complete" button is disabled
```

**CA-05: Record a walkover or retirement**
```
Given a match is in progress or ready
When I select Walkover and pick the winner
Then the match is marked complete with no scores and the winner progresses

Given a match is in progress
When I select Retired, pick the winner, and optionally enter last-known scores
Then the match is marked complete with a retired flag and the winner progresses
```

**CA-06: See ready matches**
```
Given I am on the Match Picker screen
When matches are ready to start
Then I see them listed, sorted by suggested priority, with event tag,
players, and format shown

Given no matches are currently ready
When I view the Match Picker
Then I see an empty state message, not a blank screen
```

**CA-07: View brackets and standings**
```
Given I am logged in as Court Admin
When I navigate to the bracket or standings view
Then I see the same read-only view as the public site with no edit
controls available
```

---

### Top Admin

**TA-01: Edit any match result**
```
Given I am logged in as Top Admin and the match's event is not published
When I edit a completed match result
Then the result is overwritten and the audit log records my name,
timestamp, and before/after values

Given the match's event podium is published
When I attempt to edit any match in that event
Then the edit is blocked with a message directing me to un-publish first
```

**TA-02: See downstream impact before cascade**
```
Given I have edited a completed match whose result has propagated downstream
When the system detects affected downstream matches
Then I am shown a list of affected matches before confirming,
with two options: Cascade or Leave

Given I choose Cascade
When I confirm
Then downstream matches update automatically and any conflicting
results are invalidated

Given I choose Leave
When I confirm
Then only the source match is updated and downstream matches
are flagged as inconsistent
```

**TA-03: Un-publish a podium**
```
Given an event podium is published
When I tap un-publish and confirm
Then the podium returns to draft status and match edits for
that event are unlocked

Given the podium is un-published
When I view the Champion Board public tab
Then that event's podium no longer appears
```

**TA-04: Run BLP computation**
```
Given all 7 E1 R1 matches are complete
When I tap "Run BLP Computation" and confirm
Then the app ranks the 7 R1 losers by point margin, surfaces
the top 2, and creates the BLP match

Given the BLP has already been run
When I tap the button again
Then I see "Generated by [name] at HH:MM" and no new match is created
```

**TA-05: Generate E1 consolation pools**
```
Given the BLP match is complete
When I tap "Generate Consolation Pools" and confirm
Then 6 players are randomly split into 2 pools of 3 and
6 RR matches are created

Given pools have already been generated
When I tap the button again
Then I see "Generated by [name] at HH:MM" and no new pools are created
```

**TA-06: Post E8 Girls Doubles draw**
```
Given I am on the E8 draw form with 5 pair slots
When I assign players respecting composition constraints
(3x U15+U11, 2x U15+U13) and lock the draw
Then 10 RR matches are generated and E8 activates

Given a composition constraint is violated
When I attempt to lock the draw
Then an inline error identifies the violating pair and
the draw is not locked
```

**TA-07: Publish a podium**
```
Given all relevant matches for an event are complete and
the podium is in draft
When I review the podium and tap Publish
Then the Champion Board updates publicly and all matches in
that event are locked from further edits

Given relevant matches are not yet complete
When I view the podium screen for that event
Then the Publish button is not available
```

**TA-08: View match audit history**
```
Given I am on the Event Control screen
When I tap any match
Then I see the full audit log: started_at, entered_by, every set entry,
every edit with actor name, timestamp, and before/after values
```

**TA-09: Withdraw a player**
```
Given a player has not shown up for a match
When I record a walkover selecting the opponent as winner
Then the match completes, the absent player is noted,
and the bracket progresses
```

---

### Public Viewer

**PV-01: See matches in progress**
```
Given at least one match is in progress
When I open the Now Playing tab
Then I see all in-progress matches with court, player names,
event, and current set scores

Given no matches are currently in progress
When I open the Now Playing tab
Then I see a clear empty state, not a blank screen
```

**PV-02: See upcoming matches**
```
Given ready matches exist
When I view the Now Playing tab
Then I see an "Up Next" section showing the 3–5 most imminent
ready matches
```

**PV-03: View brackets**
```
Given an event uses a knockout format
When I select that event on the Brackets tab
Then I see a bracket tree with results filled in for completed
matches and live matches highlighted

Given an event uses round robin format
When I select that event on the Brackets tab
Then I see a round robin table with current results
```

**PV-04: View standings**
```
Given round robin or pool matches have been played
When I view the Standings tab
Then I see tables sorted by wins → points for → head-to-head
with tiebreaker reasoning shown where relevant
```

**PV-05: See published podiums**
```
Given at least one event podium has been published
When I open the Champion Board tab
Then I see Gold/Silver/Bronze cards for each published event

Given no podiums are published yet
When I open the Champion Board tab
Then I see the empty state: "Champions will appear here as events conclude"
```

**PV-06: Manual refresh**
```
Given I am on any tab
When I tap the refresh button
Then the view re-fetches current data and the last-updated
timestamp updates
```

---

## [BUSINESS RULES]

### Auth & Access

**BR-001: URL + PIN Required for Admin Access**
Rule: Access to any admin interface requires both the correct secret URL segment AND the correct PIN for that tier. Either alone is insufficient.
Applies to: CA-01 through CA-07, TA-01 through TA-09
Example: A person who knows the court admin URL but enters the wrong PIN is denied access.

**BR-002: PIN Persists Until Sign Out**
Rule: Once a valid PIN is entered on a device, the session persists in localStorage until the user explicitly signs out.
Applies to: All admin roles
Example: A court admin who closes the browser tab and reopens the URL is still logged in without re-entering the PIN.

**BR-003: Tier Separation**
Rule: Court Admin PIN must never grant Top Admin capabilities, regardless of URL visited.
Applies to: All trigger and override stories
Example: A court admin who navigates to the top admin URL and enters the court admin PIN is denied access.

---

### Match Lifecycle

**BR-004: Match Starts Only When Both Opponents Are Resolved**
Rule: A match cannot move to in_progress until both opponent slots contain real players or teams (no placeholders).
Applies to: CA-01
Example: "Winner of QF1 vs Winner of QF2" cannot be started until both QF matches are complete.

**BR-005: One Match Per Court at a Time**
Rule: A court cannot have more than one in_progress match simultaneously.
Applies to: CA-01
Example: If C2 has a match in progress, tapping "Start on C2" on another match triggers a warning before proceeding.

**BR-006: Court Admin Cannot Edit Completed Matches**
Rule: Once a Court Admin marks a match complete, they lose all edit rights to that match permanently.
Applies to: CA-03, CA-04
Example: A court admin who mis-entered a score and already tapped "Mark Match Complete" must find a Top Admin to correct it.

**BR-007: Auto-Progression Fires on Completion**
Rule: When a match is marked complete or recorded as walkover/retired, the winner is immediately and automatically advanced to the next bracket slot.
Applies to: CA-04, CA-05, TA-09
Example: When QF1 completes, the winner's name replaces the "Winner of QF1" placeholder in SF1, making SF1 ready if both SF1 slots resolve.

**BR-008: Walkover Records No Scores**
Rule: A walkover match completes with a winner but zero set scores. It is flagged distinctly from a played match in standings calculations.
Applies to: CA-05, TA-09
Example: A walkover win counts as a win in RR standings but is excluded from point-margin calculations (e.g. BLP ranking).

**BR-009: Retirement Records Partial Scores**
Rule: A retirement records the winner, a retired flag, and any set scores entered up to the point of retirement.
Applies to: CA-05
Example: If a player retired mid-set-2 with Set 1 complete, Set 1 score is recorded; Set 2 is marked incomplete.

---

### Scoring

**BR-010: Exactly One Player Must Reach the Target Score Per Set**
Rule: A valid set result requires exactly one player's score to equal the target (21, 30, or 15). The other player's score must be between 0 and target-minus-one inclusive.
Applies to: CA-02
Example: 21-18 is valid. 21-21 is invalid. 20-18 is invalid. 15-15 is invalid.

**BR-011: No Deuce**
Rule: There is no deuce rule in this tournament. First to target wins the set regardless of margin.
Applies to: CA-02
Example: 21-20 is a valid, complete set result.

**BR-012: Match Format Is Fixed at Match Creation**
Rule: The scoring format for a match (set-to-21, set-to-30, or 3x15) is determined at match creation based on event, round, and age group. It cannot be changed after the match is created.
Applies to: CA-02, CA-04
Example: A U11 QF match is set-to-30. This cannot be changed to 3x15 at score entry time.

**BR-013: 3x15 Set 3 Conditional**
Rule: In a best-of-3 match, Set 3 is only created and displayed after Set 2 completes and each player has won exactly one set.
Applies to: CA-02
Example: If P1 wins Set 1 and Set 2, Set 3 never renders. If P1 wins Set 1 and P2 wins Set 2, Set 3 renders.

**BR-014: Mark Complete Only When Winning Condition Met**
Rule: The "Mark Match Complete" button is only enabled when a mathematically valid winning condition exists.
Applies to: CA-04
Example: For set-to-21, one complete set suffices. For 3x15, two sets won by the same player are required.

---

### E7 Handicap

**BR-015: E7 Handicap Applied to P1 and P2 in Every Set**
Rule: In E7, players coded P1 and P2 (the two U13 girls) begin every set of every match at 3-0. This applies in all rounds including consolation. Admins enter the final score including the head start.
Applies to: CA-02, score entry for E7 matches
Example: If P1's opponent scores 18 and P1 scores 21 (starting from 3), the entered score is 21-18.

**BR-016: E7 Handicap Banner Is Persistent**
Rule: A handicap warning banner must be visible on the score entry screen for any E7 match involving P1 or P2, at all times during score entry. It must not be dismissible.
Applies to: CA-02, score entry UI for E7
Example: Admin cannot accidentally miss the handicap rule because the banner cannot be closed.

---

### Special Triggers

**BR-017: Triggers Are Idempotent**
Rule: Each special trigger (BLP, consolation pool generation, E8 draw lock, podium publish) can only produce its output once. Subsequent attempts surface who ran it and when, and produce no new output.
Applies to: TA-04, TA-05, TA-06, TA-07
Example: If Top Admin A runs BLP at 10:32, Top Admin B sees "Generated by [A] at 10:32" and cannot re-run it.

**BR-018: BLP Eligibility Requires All E1 R1 Matches Complete**
Rule: The BLP trigger cannot be fired until all 7 E1 R1 matches are in complete, walkover, or retired status.
Applies to: TA-04
Example: If 6 of 7 R1 matches are complete, the BLP button is visible but disabled with a status indicator.

**BR-019: BLP Ranking Excludes Walkovers**
Rule: Walkover wins and losses are excluded from BLP point-margin ranking. Only played matches with recorded scores are ranked.
Applies to: TA-04
Example: If one R1 loser lost via walkover, they are excluded from BLP consideration entirely.

**BR-020: E1 Consolation Pool Requires BLP Complete**
Rule: The consolation pool generation trigger cannot fire until the BLP match is in complete status.
Applies to: TA-05
Example: Button is disabled with "Waiting for BLP match to complete."

**BR-021: E8 Draw Composition Constraints**
Rule: The 5 Girls Doubles pairs must contain exactly 3 pairs of (U15 + U11) and exactly 2 pairs of (U15 + U13). No other composition is valid.
Applies to: TA-06
Example: Entering 4x (U15+U11) and 1x (U15+U13) is blocked with an inline error identifying the violating pair.

---

### Edit & Lock Rules

**BR-022: Published Events Are Locked**
Rule: No match in a published event can be edited by anyone until the podium is explicitly un-published by a Top Admin.
Applies to: TA-01, TA-03
Example: After E3 podium is published, even Top Admin cannot edit an E3 match without un-publishing first.

**BR-023: Cascade or Leave — No Silent Propagation**
Rule: When a Top Admin edit affects downstream matches, the system must always present the Cascade / Leave choice explicitly. It must never silently update or silently ignore downstream matches.
Applies to: TA-02
Example: Editing QF1 after SF1 and the Final are complete always surfaces the downstream impact list before any change is saved.

**BR-024: Podium Publish Requires All Relevant Matches Complete**
Rule: A podium cannot be published until all matches that contribute to that event's final standings are in complete, walkover, or retired status.
Applies to: TA-07
Example: E3 podium cannot be published if the E3 consolation final is still in_progress.

---

### Standings & Tiebreakers

**BR-025: RR Standings Sort Order**
Rule: Round robin and pool standings are sorted by: (1) wins descending, (2) points for descending, (3) head-to-head result between tied players.
Applies to: PV-04, standings computation
Example: Two players tied on wins → higher points-for ranks higher. If also tied on points-for → their direct match result decides.

**BR-026: Tiebreaker Reasoning Must Be Visible**
Rule: When two or more players are tied in standings, the UI must display the tiebreaker reasoning inline.
Applies to: PV-04
Example: "Ranked above due to: points for 38 vs 35" shown beneath the tied players' rows.

---

### Public Site

**BR-027: Real Names Only in UI**
Rule: Player codes (e.g. P1-U11-B) never appear in any user-facing screen, admin or public. Only real names are displayed.
Applies to: All screens
Example: The bracket shows "Aarav S." not "P3-U11-B".

**BR-028: Duplicate First Name Disambiguation**
Rule: If two players share a first name, both are displayed with their surname initial appended automatically throughout the app.
Applies to: All screens
Example: Two players named "Aarav" become "Aarav S." and "Aarav P." everywhere in the UI.

**BR-029: E7 Handicap Marker on Public Site**
Rule: All E7 matches involving P1 or P2 are marked with a ★ symbol on the public site so parents understand why scores appear different from standard matches.
Applies to: PV-01, PV-03
Example: A score of 21-14 in an E7 P1 match shows ★ next to the match with a note explaining the head start.

**BR-030: Champion Board Shows Only Published Podiums**
Rule: The Champion Board tab only displays events whose podium status is published. Draft podiums are never visible on the public site.
Applies to: PV-05
Example: E3 podium in draft is invisible to parents until Top Admin explicitly publishes it.

---

### Consolation Format

**BR-031: Consolation Format Is Fixed at Round Robin Pool Only (v1)**
Rule: Consolation pools in v1 support only the round robin pool format. Fixed pool sizes: 3 players (E2/E3/E4/E5/E7), 6 players in 2 pools of 3 (E1). Mini knockouts, 4-player pools, or any other consolation format are not supported in v1.
Applies to: All consolation pool generation
Example: If the tournament draw changes to 4 consolation players, the app cannot accommodate this without a code change.
Note: Format extension is a candidate for v1.5.

---

### Score Edit

**BR-032: Score Edits Are Overwrite, Not Versioned**
Rule: When a set score is edited, the new value overwrites the previous value directly. No separate version records are created for scores. The before and after values are captured in the audit log entry for that edit, providing full traceability without versioning complexity.
Applies to: TA-01, CA-03
Example: Set 1 was entered as 21-18, corrected to 21-15. The match record shows 21-15. The audit log shows the change from 21-18 to 21-15, who made it, and when.

---

## [DATA ENTITIES]

**Entity: Player**
Definition: An individual child competing in the tournament.
Key attributes: Real name, age group, gender, active/withdrawn status, internal code (used only for matching against physical draw sheets — never displayed in UI)
Relationships: Belongs to one or more Events; may belong to a Team (doubles)
Business rules: BR-027, BR-028

---

**Entity: Team**
Definition: A pair of players competing together in a doubles event.
Key attributes: The two players who form the pair, the event they compete in, active/withdrawn status
Relationships: Belongs to one Event; composed of exactly 2 Players
Business rules: BR-021 (E8 composition constraints), BR-027

---

**Entity: Event**
Definition: One of the 8 competition categories in the tournament (e.g. U11 Boys Singles, Girls Doubles).
Key attributes: Name, format type (knockout / round robin / hybrid), gender, age group, current status, whether the draw is locked, any handicap rule, any events it depends on before starting
Relationships: Contains many Matches; may have a Podium; may depend on other Events (gates)
Business rules: BR-012, BR-018, BR-020, BR-024, BR-031

---

**Entity: Match**
Definition: A single contest between two opponents (players or teams) within an event.
Key attributes: Which event and round it belongs to, the two opponents (may be placeholders until resolved), set scores, current status, which court it is on (if started), who entered it and when, full edit history, whether a handicap applies
Relationships: Belongs to one Event; involves two opponents (Players or Teams); may generate downstream Matches on completion
Business rules: BR-004, BR-005, BR-006, BR-007, BR-008, BR-009, BR-010, BR-011, BR-012, BR-013, BR-014, BR-015, BR-016, BR-022, BR-023, BR-032
Note: Court is an attribute on Match (label C1–C5 attached when started), not a standalone entity. No fixed court assignment exists.

---

**Entity: Set**
Definition: A single scoring unit within a Match. A match contains one set (set-to-21/30) or up to three sets (3x15).
Key attributes: Set number, score for each opponent, whether complete, target score for this set
Relationships: Belongs to one Match
Business rules: BR-010, BR-011, BR-013

---

**Entity: Standing**
Definition: A computed record of a player or team's performance within a round robin pool or event.
Key attributes: Matches played, wins, losses, points scored, points conceded, head-to-head results against others in the same pool
Relationships: Belongs to one Event and optionally one Pool; references one Player or Team
Business rules: BR-025, BR-026

---

**Entity: Pool**
Definition: A sub-group of players within a consolation round robin, used to organise matches and standings.
Key attributes: Which event it belongs to, which players are in it, pool label (e.g. Pool A / Pool B)
Relationships: Belongs to one Event; contains 3 Players or Teams; generates Matches between its members
Business rules: BR-031

---

**Entity: Podium**
Definition: The final ranked result for an event, reviewed and published by a Top Admin.
Key attributes: Gold, Silver, Bronze recipients, consolation winner, current status (draft / published), who published it and when
Relationships: Belongs to one Event; references Players or Teams
Business rules: BR-022, BR-024, BR-030

---

**Entity: Audit Log Entry**
Definition: A timestamped record of any significant action taken in the system by an admin.
Key attributes: When it happened, what action was taken, which match it relates to (if any), who performed it, what changed (before and after values for score edits)
Relationships: May reference a Match; references an admin actor by name (plain string, no user table)
Business rules: BR-017, BR-023, BR-032

---

**Entity: Trigger Record**
Definition: A record that a special one-time trigger has been fired, preventing it from being fired again.
Key attributes: Which trigger, which event, who fired it, when
Relationships: Belongs to one Event
Business rules: BR-017, BR-018, BR-019, BR-020, BR-021

---

## [PROCESS FLOWS]

### Flow: Score Entry (Standard Match)
Actor: Court Admin
Precondition: Match is in ready status. Both opponents are resolved.

Steps:
1. Court Admin opens Match Picker and selects a court (C1–C5)
2. Court Admin sees ready matches list and taps "Start on Court X" on chosen match
3. If court is already occupied → warning shown → admin confirms or picks different court
4. Match transitions to in_progress. Court label attached to match.
5. Score entry screen opens. If E7 handicap match → persistent banner displayed immediately.
6. Admin enters Player 1 and Player 2 scores for Set 1 and taps Submit
7. Validation runs: exactly one score must equal target, other must be 0 to target-minus-one
8. If invalid → inline error shown, set not saved, admin corrects
9. If valid → Set 1 saved, visible to all users in real time
10. For 3x15 matches → Set 2 renders. Admin repeats steps 6–9.
11. If 3x15 and players split sets 1-1 → Set 3 renders. Admin repeats steps 6–9.
12. When winning condition met → "Mark Match Complete" button enables
13. Admin taps button → confirmation modal shows winner and final score
14. Admin confirms → match transitions to complete, locked from court admin edits, auto-progression fires

Postcondition: Match is complete. Winner auto-advances to next bracket slot. If both slots in downstream match now resolved, that match transitions to ready.

Failure paths:
- Step 2: Two admins start same court simultaneously → second admin sees warning, must confirm or abort
- Step 6–8: Invalid score → inline error, no save, retry
- Step 9: Network failure on save → red banner, retry button, score retained in form
- Step 14: Network failure on complete → red banner, retry button, match remains in_progress

---

### Flow: Walkover / Retirement Recording
Actor: Court Admin
Precondition: Match is in ready or in_progress status.

Steps:
1. Admin taps "Walkover / Retire" link on score entry screen
2. Modal opens with two options: Walkover or Retired
3a. If Walkover selected: Admin picks the winner from the two opponents. Confirms → match recorded as walkover, no scores, winner advances.
3b. If Retired selected: Admin picks the winner. Admin optionally enters last-known set scores. Confirms → match recorded with retired flag, partial scores if entered, winner advances.

Postcondition: Match is complete (walkover or retired status). Winner auto-advances. Match flagged in standings and excluded from BLP point-margin ranking.

Failure paths:
- Network failure on submit → red banner, retry button

---

### Flow: E1 BLP Trigger
Actor: Top Admin
Precondition: All 7 E1 R1 matches are in complete, walkover, or retired status. BLP has not been run before.

Steps:
1. Top Admin opens Event Control, selects E1
2. "Run BLP Computation" button is enabled (all R1 complete)
3. Top Admin taps button → app computes point margins for all eligible R1 losers (walkovers excluded per BR-019)
4. App surfaces top 2 closest losers with their margins displayed
5. Top Admin reviews and confirms
6. BLP match created between the 2 players. Trigger record saved with actor name and timestamp.
7. BLP match appears in ready matches list

Postcondition: BLP match exists and is ready to be started. Button now shows "Generated by [name] at HH:MM."

Failure paths:
- Step 2: Not all R1 complete → button disabled, status shows which matches are outstanding
- Step 3: Fewer than 2 eligible losers (e.g. multiple walkovers) → app surfaces warning, Top Admin must resolve manually

---

### Flow: E1 Consolation Pool Generation
Actor: Top Admin
Precondition: BLP match is complete. Consolation pools not yet generated.

Steps:
1. Top Admin opens Event Control, selects E1
2. "Generate Consolation Pools" button is enabled
3. Top Admin taps button → app identifies 6 consolation players: 5 R1 losers (ranks 3–7 by margin) + 1 BLP loser
4. App randomly shuffles and splits into Pool A (3 players) and Pool B (3 players)
5. Preview shown to Top Admin: Pool A members, Pool B members
6. Top Admin confirms → 6 RR matches generated (3 per pool), trigger record saved
7. Matches appear in ready list. Pool standings initialise at 0.

Postcondition: 6 consolation matches exist and are ready. Pool A and Pool B visible in standings tab.

Failure paths:
- Step 2: BLP not complete → button disabled
- Step 6: Network failure → red banner, retry, no partial state saved

---

### Flow: E8 Girls Doubles Draw Posting
Actor: Top Admin
Precondition: Draw has not been posted. Time is at or after 14:00.

Steps:
1. Top Admin opens Event Control, selects E8
2. Taps "Post Girls Doubles Draw"
3. Draw form opens: 5 pair slots, each with two player dropdowns
4. Top Admin assigns players to pairs
5. App validates composition on each change: must be 3x (U15+U11) and 2x (U15+U13)
6. If constraint violated → inline error on offending pair
7. When all 5 pairs valid → "Lock Draw" button enables
8. Top Admin taps Lock Draw → 10 RR matches generated, E8 activates, trigger record saved

Postcondition: E8 is active. 10 matches are ready. Draw cannot be changed.

Failure paths:
- Step 5–6: Invalid composition → blocked until corrected
- Step 8: Network failure → red banner, retry, draw not locked

---

### Flow: Top Admin Cascade Edit
Actor: Top Admin
Precondition: Match is complete. Event podium is not published.

Steps:
1. Top Admin opens Event Control, taps the match to edit
2. Full audit log visible. Top Admin makes score change.
3. App detects downstream matches affected by result change
4. If no downstream matches affected → change saves directly, audit log updated
5. If downstream matches exist → modal shows list of affected matches
6. Top Admin chooses Cascade or Leave
7a. Cascade: downstream matches updated automatically. Any downstream results that conflict with new winner are invalidated. Audit log records full chain.
7b. Leave: only source match updated. Downstream matches flagged as inconsistent. Audit log records the inconsistency.

Postcondition: Source match updated. Downstream either cascaded or flagged. Audit log reflects all changes.

Failure paths:
- Step 2: Event is published → edit blocked, message shown
- Step 6: Network failure on save → red banner, retry, no partial state saved

---

### Flow: Podium Publish
Actor: Top Admin
Precondition: All matches for the event (including consolation final and 3rd place match) are complete.

Steps:
1. Podium auto-drafts when final relevant match completes
2. Top Admin opens Champion Board Admin screen
3. Event shows status "Draft — review pending"
4. Top Admin taps event → sees Gold, Silver, Bronze, consolation winner with real names
5. Top Admin reviews ordering and confirms names are correct
6. Top Admin taps Publish → confirmation modal
7. Confirms → podium status set to published, all matches in event locked, Champion Board public tab updates immediately

Postcondition: Podium is public. Event matches are locked. No further edits without un-publishing.

Failure paths:
- Step 3: Relevant matches not all complete → Publish button not available, outstanding matches listed
- Step 7: Network failure → red banner, retry, podium remains draft

---

## [EDGE CASES]

**EC-001: Two Court Admins Start the Same Match Simultaneously**
Scenario: Two admins both tap "Start on Court X" on the same ready match at the same moment from different devices.
Expected behaviour: First request wins. Second request sees the match already in_progress and is shown an error. Match is not duplicated or corrupted.

**EC-002: Two Court Admins Start Different Matches on the Same Court**
Scenario: Admin A starts Match 1 on C3. Admin B, not seeing the update yet, also starts Match 2 on C3.
Expected behaviour: Second request triggers the "Court X has a match in progress" warning. Admin B must confirm override or select a different court.

**EC-003: Network Loss Mid Score Entry**
Scenario: Court Admin enters Set 1 scores and taps Submit, but the network drops before the save completes.
Expected behaviour: Red banner displayed immediately. Retry button shown. Scores retained in the form. Match remains in_progress. No partial or corrupt state saved.

**EC-004: Network Loss on Mark Match Complete**
Scenario: Court Admin taps "Mark Match Complete" and confirms, but the network drops before the server confirms.
Expected behaviour: Red banner shown. Retry button available. Match remains in_progress on the server. Admin can retry. Auto-progression does not fire until server confirms completion.

**EC-005: Top Admin Edits a Match Whose Downstream Has Already Been Played**
Scenario: Top Admin corrects a QF result after the SF and Final derived from it are both complete with their own results entered.
Expected behaviour: Cascade modal shows all affected matches (SF + Final). If Cascade chosen, SF and Final results are invalidated and those matches return to ready status. If Leave chosen, inconsistency is flagged visibly on all affected matches.

**EC-006: Player Withdraws Mid-Tournament**
Scenario: A player who has already won matches and advanced in the bracket withdraws due to injury.
Expected behaviour: Top Admin records retirement or walkover on the player's next match. Prior completed matches are unaffected. The opponent advances. RR standings flag the withdrawn player's remaining unplayed matches appropriately.

**EC-007: All E1 R1 Losers Lost via Walkover**
Scenario: Every E1 R1 match is a walkover, leaving no played matches with point margins for BLP ranking.
Expected behaviour: BLP trigger fires but surfaces a warning: "No eligible players for BLP — all R1 losses were walkovers." Top Admin must resolve manually. App does not auto-create a BLP match.

**EC-008: Fewer Than 6 Eligible Players for E1 Consolation**
Scenario: Some R1 losers withdrew or multiple walkovers reduce the eligible consolation pool below 6.
Expected behaviour: App surfaces the available players and the shortfall clearly. Top Admin must resolve manually. Consolation pool generation is blocked until Top Admin confirms how to proceed.

**EC-009: Duplicate First Names Across Age Groups**
Scenario: Two players named "Aarav" compete in different events and both appear on the public site simultaneously.
Expected behaviour: Both are displayed with surname initial appended automatically throughout the entire app — not just in screens where they appear together.

**EC-010: Top Admin Unavailable at 14:15 for E8 Draw**
Scenario: The designated Top Admin is unreachable at draw posting time.
Expected behaviour: Any other Top Admin can post the draw from any device. The form is accessible from Event Control with one tap. No single point of failure.

**EC-011: E8 Draw Posted with a Player Already Withdrawn**
Scenario: A Girls Doubles player withdraws before the draw is posted.
Expected behaviour: The withdrawn player is not available in the draw form dropdowns. Top Admin must resolve the pairing gap before locking the draw. App does not allow a pair with a withdrawn player.

**EC-012: Three-Way Tie in RR Standings**
Scenario: In a 3-player pool, each player beats one opponent and loses to the other — a perfect cycle.
Expected behaviour: Standings sort by wins (all equal), then points for. If points for also tied, head-to-head is inconclusive (circular). App surfaces the tie explicitly with reasoning shown. Top Admin resolves manually if the tie affects pool progression.

**EC-013: Court Admin Loses Session Mid-Match**
Scenario: A Court Admin's phone session expires or they accidentally sign out while a match is in_progress.
Expected behaviour: Match remains in_progress on the server. Any Court Admin can re-open the match from the Match Picker in-progress list and continue score entry. No data is lost.

**EC-014: Podium Published Then Error Discovered**
Scenario: Top Admin publishes E3 podium then realises the wrong player is listed as Gold due to a score entry error.
Expected behaviour: Top Admin un-publishes the podium. This removes it from the public Champion Board immediately. Top Admin edits the relevant match result, re-reviews the corrected draft podium, and re-publishes.

---

## [ACCEPTED RISKS]

Carried from HL-design.md (Phase 2 skipped per pipeline instruction — risks carried directly from source document).

**R-001: Multiple Admin Coordination Conflicts**
Risk: 4–6 people with equal-tier court admin access can cause score double-entry or conflicting edits.
Mitigation: Edit locks on completed matches, audit log visible per match, idempotent triggers, agreed pre-event role split among admins.

**R-002: Gym WiFi Unreliable**
Risk: Brampton gym wifi may drop during the event, causing score submits to fail.
Mitigation: Loud failure on score submit (red banner, retry button), manual refresh on every screen, auto-refresh on public site, printed paper match sheets as fallback.

**R-003: Supabase Outage on Event Day**
Risk: Complete backend outage would make the app unusable for the full 6-hour event.
Mitigation: Operational only — print full match sheets for every event on event-day morning. Paper is the fallback; results typed into app later for archive.

**R-004: Top Admin Unavailable at 14:15 for E8 Draw**
Risk: E8 draw posting blocks E8 from starting. Late top admin = late E8 = late finish.
Mitigation: Any Top Admin can post the draw from any device (EC-010). Form is one tap from Event Control.

**R-005: Cascade Edit Destroying Podium in Preparation**
Risk: Top Admin edits an R1 match after a podium is being prepared, cascade reshuffles SF/F, wrong podium results.
Mitigation: Cascade confirmation modal shows downstream impact before any change fires. Edit blocked once podium is published. Audit log visible on all modified matches.

---

## [OPEN QUESTIONS]

None. All questions raised during Phase 3 were resolved inline.

---

## [PHASE SKIP NOTE]

Phase 1 (Idea Hardening) and Phase 2 (VC Stress Test) were skipped at the user's instruction. The HL-design.md document (v1, April 2026) served as the fully-formed input to Phase 3. Accepted risks were carried directly from the HL design document in lieu of Phase 2 output.
